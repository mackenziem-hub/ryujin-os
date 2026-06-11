// One-shot, PU-90 LeBlanc 652 Rue Principale, 2026-06-11 PM.
// Mac locked the metal lineup: flat panel (Coles Community) in the canonical
// Standard / Enhanced / Premium installation grades. European Clay retired
// ("way too expensive now for what it does"). Replaces metal-euro-clay +
// metal-flat-panel packages with metal-standard / metal-enhanced /
// metal-premium, and mirrors the envelope roof_metal tiers.
//
// Pricing (PRICING.md divisor method, order_sqft 4070, 37 SQ charged, 8/12
// moderate labor @300/SQ):
//   Standard  divisor 0.53: direct 26,975 -> $50,900 pre-tax (unchanged flat build)
//   Enhanced  divisor 0.50: + tear-off 37SQx$40 + Grace full deck 19x$178 +
//             day-trip disposal 450 -> direct 31,287 -> $62,575 pre-tax
//   Premium   divisor 0.48: + redeck 5,500 (this estimate's envelope number) +
//             Vic West snap-lock 4.50/sqft ESTIMATED + custom trim 5,000
//             ESTIMATED + counter-flash 680, no strapping -> direct 48,441 ->
//             $100,925 pre-tax
import fs from 'node:fs';

const ENV = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env';
const token = fs.readFileSync(ENV, 'utf8').match(/^RYUJIN_SERVICE_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('RYUJIN_SERVICE_TOKEN not found in _brain/.env');

const BASE = 'https://ryujin-os.vercel.app';
const H = { Authorization: `Bearer ${token}`, 'x-tenant-id': 'plus-ultra', 'Content-Type': 'application/json' };
const ID = '3119cbd4-bddd-42e3-95e3-7725e2b9cc14';

async function getEst() {
  const r = await fetch(`${BASE}/api/estimates?id=${ID}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.estimate || j;
}

const est = await getEst();
const cp = est.calculated_packages || {};
const rm = est.custom_prices?._envelope?.components?.roof_metal;
if (!rm || !cp['metal-euro-clay'] || !cp['metal-flat-panel']) throw new Error('expected metal scaffolding missing, aborting');

delete cp['metal-euro-clay'];
delete cp['metal-flat-panel'];

cp['metal-standard'] = {
  total: 50900,
  persq: 0,
  warranty_years: 15,
  summary: { measuredSQ: 36.5 },
  perks: [
    'Flat panel exposed-fastener steel, your colour choice',
    'Lifetime panel warranty',
    '15-year Plus Ultra workmanship warranty',
    '50-plus year service life',
    'Strapped batten system, no tear-off, no landfill',
    'High-temperature underlayment',
    'Ice and water shield, eaves and valleys',
    'Full ridge, hip and rake trims',
    'Colour-matched gasketed fasteners',
    'Snow guards over entries',
    'Full chimney flashing'
  ]
};

cp['metal-enhanced'] = {
  total: 62575,
  persq: 0,
  warranty_years: 20,
  summary: { measuredSQ: 36.5 },
  perks: [
    'Flat panel exposed-fastener steel, your colour choice',
    'Existing shingles removed, deck inspected and repaired as needed',
    'Grace Ice and Water shield, full deck coverage',
    'High-temperature underlayment across the full deck',
    'Ventilated strapping system under the panels',
    'Full ridge, hip and rake trims',
    'Colour-matched gasketed fasteners',
    'Snow guards over entries',
    'Full chimney flashing',
    'Disposal and clean-up included',
    '20-year Plus Ultra workmanship warranty'
  ]
};

cp['metal-premium'] = {
  total: 100925,
  persq: 0,
  warranty_years: 25,
  summary: { measuredSQ: 36.5 },
  perks: [
    'Vic West snap-lock concealed-fastener panels, no exposed screws',
    'Full tear-off plus NEW 7/16 OSB sheathing across the entire roof',
    'Grace Ice and Water shield, full deck coverage',
    'High-temperature underlayment across the full deck',
    'Custom-bent ridge, eave and gable trim',
    'Chimney flashing with counter-flash detail',
    'Snow guards over entries',
    'Disposal and clean-up included',
    '25-year warranty, maximum manufacturer eligibility'
  ]
};

rm.label = 'Metal Roof System';
rm.tiers = [
  {
    slug: 'standard',
    tier: 1,
    label: 'Standard Installation',
    subtitle: 'Flat panel exposed-fastener steel installed over your existing roof on a strapped batten system. No tear-off, no redeck.',
    warranty_label: 'Lifetime panel, 15-yr workmanship',
    hard: 26975,
    price: 50900,
    _calc: {
      note: 'Grade ladder 2026-06-11 per Mac: flat panel (G.A. Coles Community Metal 1.58/sqft, Mary 41 Bridge St precedent) in Standard/Enhanced/Premium grades; euro-clay retired. Same stack as the prior metal-flat-panel run.',
      pitch: '8/12',
      method: 'additive_cost_stack',
      divisor: 0.53,
      labor_band: 'moderate@300',
      order_sqft: 4070,
      sq_charged: 37,
      panel_per_sqft: 1.58,
      direct: {
        panels: 6431,
        trim_accessories: 3500,
        labor_install: 11100,
        strapping: 2035,
        underlayment: 1184,
        ice_water: 650,
        snow_guards: 750,
        disposal: 350,
        mobilization: 600,
        chimney_flash: 375
      },
      directTotal: 26975
    }
  },
  {
    slug: 'enhanced',
    tier: 2,
    label: 'Enhanced Installation',
    popular: true,
    subtitle: 'Shingles removed, deck inspected and repaired, Grace Ice and Water across the full deck, then the same flat panel system on ventilated strapping.',
    warranty_label: 'Lifetime panel, 20-yr workmanship',
    hard: 31287,
    price: 62575,
    _calc: {
      note: 'Enhanced grade 2026-06-11: Standard stack + tear-off 37SQ x $40/SQ (PRICING.md layer-tear rate) + Grace I&W full deck 19 rolls x $178 (replaces eaves/valley 650) + disposal day-trip 450. Divisor 0.50 per PRICING.md Enhanced.',
      pitch: '8/12',
      method: 'additive_cost_stack',
      divisor: 0.50,
      labor_band: 'moderate@300',
      order_sqft: 4070,
      sq_charged: 37,
      panel_per_sqft: 1.58,
      direct: {
        panels: 6431,
        trim_accessories: 3500,
        labor_install: 11100,
        tear_off: 1480,
        strapping: 2035,
        underlayment: 1184,
        ice_water_full_deck: 3382,
        snow_guards: 750,
        disposal: 450,
        mobilization: 600,
        chimney_flash: 375
      },
      directTotal: 31287
    }
  },
  {
    slug: 'premium',
    tier: 3,
    label: 'Premium Installation',
    subtitle: 'Full tear-off, new 7/16 OSB across the entire roof, sealed deck, and Vic West snap-lock concealed-fastener panels. No exposed screws anywhere.',
    warranty_label: '25-yr, maximum eligibility',
    hard: 48441,
    price: 100925,
    _calc: {
      note: 'Premium grade 2026-06-11: tear-off + redeck 5500 (this estimate envelope prep_redeck, ~110 sheets 7/16 OSB) + Vic West snap-lock concealed panels at 4.50/sqft ESTIMATED (between Americana 2.80 and standing seam 5.50-6.50; NO supplier quote yet) + custom concealed-fastener trim 5000 ESTIMATED + chimney counter-flash 680 (envelope addon rate). No strapping: panels go direct over sealed new deck. Divisor 0.48 per PRICING.md Premium. REPRICE once Vic West quote lands.',
      pitch: '8/12',
      method: 'additive_cost_stack',
      divisor: 0.48,
      labor_band: 'moderate@300',
      order_sqft: 4070,
      sq_charged: 37,
      panel_per_sqft_estimated: 4.50,
      direct: {
        panels: 18315,
        trim_accessories: 5000,
        labor_install: 11100,
        tear_off: 1480,
        redeck: 5500,
        underlayment: 1184,
        ice_water_full_deck: 3382,
        snow_guards: 750,
        disposal: 450,
        mobilization: 600,
        chimney_flash: 680
      },
      directTotal: 48441
    }
  }
];

const body = { id: ID, calculated_packages: cp, custom_prices: est.custom_prices };
const put = await fetch(`${BASE}/api/estimates?id=${ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
if (!put.ok) throw new Error(`PUT ${put.status}: ${(await put.text()).slice(0, 500)}`);
console.log('PUT ok', put.status);

const check = await getEst();
const ccp = check.calculated_packages || {};
const crm = check.custom_prices?._envelope?.components?.roof_metal;
console.log('VERIFY packages:', Object.fromEntries(Object.entries(ccp).map(([k, v]) => [k, v.total])));
console.log('VERIFY roof_metal tiers:', (crm?.tiers || []).map(t => `${t.slug}=${t.price}`).join(', '));
