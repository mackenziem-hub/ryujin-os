// ═══════════════════════════════════════════════════════════════
// Seed a sample published proposal into a freshly provisioned tenant
// (sell-readiness Phase 0: the signup -> branded-proposal promise).
//
// A brand-new tenant has offers (cloneDefaultOffers / GAP-A) but ZERO
// estimates, so there is nothing for /api/proposal to render. Without a
// sample estimate, "signup to a rendered branded proposal with no manual
// steps" lands on an empty screen. This lifts the sample-customer +
// sample-estimate logic out of scripts/seed-demo-tenant.mjs so the same code
// runs at real tenant creation (api/tenants.js) and in the demo seed, exactly
// the pattern lib/cloneOffers.js established.
//
// Branding-neutral: the estimate carries no brand of its own — /api/proposal
// resolves the company name, accent, rep, etc. from THIS tenant's
// tenant_settings, so the sample renders in the tenant's own identity.
//
// Idempotent: keyed by share_token `${slug}-sample`. A re-run returns the
// existing estimate rather than duplicating (share_token is UNIQUE). Hard
// guard: never seeds the plus-ultra tenant (tenant 1) with sample data.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

// Representative mid-size reroof so all three tier cards render with real
// numbers. Same shape the demo seed uses (calculated_packages with flat
// total/sellingPrice/hst), which the proposal tier builder already reads.
const SAMPLE_CALC = {
  gold:     { hardCost: 9500,  sellingPrice: 13965, hst: 2094.75, total: 16059.75 },
  platinum: { hardCost: 11200, sellingPrice: 17024, hst: 2553.60, total: 19577.60 },
  diamond:  { hardCost: 16800, sellingPrice: 26544, hst: 3981.60, total: 30525.60 },
};

const SAMPLE_CUSTOMER_NAME = 'Sample Customer';

// Seed a sample customer + published estimate for tenantId. opts: { sb, slug,
// dryRun, log }. slug is required (it keys the share token). Returns
// { share_token, estimateId, customerId, created }. Throws only on a real DB
// error or the plus-ultra safety guard, so the caller can decide whether a
// failed sample seed should fail provisioning (it should not).
export async function seedSampleProposal(tenantId, opts = {}) {
  const sb = opts.sb || supabaseAdmin;
  const slug = opts.slug;
  const dryRun = !!opts.dryRun;
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  if (!tenantId) throw new Error('seedSampleProposal: tenantId is required');
  if (!slug) throw new Error('seedSampleProposal: slug is required (keys the share token)');

  // Hard guard: never seed plus-ultra (tenant 1) with sample/demo data.
  const { data: src, error: srcErr } = await sb
    .from('tenants').select('slug').eq('id', tenantId).maybeSingle();
  if (srcErr) throw srcErr;
  if (src && src.slug === 'plus-ultra') {
    throw new Error('seedSampleProposal SAFETY ABORT: refusing to seed the plus-ultra tenant');
  }

  const shareToken = `${slug}-sample`;

  // Idempotent: if the sample estimate already exists, return it untouched.
  const { data: exEst, error: exErr } = await sb
    .from('estimates').select('id, share_token').eq('tenant_id', tenantId).eq('share_token', shareToken).maybeSingle();
  if (exErr) throw exErr;
  if (exEst) {
    log(`seedSampleProposal: sample estimate exists (${exEst.id})`);
    return { share_token: exEst.share_token, estimateId: exEst.id, customerId: null, created: false };
  }
  if (dryRun) {
    log('seedSampleProposal: would seed sample customer + estimate [dry-run]');
    return { share_token: shareToken, estimateId: null, customerId: null, created: false, dryRun: true };
  }

  // Sample customer (idempotent by full_name within the tenant).
  let customerId;
  const { data: exCust, error: exCustErr } = await sb
    .from('customers').select('id').eq('tenant_id', tenantId).eq('full_name', SAMPLE_CUSTOMER_NAME).maybeSingle();
  if (exCustErr) throw exCustErr;
  if (exCust) {
    customerId = exCust.id;
  } else {
    const { data: cust, error: custErr } = await sb.from('customers').insert({
      tenant_id: tenantId,
      full_name: SAMPLE_CUSTOMER_NAME,
      email: 'sample@example.demo',
      phone: '(506) 555-0100',
      address: '12 Sample Street',
      city: 'Moncton',
      province: 'NB',
      source: 'sample',
      tags: ['sample'],
    }).select('id').single();
    if (custErr) throw custErr;
    customerId = cust.id;
  }

  // Sample published estimate. status proposal_sent + share_token makes
  // /api/proposal render it immediately; calculated_packages drives the tiers.
  const { data: est, error: estErr } = await sb.from('estimates').insert({
    tenant_id: tenantId,
    customer_id: customerId,
    proposal_mode: 'Roof Only',
    pricing_model: 'Local',
    roof_area_sqft: 1800,
    roof_pitch: '6/12',
    complexity: 'medium',
    eaves_lf: 95, ridges_lf: 42, valleys_lf: 18, pipes: 2, vents: 3, chimneys: 1, distance_km: 8,
    calculated_packages: SAMPLE_CALC,
    selected_package: 'platinum',
    status: 'proposal_sent',
    share_token: shareToken,
    tags: ['sample'],
  }).select('id, share_token').single();
  if (estErr) throw estErr;

  log(`seedSampleProposal: sample estimate ${est.id} (share ${est.share_token})`);
  return { share_token: est.share_token, estimateId: est.id, customerId, created: true };
}
