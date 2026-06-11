// Canonical metal proposal copy. Source of truth: Plus Ultra/Sales/metal packages summary.docx
// Keyed by both DB offer slug (metal-americana / metal-standing-seam / metal-premium) and
// canonical install rank (metal-standard / metal-enhanced / metal-premium) so the renderer
// works whether the estimate carries DB slugs or canonical aliases.

const STANDARD = {
  rank: 'standard',
  tag: 'STANDARD INSTALLATION',
  name: 'Standard Installation',
  subtitle: 'Installed over existing shingles using roof strapping',
  warrantyYears: 15,
  warrantyLabel: '15-year warranty',
  bullets: [
    'Metal roofing installed over existing shingles',
    'Wood strapping installed for fastening + airflow',
    'Manufacturer-approved fastening method',
    'Ameri-Cana ribbed steel panels — your colour choice',
    'Pre-bent chimney + pipe flashings',
    'Full perimeter trim: drip edge, ridge cap, V-style open metal valley',
    'Butyl tape and screw seals at every fastener',
    'Standard workmanship warranty (15-year)',
    'Mobilization and travel premium included'
  ],
  bestFit: 'Best fit if your existing shingles are flat, single-layer, and the deck is sound.'
};

const ENHANCED = {
  rank: 'enhanced',
  tag: 'ENHANCED INSTALLATION',
  name: 'Enhanced Installation',
  subtitle: 'Installed after shingle removal and deck inspection',
  warrantyYears: 20,
  warrantyLabel: '20-year warranty',
  bullets: [
    'Existing shingles removed',
    'Roof deck inspected and repaired as needed',
    'High-temperature underlayment installed across full deck',
    'Ventilated air space + Ameri-Cana ribbed steel panels — your colour choice',
    'Grace Ice & Water shield — full deck coverage',
    'Peel-and-stick deck seal under the system',
    'All perimeter trim, ridge, valley, drip edge',
    'Pre-bent chimney + pipe flashings',
    'Disposal and clean-up included',
    '20-year manufacturer + workmanship warranty',
    'Mobilization and travel premium included'
  ],
  bestFit: 'The right call when you want it done properly once. Inspectable deck, full waterproofing, no shortcuts.'
};

const PREMIUM = {
  rank: 'premium',
  tag: 'PREMIUM INSTALLATION',
  name: 'Premium Installation',
  subtitle: 'Installed over new roof sheathing and sealed deck',
  warrantyYears: 25,
  warrantyLabel: '25-year warranty · maximum eligibility',
  bullets: [
    'Full tear-off down to existing deck',
    'NEW 7/16 OSB roof sheathing installed across entire roof',
    'Deck sealed + high-temperature underlayment, full coverage',
    'Vic West snap-lock concealed-fastener panels (NOT standing seam — no machine roll-forming, no mechanical seams)',
    'Grace Ice & Water shield — full deck coverage',
    'Peel-and-stick deck seal under the system',
    'Pre-bent chimney flashing + counter-flashing detail for concealed-fastener panel',
    'Custom-bent ridge, eave, gable trim',
    'Disposal and clean-up included',
    'Maximum manufacturer warranty eligibility (25-year + workmanship)',
    'Mobilization and travel premium included'
  ],
  bestFit: 'Top of the system. Snap-lock concealed-fastener panels, lifetime-class warranty, fresh deck under it all.'
};

const EURO_CLAY = {
  rank: 'designer',
  tag: 'METAL OPTION',
  name: 'European Clay Metal',
  subtitle: 'Designer steel panel, installed over your existing roof',
  warrantyYears: 15,
  warrantyLabel: 'Lifetime panel warranty · 15-year workmanship',
  bullets: [
    'Lifetime panel warranty',
    '15-year Plus Ultra workmanship warranty',
    '50-plus year service life',
    'Strapped batten system, no tear-off, no landfill',
    'High-temperature underlayment',
    'Ice and water shield, eaves and valleys',
    'Full ridge, hip and rake trims',
    'Snow guards over entries',
    'Full chimney flashing'
  ],
  bestFit: 'The roof you install once and forget about. A premium panel that reads like European clay tile, in a deep, rich profile.'
};

export const METAL_TIER_COPY = {
  'metal-standard': STANDARD,
  'metal-americana': STANDARD,
  'metal-enhanced': ENHANCED,
  'metal-standing-seam': ENHANCED,
  'metal-premium': PREMIUM,
  'metal-euro-clay': EURO_CLAY
};

export const METAL_INCLUDED_ALL = [
  'Two-day pre-install site visit + measurement check',
  'CompanyCam photo album (50–100+ photos)',
  'Licensed and operating in New Brunswick',
  'Daily site clean-up and magnetic nail sweep',
  'Final walkthrough with you on completion',
  'HST at 15% included in displayed price'
];

export function isMetalSlug(slug) {
  return typeof slug === 'string' && slug.toLowerCase().startsWith('metal-');
}

export function getMetalCopy(slug) {
  return METAL_TIER_COPY[String(slug || '').toLowerCase()] || null;
}
