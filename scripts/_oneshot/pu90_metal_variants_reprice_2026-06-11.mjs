// One-shot, PU-90 LeBlanc 652 Rue Principale, 2026-06-11.
// 1) Reprice metal-euro-clay with the CONFIRMED Atlantic Roll Forming June-1
//    sheet (clay 2.90/sqft +30pct, trim 5460) replacing the 2.23 placeholder.
// 2) Add metal-flat-panel priced from the G.A. Coles Community Metal rate
//    (1.58/sqft, barn trim 3500), same infra stack, same divisor 0.53.
// Both land in calculated_packages (drives proposal-v2 tiers) and in
// custom_prices._envelope.components.roof_metal.tiers (estimate of record).
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
if (!rm?.tiers?.length || !cp['metal-euro-clay']) throw new Error('metal scaffolding missing, aborting');

// Clay: 4070 sqft x 2.90 = 11803 panels, trim 5460, infra unchanged 17044.
// Direct 34307 / 0.53 = 64730 -> round25 64725 pre-tax.
cp['metal-euro-clay'] = { ...cp['metal-euro-clay'], total: 64725 };

// Flat panel: 4070 x 1.58 = 6431 panels, trim 3500, infra 17044.
// Direct 26975 / 0.53 = 50896 -> round25 50900 pre-tax.
cp['metal-flat-panel'] = { total: 50900, persq: 0, summary: { measuredSQ: 36.5 } };

rm.label = 'Metal Roof Options';
const clay = rm.tiers.find(t => t.slug === 'euro-clay');
if (!clay) throw new Error('euro-clay tier missing');
clay.hard = 34307;
clay.price = 64725;
clay._calc = {
  ...clay._calc,
  note: 'Repriced 2026-06-11: ARF June-1 2026 +30pct CONFIRMED (Mary 41 Bridge St reseed precedent). Clay 2.90/sqft, trim 5460. Replaces 2.23 SOP placeholder run; infra stack unchanged.',
  direct: { ...clay._calc.direct, panels: 11803, trim_accessories: 5460 },
  directTotal: 34307,
  clay_per_sqft: 2.90
};

if (!rm.tiers.some(t => t.slug === 'flat-panel')) {
  rm.tiers.push({
    hard: 26975,
    slug: 'flat-panel',
    tier: 1,
    _calc: {
      note: 'Added 2026-06-11 per Mac: toggle alternative priced off G.A. Coles Community Metal 4.75/lin sheet-ft ~ 1.58/sqft + barn trim 3500 (Mary 41 Bridge St Community Barn precedent). Same infra + labor stack as euro-clay run.',
      pitch: '8/12',
      direct: {
        panels: 6431,
        disposal: 350,
        ice_water: 650,
        strapping: 2035,
        snow_guards: 750,
        mobilization: 600,
        underlayment: 1184,
        chimney_flash: 375,
        labor_install: 11100,
        trim_accessories: 3500
      },
      method: 'additive_cost_stack',
      divisor: 0.53,
      labor_band: 'moderate@300',
      order_sqft: 4070,
      sq_charged: 37,
      directTotal: 26975,
      panel_per_sqft: 1.58
    },
    label: 'Flat Panel Exposed Fastener',
    price: 50900,
    popular: false,
    subtitle: 'Classic flat steel panel with colour-matched gasketed fasteners, installed straight over your existing roof on a strapped batten system. No tear-off, no redeck.',
    warranty_label: 'Lifetime panel, 15-yr workmanship, 50+ yr service life'
  });
}

const body = { id: ID, calculated_packages: cp, custom_prices: est.custom_prices };
const put = await fetch(`${BASE}/api/estimates?id=${ID}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
if (!put.ok) throw new Error(`PUT ${put.status}: ${(await put.text()).slice(0, 500)}`);
console.log('PUT ok', put.status);

const check = await getEst();
const ccp = check.calculated_packages || {};
const crm = check.custom_prices?._envelope?.components?.roof_metal;
console.log('VERIFY packages:', Object.fromEntries(Object.entries(ccp).map(([k, v]) => [k, v.total])));
console.log('VERIFY roof_metal tiers:', (crm?.tiers || []).map(t => `${t.slug}=${t.price}`).join(', '));
