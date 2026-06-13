// ═══════════════════════════════════════════════════════════════
// RYUJIN TENANTS - minimal provisioning endpoint (GAP-C).
// POST /api/tenants - create a working tenant: tenant row + tenant_settings
//   (branding) + cloned default offers + owner user. The demo-seed steps minus
//   the sample data (scripts/seed-demo-tenant.mjs covers the demo extras).
//
// This is the real creation path that GAP-A hooks into: a fresh tenant has zero
// offers and cannot generate a single proposal, so cloneDefaultOffers runs the
// instant the tenant is created.
//
// AUTH: internal provisioning only. Requires the raw RYUJIN_SERVICE_TOKEN as a
// bearer. Cross-tenant creation cannot use the normal per-tenant session gate
// (the tenant does not exist yet), and must not be open. Self-serve signup
// (an unauthenticated path with its own gate) is GAP-B follow-up, not this.
//
// SAFETY: refuses to (re)provision the plus-ultra tenant. Idempotent: a repeat
// call with the same slug updates branding + re-ensures offers/owner rather
// than duplicating.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { cloneDefaultOffers } from '../lib/cloneOffers.js';
import { seedSampleProposal } from '../lib/seedSampleProposal.js';

const SERVICE_TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
const PROTECTED_SLUGS = new Set(['plus-ultra']);

function bearer(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Provisioning gate: raw service token only.
  if (!SERVICE_TOKEN) return res.status(503).json({ error: 'provisioning disabled (no service token configured)' });
  if (bearer(req) !== SERVICE_TOKEN) return res.status(401).json({ error: 'unauthorized', code: 'NO_SERVICE_TOKEN' });

  const body = req.body || {};
  const slug = String(body.slug || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const ownerEmail = String(body.owner_email || '').trim().toLowerCase();

  if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug)) {
    return res.status(400).json({ error: 'slug required (kebab-case, 3-50 chars)' });
  }
  if (PROTECTED_SLUGS.has(slug)) {
    return res.status(409).json({ error: `slug '${slug}' is protected and cannot be provisioned here` });
  }
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) {
    return res.status(400).json({ error: 'valid owner_email required' });
  }

  const accentColor = body.accent_color || null;
  const tagline = body.tagline || null;

  try {
    // ── 1. tenant (idempotent by slug) ──
    const tenantRow = {
      slug,
      name,
      owner_email: ownerEmail,
      plan: body.plan || 'starter',
      active: true,
      is_sandbox: body.is_sandbox === false ? false : true,
      branding: { accent_color: accentColor, tagline },
    };
    const { data: existingTenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', slug).maybeSingle();

    let tenantId, created;
    if (existingTenant) {
      tenantId = existingTenant.id;
      created = false;
      const { error } = await supabaseAdmin.from('tenants').update(tenantRow).eq('id', tenantId);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseAdmin.from('tenants').insert(tenantRow).select('id').single();
      if (error) throw error;
      tenantId = data.id;
      created = true;
    }

    // ── 2. tenant_settings (branding; rates/margins use column defaults) ──
    const settingsRow = {
      tenant_id: tenantId,
      company_name: name,
      company_phone: body.company_phone || null,
      company_email: body.company_email || null,
      company_website: body.company_website || null,
      accent_color: accentColor,
      tagline,
      proposal_header: body.proposal_header || null,
    };
    const { data: existingSettings } = await supabaseAdmin
      .from('tenant_settings').select('id').eq('tenant_id', tenantId).maybeSingle();
    if (existingSettings) {
      const { error } = await supabaseAdmin.from('tenant_settings').update(settingsRow).eq('id', existingSettings.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('tenant_settings').insert(settingsRow);
      if (error) throw error;
    }

    // ── 3. offers (GAP-A: a tenant with zero offers cannot quote) ──
    const offers = await cloneDefaultOffers(tenantId);

    // ── 4. owner user (idempotent by tenant_id + email) ──
    const { data: existingUser } = await supabaseAdmin
      .from('users').select('id').eq('tenant_id', tenantId).eq('email', ownerEmail).maybeSingle();
    let ownerUserCreated = false;
    if (!existingUser) {
      const { error } = await supabaseAdmin.from('users').insert({
        tenant_id: tenantId, email: ownerEmail, name: body.owner_name || 'Owner', role: 'owner', active: true,
      });
      if (error) throw error;
      ownerUserCreated = true;
    }

    // ── 5. sample proposal (sell-readiness: signup -> branded proposal) ──
    // A fresh tenant has offers but zero estimates, so /api/proposal has
    // nothing to render. Seed a sample published proposal branded with THIS
    // tenant (the renderer pulls its name/accent/rep from tenant_settings) so
    // the signup flow lands on a rendered, their-branded proposal with no
    // manual steps. Default: sandbox tenants (trials/demos) get one; a paying
    // tenant opts in with seed_sample:true or out with seed_sample:false.
    // Never fails provisioning — the tenant is already usable without it.
    let sampleProposal = null;
    const wantSample = body.seed_sample === true
      || (body.seed_sample !== false && tenantRow.is_sandbox === true);
    if (wantSample) {
      try {
        sampleProposal = await seedSampleProposal(tenantId, { slug });
      } catch (e) {
        sampleProposal = { error: e && e.message ? e.message : String(e) };
      }
    }

    return res.status(created ? 201 : 200).json({
      tenant_id: tenantId,
      slug,
      created,
      offers,
      owner_user_created: ownerUserCreated,
      sample_proposal: sampleProposal,
      sample_proposal_url: sampleProposal && sampleProposal.share_token
        ? `/proposal-client.html?share=${sampleProposal.share_token}`
        : null,
    });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
