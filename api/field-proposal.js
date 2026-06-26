// Ryujin OS - Field live proposal (Diego's on-the-spot close).
// ----------------------------------------------------------------------------
// As a crew member documents a job in field.html, the proposal builds itself off
// a linked draft estimate; the existing live preview (GET /api/proposal-v2?
// estimate=&template=) renders it. present-sign freezes to /p/<slug> for a
// signature on the spot when the proposal is STANDARD engine pricing; anything
// non-standard (discount, add-ons, non-asphalt, complex/hip roof) routes to Mac.
// The gate lives in lib/proposalMaterialize.js (isStandardEngineClose) so it is
// un-bypassable.
//
//   POST /api/field-proposal?action=ensure-estimate  { project_id }
//   POST /api/field-proposal?action=recompute        { project_id, measurements }
//   POST /api/field-proposal?action=sync-photos      { project_id, file_ids[], roles{} }
//   POST /api/field-proposal?action=present-sign      { project_id, selected_tier, discount?, addons? }
//
// Auth: requirePortalSessionAndTenant. Privileged writes (calculated_packages,
// share_token mint, customer create) run via supabaseAdmin here - the server is
// authoritative, crew never posts a price.
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { withSentry } from '../lib/sentry.js';
import { shapeCalculatedPackages } from '../lib/quotePackages.js';
import { materializeInstance } from '../lib/proposalMaterialize.js';
import { notifyLeadEvent } from '../lib/leadNotify.js';

const TEMPLATE_SLUG = 'asphalt-good-better-best';
const TIERS = ['gold', 'platinum', 'diamond'];

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise(resolve => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function loadProject(tenantId, projectId) {
  if (!projectId) return null;
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id, tenant_id, estimate_id, customer_id, name, address, city, province')
    .eq('tenant_id', tenantId)
    .eq('id', projectId)
    .maybeSingle();
  return data || null;
}

// Idempotent: return the project's linked draft estimate, or create + link one.
// Always mints a share_token so the eventual accept is estimate-backed (fires the
// full state machine + draft work order). A fresh estimate per project (never
// reuse another job's draft) keeps jobs from cross-wiring.
async function ensureEstimate(tenantId, project) {
  if (project.estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates')
      .select('id, estimate_number, share_token, status, locked_at')
      .eq('tenant_id', tenantId).eq('id', project.estimate_id).maybeSingle();
    if (est) {
      let token = est.share_token;
      if (!token) {
        token = randomBytes(24).toString('base64url');
        await supabaseAdmin.from('estimates').update({ share_token: token }).eq('id', est.id);
      }
      return { estimate_id: est.id, estimate_number: est.estimate_number, share_token: token, locked_at: est.locked_at };
    }
  }

  // Resolve a customer (create from the project address if the job has none).
  let customerId = project.customer_id;
  if (!customerId) {
    const { data: newCust, error: custErr } = await supabaseAdmin
      .from('customers')
      .insert({
        tenant_id: tenantId,
        full_name: project.name || project.address || 'New Customer',
        address: project.address || '',
        city: project.city || null,
        province: project.province || 'NB',
      })
      .select('id').single();
    if (custErr) throw new Error(`Customer creation failed: ${custErr.message}`);
    customerId = newCust.id;
    await supabaseAdmin.from('projects').update({ customer_id: customerId }).eq('id', project.id);
  }

  const { data: est, error: estErr } = await supabaseAdmin
    .from('estimates')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      proposal_mode: 'Roof Only',
      pricing_model: 'Local',
      status: 'draft',
      calculated_packages: {},
      custom_prices: {},
      notes: [],
      tags: ['source:field'],
    })
    .select('id, estimate_number').single();
  if (estErr) throw new Error(`Estimate creation failed: ${estErr.message}`);

  // Mint the 192-bit share token (matches estimates.js POST; required for an
  // estimate-backed accept). Retry once on a transient persist failure.
  let shareToken = randomBytes(24).toString('base64url');
  let { error: tokErr } = await supabaseAdmin.from('estimates').update({ share_token: shareToken }).eq('id', est.id);
  if (tokErr) {
    shareToken = randomBytes(24).toString('base64url');
    ({ error: tokErr } = await supabaseAdmin.from('estimates').update({ share_token: shareToken }).eq('id', est.id));
  }

  await supabaseAdmin.from('projects').update({ estimate_id: est.id }).eq('id', project.id);
  return { estimate_id: est.id, estimate_number: est.estimate_number, share_token: tokErr ? null : shareToken, locked_at: null };
}

// Build the engine measurements object from field input. The field auto-measure
// is a 2D footprint (areaIsPitchAdjusted:false), so the engine applies its own
// pitch multiplier - never double-counted.
function buildMeasurements(m = {}) {
  const sqFt = Number(m.squareFeet ?? m.square_feet ?? 0) || 0;
  return {
    squareFeet: sqFt,
    areaIsPitchAdjusted: false,
    pitch: String(m.pitch || '5/12'),
    complexity: m.complexity || 'medium',
    eavesLF: Number(m.eavesLF ?? m.eaves_lf) || 0,
    rakesLF: Number(m.rakesLF ?? m.rakes_lf) || 0,
    ridgesLF: Number(m.ridgesLF ?? m.ridges_lf) || 0,
    valleysLF: Number(m.valleysLF ?? m.valleys_lf) || 0,
    hipsLF: Number(m.hipsLF ?? m.hips_lf) || 0,
    wallsLF: Number(m.wallsLF ?? m.walls_lf) || 0,
    pipes: Number(m.pipes) || 0,
    vents: Number(m.vents) || 0,
    chimneys: Number(m.chimneys) || 0,
    chimneySize: m.chimneySize || m.chimney_size || 'small',
    stories: Number(m.stories) || 1,
    extraLayers: Number(m.extraLayers ?? m.extra_layers) || 0,
    redeckSheets: Number(m.redeckSheets ?? m.redeck_sheets) || 0,
    distanceKM: Number(m.distanceKM ?? m.distance_km) || 0,
  };
}

// Persist the field measurements to the estimate (keeps status 'draft' so the
// row stays unlocked and re-runnable). Server-authoritative via supabaseAdmin.
async function persistMeasurements(tenantId, estimateId, mm, extra = {}) {
  await supabaseAdmin.from('estimates').update({
    roof_area_sqft: mm.squareFeet,
    roof_pitch: mm.pitch,
    complexity: mm.complexity,
    eaves_lf: mm.eavesLF, rakes_lf: mm.rakesLF, ridges_lf: mm.ridgesLF,
    valleys_lf: mm.valleysLF, hips_lf: mm.hipsLF, walls_lf: mm.wallsLF,
    pipes: mm.pipes, vents: mm.vents, chimneys: mm.chimneys,
    chimney_size: mm.chimneySize, stories: mm.stories,
    extra_layers: mm.extraLayers, redeck_sheets: mm.redeckSheets,
    distance_km: mm.distanceKM,
    ...extra,
  }).eq('tenant_id', tenantId).eq('id', estimateId);
}

// Run the quote engine via the existing compare endpoint (service token).
async function callCompare(tenantSlug, measurements, choices = {}) {
  const BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
  const tok = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantSlug,
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
  };
  const r = await fetch(`${BASE}/api/quote?mode=compare&tenant=${encodeURIComponent(tenantSlug)}`, {
    method: 'POST', headers, body: JSON.stringify({ measurements, choices }),
  });
  if (!r.ok) return { ok: false, status: 502, error: `Quote engine failed (HTTP ${r.status})` };
  return { ok: true, data: await r.json() };
}

// Create a Mac-approval via the existing router (gets dedupe + code + owner
// assignment). Server-to-server with the service token.
async function createApproval(tenantSlug, payload) {
  const BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
  const tok = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  const r = await fetch(`${BASE}/api/router`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantSlug, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { code: null, error: `router HTTP ${r.status}` };
  return await r.json().catch(() => ({ code: null }));
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = req.tenant.id;
  const tenantSlug = req.tenant.slug;
  const action = String(req.query.action || '').trim();
  const body = await readBody(req);

  const project = await loadProject(tenantId, String(body.project_id || '').trim());
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    // ── ensure-estimate ──
    if (action === 'ensure-estimate') {
      const link = await ensureEstimate(tenantId, project);
      return res.json({ ok: true, ...link });
    }

    // ── recompute ──
    if (action === 'recompute') {
      const link = await ensureEstimate(tenantId, project);
      if (link.locked_at) return res.status(423).json({ error: 'Estimate is locked', estimate_id: link.estimate_id });
      const mm = buildMeasurements(body.measurements);

      if (!(mm.squareFeet > 0)) {
        await persistMeasurements(tenantId, link.estimate_id, mm);
        return res.json({ ok: true, pricing_pending: true, estimate_id: link.estimate_id });
      }

      const compare = await callCompare(tenantSlug, mm, {});
      if (!compare.ok) return res.status(compare.status).json({ error: compare.error });

      const actualSQ = mm.squareFeet / 100;
      const reqTier = String(body.selected_tier || body.measurements?.selected_tier || '').toLowerCase();
      const selected = TIERS.includes(reqTier) ? reqTier : 'platinum';
      const shaped = shapeCalculatedPackages(compare.data, { actualSQ });
      if (!Object.keys(shaped).length) {
        await persistMeasurements(tenantId, link.estimate_id, mm);
        return res.json({ ok: true, pricing_pending: true, estimate_id: link.estimate_id });
      }

      await persistMeasurements(tenantId, link.estimate_id, mm, {
        calculated_packages: shaped,
        selected_package: selected,
      });

      const tiers = {};
      for (const [k, v] of Object.entries(shaped)) {
        tiers[k] = { total: v.total, totalWithTax: v.totalWithTax, persq: v.persq };
      }
      return res.json({ ok: true, estimate_id: link.estimate_id, measuredSQ: actualSQ, selected, tiers });
    }

    // ── sync-photos ──
    if (action === 'sync-photos') {
      const link = await ensureEstimate(tenantId, project);
      const fileIds = Array.isArray(body.file_ids) ? body.file_ids : [];
      const roles = body.roles && typeof body.roles === 'object' ? body.roles : {};
      if (!fileIds.length) return res.json({ ok: true, synced: 0 });

      const { data: files } = await supabaseAdmin
        .from('project_files')
        .select('id, url, filename')
        .eq('tenant_id', tenantId)
        .eq('project_id', project.id)
        .in('id', fileIds);

      // Skip any source URL already ingested into this estimate (idempotent).
      const { data: existing } = await supabaseAdmin
        .from('estimate_photos')
        .select('url')
        .eq('estimate_id', link.estimate_id);
      const seenUrls = new Set((existing || []).map(p => p.url).filter(Boolean));

      const BASE = (process.env.RYUJIN_BASE_URL || 'https://ryujin-os.vercel.app').trim();
      const tok = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
      let synced = 0;
      for (const f of (files || [])) {
        if (seenUrls.has(f.url)) continue;
        const r = await fetch(`${BASE}/api/estimate-photos?tenant=${encodeURIComponent(tenantSlug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantSlug, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
          body: JSON.stringify({
            estimate_id: link.estimate_id,
            source_url: f.url,
            category: roles[f.id] || 'general',
            caption: f.filename || '',
          }),
        });
        if (r.ok) synced += 1;
      }
      return res.json({ ok: true, synced });
    }

    // ── present-sign ──
    if (action === 'present-sign') {
      const link = await ensureEstimate(tenantId, project);
      if (link.locked_at) return res.status(423).json({ error: 'Estimate is locked', estimate_id: link.estimate_id });

      const reqTier = String(body.selected_tier || '').toLowerCase();
      if (TIERS.includes(reqTier)) {
        await supabaseAdmin.from('estimates').update({ selected_package: reqTier })
          .eq('tenant_id', tenantId).eq('id', link.estimate_id);
      }
      const discount = Number(body.discount) || 0;
      const variablesPatch = discount > 0 ? { discount } : null;
      const addons = Array.isArray(body.addons) ? body.addons : null;

      // Freeze through the shared chokepoint AS THE CREW ACTOR. Standard ->
      // frozen + closed on site; non-standard -> the gate blocks and we route to Mac.
      const result = await materializeInstance({
        estimateId: link.estimate_id,
        templateInput: TEMPLATE_SLUG,
        status: 'sent',
        actor: req.session,
        variablesPatch,
        discount,
        addons,
        slugBase: project.address || project.name,
        expectedTenantId: tenantId,
      });

      if (result.ok) {
        return res.json({ ok: true, mode: 'closed_on_site', url: result.url, slug: result.slug });
      }

      if (result.code === 'NON_STANDARD_REQUIRES_APPROVAL') {
        const addr = project.address || project.name || 'job';
        const { data: est } = await supabaseAdmin
          .from('estimates')
          .select('calculated_packages, selected_package, customer:customers(full_name, ghl_contact_id)')
          .eq('id', link.estimate_id).maybeSingle();
        const sel = String(est?.selected_package || reqTier || '').toLowerCase();
        const pkg = (est?.calculated_packages && est.calculated_packages[sel]) || {};
        const amt = Number(pkg.totalWithTax || pkg.total || 0);
        const amtStr = amt ? `$${amt.toLocaleString()}` : '';

        const approval = await createApproval(tenantSlug, {
          action: 'send_field_proposal',
          target: link.estimate_id,
          summary: `Field close needs OK · ${addr} · ${sel || 'tier'} ${amtStr} (${result.reason})`,
          execute_payload: {
            tool: 'send_field_proposal',
            estimateId: link.estimate_id,
            templateSlug: TEMPLATE_SLUG,
            status: 'sent',
            variablesPatch,
            slugBase: project.address || project.name,
          },
          agent: 'field',
        });

        if (approval.code) {
          await notifyLeadEvent({
            tenantId,
            event: 'field_proposal_approval',
            title: `APPROVAL NEEDED · field close · ${addr} · ${sel || 'tier'} ${amtStr} · ${result.reason} · code ${approval.code}`,
            body: `A crew member is on site at ${addr} and needs your OK to close (${result.reason}). Approve code ${approval.code} on /inbox.html or the approvals panel.`,
            contactName: est?.customer?.full_name || null,
            ghlContactId: est?.customer?.ghl_contact_id || null,
            urgency: 'high',
            dedupeKey: `field-close:${approval.code}`,
            sms: true,
            inboxNotify: false, // immediate high-urgency SMS only; skip the 20-min digest double-ping
          });
        }
        return res.json({ ok: true, mode: 'routed_to_owner', approval_code: approval.code || null, reason: result.reason });
      }

      return res.status(result.status || 500).json({ error: result.error || 'present-sign failed', reason: result.reason });
    }

    return res.status(400).json({ error: `Unknown action '${action}'` });
  } catch (e) {
    console.error('[field-proposal] error:', e?.message, e?.stack);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

export default withSentry(requirePortalSessionAndTenant(handler));
