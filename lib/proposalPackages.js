// lib/proposalPackages.js - load a tenant's proposal tier packages.
//
// The few-click wizard (proposal-wizard.html) and GET /api/proposal-packages read
// tiers from the proposal_packages table (migration 099). Until that table is
// seeded for a tenant, this loader returns the canonical FALLBACK_PACKAGES (a
// verbatim mirror of api/proposal.js TIER_CATALOG, kept in lib/proposalPackagesData.js
// so the seed and the fallback share one source). Nothing renders differently
// until a tenant deliberately seeds + adopts the table.
//
// Follow-up (NOT this change): export TIER_CATALOG from the shared data module and
// have api/proposal.js import it, to remove the verbatim copy and its drift risk.
// For now the renderer is untouched (zero regression); this is additive scaffolding.
//
// No em dashes.

import { supabaseAdmin } from './supabase.js';
import { FALLBACK_PACKAGES } from './proposalPackagesData.js';

export { FALLBACK_PACKAGES };

// Return a tenant's proposal packages. Reads the proposal_packages table; if the
// table is empty for this tenant (or the read fails / the table is not migrated
// yet), returns FALLBACK_PACKAGES so callers always get the canonical tiers.
// Optional `system` filter (e.g. 'asphalt'). source = 'db' | 'fallback'.
export async function loadProposalPackages(tenantId, system) {
  if (tenantId) {
    try {
      let q = supabaseAdmin
        .from('proposal_packages')
        .select('system, slug, tier_tag, name, shingle_product, warranty_years, perks, multiplier, is_recommended, sort_order')
        .eq('tenant_id', tenantId)
        .eq('active', true);
      if (system) q = q.eq('system', String(system));
      const { data, error } = await q.order('sort_order', { ascending: true });
      if (!error && Array.isArray(data) && data.length) {
        return { packages: data, source: 'db' };
      }
    } catch (e) {
      // fall through to the in-code fallback
    }
  }
  const fb = system ? FALLBACK_PACKAGES.filter(p => p.system === String(system)) : FALLBACK_PACKAGES;
  return { packages: fb, source: 'fallback' };
}
