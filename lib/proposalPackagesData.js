// lib/proposalPackagesData.js - the canonical proposal tier catalog (pure data).
//
// Single source of truth for both the runtime fallback (lib/proposalPackages.js)
// and the DB seed (scripts/seed-proposal-packages.mjs). Pure data, NO imports, so
// the seed can read it without pulling in the supabase client.
//
// Verbatim mirror of api/proposal.js TIER_CATALOG (gold / platinum / diamond),
// plus the per-tier Plus Ultra workmanship warranty years (15 / 20 / 25), the
// local hard-cost sell multipliers (1.47 / 1.52 / 1.58 per PRICING.md +
// pricing_formula_v2), and Platinum flagged recommended (preselected). The perks
// strings are copied byte-for-byte from TIER_CATALOG; keep them IN SYNC until the
// two sources are unified (see the follow-up note in lib/proposalPackages.js).
//
// No em dashes.

export const FALLBACK_PACKAGES = [
  {
    system: 'asphalt', slug: 'gold', tier_tag: 'GOOD', name: 'Gold · Landmark',
    shingle_product: 'CertainTeed Landmark', warranty_years: 15, multiplier: 1.47,
    is_recommended: false, active: true, sort_order: 1,
    perks: [
      'CertainTeed Landmark shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '15-yr Plus Ultra workmanship warranty',
      'Full tear-off + synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  {
    system: 'asphalt', slug: 'platinum', tier_tag: 'BETTER', name: 'Platinum · Landmark Pro',
    shingle_product: 'CertainTeed Landmark Pro', warranty_years: 20, multiplier: 1.52,
    is_recommended: true, active: true, sort_order: 2,
    perks: [
      'CertainTeed Landmark Pro (Max Def) shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '20-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield upgrade',
      'Roof Runner synthetic underlayment upgrade',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  {
    system: 'asphalt', slug: 'diamond', tier_tag: 'BEST', name: 'Diamond · Grand Manor',
    shingle_product: 'CertainTeed Grand Manor', warranty_years: 25, multiplier: 1.58,
    is_recommended: false, active: true, sort_order: 3,
    perks: [
      'CertainTeed Grand Manor designer shingles',
      'Super Shangle® 5-layer construction',
      'Streakfighter® algae protection',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage (certified installer)',
      '25-yr Plus Ultra workmanship warranty',
      'Grace ice & water shield + Roof Runner synthetic',
      'Priority scheduling'
    ]
  }
];
