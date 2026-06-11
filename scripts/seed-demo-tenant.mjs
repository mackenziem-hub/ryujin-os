// ═══════════════════════════════════════════════════════════════
// RYUJIN OS — DEMO TENANT SEED  (DEMO TENANT ONLY)
// ═══════════════════════════════════════════════════════════════
//
// Provisions a clean, demo-able second tenant end to end: tenant row,
// tenant_settings (branding + rates), the full offer set (cloned live
// from plus-ultra so it never drifts), a couple of sample customers,
// estimates, and a project. Idempotent: safe to re-run, every write is
// guarded by a unique key so a second run updates instead of duplicating.
//
// SAFETY: this script NEVER writes to the plus-ultra tenant. It resolves
// the demo tenant id once and asserts it is not the plus-ultra id before
// any mutation. It reads plus-ultra offers (read-only) to clone them.
//
// CONTEXT: tenants.is_sandbox is set true here, but per migration 042 that
// flag is NOT yet enforced server-side (cron agents, snapshot, and CAPI do
// not skip sandbox tenants as of 2026-06-11). Treat this demo tenant as a
// fully live tenant until data isolation lands post-July.
//
// USAGE:
//   node scripts/seed-demo-tenant.mjs            # provision / update
//   node scripts/seed-demo-tenant.mjs --dry-run  # print plan, write nothing
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in env or .env.local.
// Do NOT run against prod without intent. Build stops at PR open.
// ═══════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── env load (matches scripts/seed_test_metal.mjs) ───────────────
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them in env or .env.local.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── demo tenant identity ─────────────────────────────────────────
const PLUS_ULTRA_SLUG = 'plus-ultra';
const DEMO = {
  slug: 'demo-roofing',
  name: 'Aurora Roofing Co. (DEMO)',
  owner_email: 'demo@ryujin-os.dev',
  company_phone: '(506) 555-0123',
  company_email: 'hello@auroraroofing.demo',
  company_website: 'https://auroraroofing.demo',
  accent_color: '#2B6CB0',
  tagline: 'Roofing done right.',
  proposal_header: 'Your Home. Protected.',
};

let plusUltraId = null;
const log = (...a) => console.log(DRY_RUN ? '[dry-run]' : '[seed]', ...a);

// Hard guard: refuse to ever touch the plus-ultra tenant.
function assertNotPlusUltra(tenantId, where) {
  if (!tenantId) throw new Error(`No tenant id resolved before ${where}`);
  if (plusUltraId && tenantId === plusUltraId) {
    throw new Error(`SAFETY ABORT: refusing to write to plus-ultra tenant at ${where}`);
  }
}

async function run() {
  if (DEMO.slug === PLUS_ULTRA_SLUG) throw new Error('SAFETY ABORT: demo slug equals plus-ultra');

  // Resolve plus-ultra id first so the guard has something to compare against.
  const { data: pu, error: puErr } = await sb
    .from('tenants').select('id').eq('slug', PLUS_ULTRA_SLUG).maybeSingle();
  if (puErr) throw puErr;
  plusUltraId = pu?.id || null;
  if (!plusUltraId) log('WARN: plus-ultra tenant not found; offer cloning will be skipped.');

  const tenantId = await upsertTenant();
  assertNotPlusUltra(tenantId, 'post-tenant');

  await upsertSettings(tenantId);
  await upsertOwnerUser(tenantId);
  const offerCount = await cloneOffers(tenantId);
  const customers = await upsertCustomers(tenantId);
  const estimate = await upsertSampleEstimate(tenantId, customers[0]);
  await upsertSampleProject(tenantId, customers[0], estimate);

  log('DONE.');
  log(`tenant=${tenantId} slug=${DEMO.slug} offers=${offerCount} customers=${customers.length}`);
  if (estimate?.share_token) {
    log(`proposal: https://ryujin-os.vercel.app/proposal-client.html?share=${estimate.share_token}`);
  }
}

// ── tenants ──────────────────────────────────────────────────────
async function upsertTenant() {
  const { data: existing } = await sb
    .from('tenants').select('id').eq('slug', DEMO.slug).maybeSingle();

  const row = {
    slug: DEMO.slug,
    name: DEMO.name,
    owner_email: DEMO.owner_email,
    plan: 'starter',
    active: true,
    is_sandbox: true,
    branding: { accent_color: DEMO.accent_color, tagline: DEMO.tagline },
  };

  if (existing) {
    log(`tenant exists (${existing.id}); updating branding fields`);
    if (!DRY_RUN) {
      const { error } = await sb.from('tenants').update(row).eq('id', existing.id);
      if (error) throw error;
    }
    return existing.id;
  }

  log('creating demo tenant');
  if (DRY_RUN) return '00000000-0000-0000-0000-000000000000';
  const { data, error } = await sb.from('tenants').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

// ── tenant_settings (unique per tenant) ──────────────────────────
async function upsertSettings(tenantId) {
  assertNotPlusUltra(tenantId, 'settings');
  const { data: existing } = await sb
    .from('tenant_settings').select('id').eq('tenant_id', tenantId).maybeSingle();

  // Branding only; every rate/margin/multiplier column has a sane default.
  const row = {
    tenant_id: tenantId,
    company_name: DEMO.name,
    company_phone: DEMO.company_phone,
    company_email: DEMO.company_email,
    company_website: DEMO.company_website,
    accent_color: DEMO.accent_color,
    tagline: DEMO.tagline,
    proposal_header: DEMO.proposal_header,
  };

  if (existing) {
    log('tenant_settings exists; updating branding');
    if (!DRY_RUN) {
      const { error } = await sb.from('tenant_settings').update(row).eq('id', existing.id);
      if (error) throw error;
    }
    return;
  }
  log('creating tenant_settings');
  if (DRY_RUN) return;
  const { error } = await sb.from('tenant_settings').insert(row);
  if (error) throw error;
}

// ── owner user ───────────────────────────────────────────────────
async function upsertOwnerUser(tenantId) {
  assertNotPlusUltra(tenantId, 'user');
  const email = DEMO.owner_email;
  const { data: existing } = await sb
    .from('users').select('id').eq('tenant_id', tenantId).eq('email', email).maybeSingle();
  if (existing) { log('owner user exists'); return; }
  log('creating owner user');
  if (DRY_RUN) return;
  const { error } = await sb.from('users').insert({
    tenant_id: tenantId, email, name: 'Demo Owner', role: 'owner', active: true,
  });
  if (error) throw error;
}

// ── offers: clone live from plus-ultra so they never drift ───────
async function cloneOffers(tenantId) {
  assertNotPlusUltra(tenantId, 'offers');
  if (!plusUltraId) { log('skip offers (no plus-ultra source)'); return 0; }

  const { data: src, error } = await sb
    .from('offers').select('*').eq('tenant_id', plusUltraId);
  if (error) throw error;
  if (!src?.length) { log('no plus-ultra offers to clone'); return 0; }

  let n = 0;
  for (const o of src) {
    const row = {
      tenant_id: tenantId,
      name: o.name, slug: o.slug, description: o.description, system: o.system,
      scope_template: o.scope_template, pricing_method: o.pricing_method,
      multipliers: o.multipliers, margin_floor: o.margin_floor,
      warranty_years: o.warranty_years, warranty_adder_per_sq: o.warranty_adder_per_sq,
      badge: o.badge, sort_order: o.sort_order, is_default: o.is_default, active: o.active,
    };
    const { data: ex } = await sb
      .from('offers').select('id').eq('tenant_id', tenantId).eq('slug', o.slug).maybeSingle();
    if (ex) {
      if (!DRY_RUN) { const { error: e } = await sb.from('offers').update(row).eq('id', ex.id); if (e) throw e; }
    } else {
      if (!DRY_RUN) { const { error: e } = await sb.from('offers').insert(row); if (e) throw e; }
    }
    n++;
  }
  log(`cloned ${n} offers from plus-ultra`);
  return n;
}

// ── sample customers ─────────────────────────────────────────────
async function upsertCustomers(tenantId) {
  assertNotPlusUltra(tenantId, 'customers');
  const seeds = [
    { full_name: 'Jordan Demo', email: 'jordan@example.demo', phone: '(506) 555-0201', address: '12 Maple Crescent', city: 'Moncton', source: 'website' },
    { full_name: 'Riley Demo', email: 'riley@example.demo', phone: '(506) 555-0202', address: '48 Birch Lane', city: 'Riverview', source: 'referral' },
  ];
  const out = [];
  for (const s of seeds) {
    const { data: ex } = await sb
      .from('customers').select('id').eq('tenant_id', tenantId).eq('full_name', s.full_name).maybeSingle();
    if (ex) { out.push({ id: ex.id, ...s }); continue; }
    if (DRY_RUN) { out.push({ id: '00000000-0000-0000-0000-000000000000', ...s }); continue; }
    const { data, error } = await sb.from('customers')
      .insert({ tenant_id: tenantId, province: 'NB', tags: ['demo'], ...s })
      .select('id').single();
    if (error) throw error;
    out.push({ id: data.id, ...s });
  }
  log(`customers ready: ${out.length}`);
  return out;
}

// ── sample estimate (published proposal so the demo renders) ─────
async function upsertSampleEstimate(tenantId, customer) {
  assertNotPlusUltra(tenantId, 'estimate');
  const SHARE = 'demo-roofing-sample';
  const { data: ex } = await sb
    .from('estimates').select('id, share_token').eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();
  if (ex) { log('sample estimate exists'); return ex; }
  if (DRY_RUN) { log('would create sample estimate'); return { share_token: SHARE }; }

  const calc = {
    gold:     { hardCost: 9500,  sellingPrice: 13965, hst: 2094.75, total: 16059.75 },
    platinum: { hardCost: 11200, sellingPrice: 17024, hst: 2553.60, total: 19577.60 },
    diamond:  { hardCost: 16800, sellingPrice: 26544, hst: 3981.60, total: 30525.60 },
  };
  const { data, error } = await sb.from('estimates').insert({
    tenant_id: tenantId, customer_id: customer.id,
    proposal_mode: 'Roof Only', pricing_model: 'Local',
    roof_area_sqft: 1800, roof_pitch: '6/12', complexity: 'medium',
    eaves_lf: 95, ridges_lf: 42, valleys_lf: 18, pipes: 2, vents: 3, chimneys: 1, distance_km: 8,
    calculated_packages: calc, selected_package: 'platinum',
    status: 'proposal_sent', share_token: SHARE,
    tags: ['demo'],
  }).select('id, share_token').single();
  if (error) throw error;
  log(`sample estimate ${data.id}`);
  return data;
}

// ── sample project ───────────────────────────────────────────────
async function upsertSampleProject(tenantId, customer, estimate) {
  assertNotPlusUltra(tenantId, 'project');
  const SHARE = 'demo-roofing-project';
  const { data: ex } = await sb
    .from('projects').select('id').eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();
  if (ex) { log('sample project exists'); return; }
  if (DRY_RUN) { log('would create sample project'); return; }
  const { error } = await sb.from('projects').insert({
    tenant_id: tenantId, customer_id: customer.id, estimate_id: estimate?.id || null,
    name: '12 Maple Crescent — Demo Reroof', address: '12 Maple Crescent', city: 'Moncton',
    status: 'active', share_token: SHARE, tags: ['demo'],
  });
  if (error) throw error;
  log('sample project created');
}

run().catch((e) => { console.error('[seed] FAILED:', e.message || e); process.exit(1); });
