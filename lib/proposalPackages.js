// Ryujin OS - Proposal package catalog (asphalt tiers) + DB-backed loader.
//
// Single source of truth for the Gold/Platinum/Diamond proposal tiers the
// few-click proposal wizard (proposal-wizard.html, Order 4) renders as cards.
//
// CANONICAL_PACKAGES is a verbatim mirror of the asphalt TIER_CATALOG that
// api/proposal-v2.js + api/proposal.js render today (same tag/name/warranty/
// perks), so a proposal sourced from this loader looks byte-identical to a
// proposal rendered from the live copy. It is BOTH the seed source
// (scripts/seed-proposal-packages.mjs) AND the fallback when the
// proposal_packages table (migration 099) is empty or not yet applied.
//
// The supabase import is lazy on purpose: importing CANONICAL_PACKAGES (pure
// data) must not pull in supabase env, so the seed script can read it offline.

export const CANONICAL_PACKAGES = [
  {
    system: 'asphalt',
    slug: 'gold',
    tier_tag: 'GOOD',
    name: 'Gold · Landmark',
    description: 'CertainTeed Landmark architectural shingle. The industry standard.',
    shingle_product: 'CertainTeed Landmark',
    warranty_years: 15,
    perks: [
      'CertainTeed Landmark shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '15-yr Plus Ultra workmanship warranty',
      'Full tear-off + synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Drip edge, pipe boots, step flashing'
    ],
    multiplier: 1.47,
    is_recommended: false,
    sort_order: 1
  },
  {
    system: 'asphalt',
    slug: 'platinum',
    tier_tag: 'BETTER',
    name: 'Platinum · Landmark Pro',
    description: 'CertainTeed Landmark Pro with Max Def color, Grace ice shield, Roof Runner synthetic upgrade.',
    shingle_product: 'CertainTeed Landmark Pro',
    warranty_years: 20,
    perks: [
      'CertainTeed Landmark Pro (Max Def) shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '20-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield upgrade',
      'Roof Runner synthetic underlayment upgrade',
      'Drip edge, pipe boots, step flashing'
    ],
    multiplier: 1.52,
    is_recommended: true,
    sort_order: 2
  },
  {
    system: 'asphalt',
    slug: 'diamond',
    tier_tag: 'BEST',
    name: 'Diamond · Grand Manor',
    description: 'CertainTeed Grand Manor, Super Shangle 5-layer construction with authentic slate profile.',
    shingle_product: 'CertainTeed Grand Manor',
    warranty_years: 25,
    perks: [
      'CertainTeed Grand Manor designer shingles',
      'Super Shangle 5-layer construction',
      'Streakfighter algae protection',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart full coverage (certified installer)',
      '25-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield + Roof Runner synthetic',
      'Priority scheduling'
    ],
    multiplier: 1.58,
    is_recommended: false,
    sort_order: 3
  }
];

// multiplier values are the Local-model base (Gold 1.47 / Plat 1.52 / Diamond
// 1.58, per the verified quote-engine breakdown). They are reference only: the
// wizard pulls LIVE per-job prices from /api/quote?mode=compare, which applies
// the correct model multiplier (Local / Day Trip / Extended Stay) at quote time.

function fallback(system) {
  return CANONICAL_PACKAGES.filter(p => p.system === system);
}

// Load a tenant's active proposal packages for a system, newest schema first,
// falling back to the canonical catalog if the table is empty / unmigrated /
// errors. Always returns a non-empty array for a known system.
export async function getProposalPackages(tenantId, system = 'asphalt') {
  try {
    const { supabaseAdmin } = await import('./supabase.js');
    const { data, error } = await supabaseAdmin
      .from('proposal_packages')
      .select('system, slug, tier_tag, name, description, shingle_product, warranty_years, perks, multiplier, is_recommended, sort_order')
      .eq('tenant_id', tenantId)
      .eq('system', system)
      .eq('active', true)
      .order('sort_order');
    if (error) return fallback(system);
    if (!data || data.length === 0) return fallback(system);
    return data;
  } catch {
    return fallback(system);
  }
}
