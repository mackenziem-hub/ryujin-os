// ═══════════════════════════════════════════════════════════════
// Clone the default offer catalog into a tenant (GAP-A / TENANT_GAPS GAP-1).
//
// A brand-new tenant has ZERO offers. `offers` is tenant-scoped
// (unique(tenant_id, slug)) and is seeded only for plus-ultra across
// migrations 005/006/008/027, so without this a new tenant's quote engine has
// no scope templates and cannot generate a single quote or proposal. This lifts
// the offer-cloning logic out of scripts/seed-demo-tenant.mjs so the same code
// runs at real tenant creation (api/tenants.js) and in the demo seed.
//
// Faithful copy: every offer column except identity/ownership/timestamps is
// carried over (scope_template, multipliers, margin_floors, warranty,
// offer_category, has_estimated_pricing, ...), so schema additions ride along
// without an allow-list. scope_template product_ids are platform-global
// (TENANT_GAPS GAP-7), so the clone needs no remapping.
//
// Idempotent: upserts by (tenant_id, slug). A re-run updates rather than
// duplicates. Hard guard: never clones a tenant's offers onto itself.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

const DEFAULT_SOURCE_SLUG = 'plus-ultra';

// Clone the offer set from the source tenant (default plus-ultra) into tenantId.
// opts: { sb, dryRun, sourceSlug, log }. Returns a summary object; throws on a
// real DB error or a safety-guard violation so the caller can fail loudly.
export async function cloneDefaultOffers(tenantId, opts = {}) {
  const sb = opts.sb || supabaseAdmin;
  const dryRun = !!opts.dryRun;
  const sourceSlug = opts.sourceSlug || DEFAULT_SOURCE_SLUG;
  const log = typeof opts.log === 'function' ? opts.log : () => {};

  if (!tenantId) throw new Error('cloneDefaultOffers: tenantId is required');

  // Resolve the source tenant id so the self-clone guard has something to check.
  const { data: src, error: srcErr } = await sb
    .from('tenants').select('id').eq('slug', sourceSlug).maybeSingle();
  if (srcErr) throw srcErr;
  const sourceId = src && src.id;
  if (!sourceId) {
    log(`cloneDefaultOffers: source tenant '${sourceSlug}' not found; skipping`);
    return { cloned: 0, inserted: 0, updated: 0, skipped: true, reason: `source '${sourceSlug}' not found` };
  }

  // Hard guard: never write a tenant's offers onto itself (would mutate the
  // source catalog under the guise of a clone).
  if (String(tenantId) === String(sourceId)) {
    throw new Error(`cloneDefaultOffers SAFETY ABORT: target tenant equals source '${sourceSlug}'`);
  }

  const { data: offers, error: readErr } = await sb
    .from('offers').select('*').eq('tenant_id', sourceId);
  if (readErr) throw readErr;
  if (!offers || !offers.length) {
    log(`cloneDefaultOffers: source '${sourceSlug}' has no offers to clone`);
    return { cloned: 0, inserted: 0, updated: 0, skipped: true, reason: 'source has no offers' };
  }

  let inserted = 0, updated = 0;
  for (const o of offers) {
    // Drop identity/ownership/timestamps; keep every other column verbatim.
    const { id, tenant_id, created_at, updated_at, ...rest } = o;
    const row = { ...rest, tenant_id: tenantId };

    const { data: ex, error: exErr } = await sb
      .from('offers').select('id').eq('tenant_id', tenantId).eq('slug', o.slug).maybeSingle();
    if (exErr) throw exErr;

    if (ex) {
      if (!dryRun) {
        const { error } = await sb.from('offers').update(row).eq('id', ex.id);
        if (error) throw error;
      }
      updated++;
    } else {
      if (!dryRun) {
        const { error } = await sb.from('offers').insert(row);
        if (error) throw error;
      }
      inserted++;
    }
  }

  const cloned = inserted + updated;
  log(`cloneDefaultOffers: ${cloned} offers (${inserted} new, ${updated} updated) from '${sourceSlug}' -> ${tenantId}${dryRun ? ' [dry-run]' : ''}`);
  return { cloned, inserted, updated, sourceId, skipped: false };
}
