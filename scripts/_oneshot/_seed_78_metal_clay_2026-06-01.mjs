// Seed the European Clay Imitation metal road onto Mary O'Brien's #78 envelope
// (estimate id 179cacdc..., share plus-ultra-78). Adds:
//   - roof_metal component with one clay-imitation tier, priced via the SOP
//     additive cost-stack divisor (Metal Roofing Pricing Logic SOP), strap
//     over the existing roof (no tear-off / no redeck), pad snow guards incl.
//   - show_systems ['asphalt','metal'], default_system stays 'asphalt'
//   - default_selections.asphalt.roofPrep.redeck = true  (recommended standard)
//   - systems:['asphalt'] on prep_redeck + remediation (so they DON'T apply to
//     the over-shingle metal road)
//
// Idempotent: re-running overwrites the metal block + flags with the same values.
// READ-ONLY everything else — preserves media, asphalt tiers, siding, trim.
//
// CLAY PANEL COST IS A PLACEHOLDER ($2.23/sqft, SOP reference). Atlantic Roll
// Forming issued a price increase effective June 1 2026 (PDF attachment) — swap
// CLAY_PER_SQFT to the confirmed number and re-run; price recomputes, no deploy.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const mm = line.match(/^([A-Z_]+)=(.*)$/);
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const EST_ID = '179cacdc-a4cd-48c5-91ba-b65930c7fd32';

// ── European Clay Imitation — additive cost-stack direct-cost build-up ──
// Mary: 34 SQ charged (order 37.4 @ +10% waste), 14/12 steep mains + 4/12
// porches, 2 chimneys (steel+brick), 60 km, install OVER the existing roof.
const SQ_CHARGED = 34;
const ORDER_SQFT = SQ_CHARGED * 100 * 1.10;        // 3,740 sqft material order area
const CLAY_PER_SQFT = 2.23;                         // SOP placeholder — confirm ARF June-1 price
const DIVISOR = 0.53;                               // Standard package, 12% net (1 - 0.35 - 0.12)

const direct = {
  panels:        Math.round(ORDER_SQFT * CLAY_PER_SQFT),   // clay-imitation metal tiles
  strapping:     Math.round(SQ_CHARGED * 100 * 0.55),      // batten/strap over existing roof
  underlayment:  Math.round(SQ_CHARGED * 100 * 0.32),      // high-temp synthetic slip sheet
  ice_water:     650,                                       // eaves + valleys
  trim_accessories: 4200,                                   // ridge/hip/valley/eave/rake caps, closures, fasteners, sealant
  snow_guards:   750,                                       // pad-style, lower courses + over entries
  chimney_flash: 750,                                       // 2 chimneys (steel + masonry) flashing/crickets
  disposal:      350,                                        // minimal (no tear-off)
  labor_install: Math.round(SQ_CHARGED * 350),             // 14/12 steep, complex, 2 chimneys
  mobilization:  1200                                        // 60 km day-trip
};
const directTotal = Object.values(direct).reduce((s, v) => s + v, 0);
const rawSell = directTotal / DIVISOR;
const PRICE = Math.round(rawSell / 50) * 50;               // round to nearest $50 for clean presentation

console.log('Clay direct-cost build-up:', JSON.stringify(direct, null, 1));
console.log(`Direct total: $${directTotal.toLocaleString()}  ÷ ${DIVISOR} = $${Math.round(rawSell).toLocaleString()}  → rounded $${PRICE.toLocaleString()}`);
console.log(`+HST: $${Math.round(PRICE * 1.15).toLocaleString()}\n`);

const clayTier = {
  slug: 'euro-clay',
  tier: 2,
  label: 'European Clay Imitation Metal',
  popular: true,
  hard: directTotal,                                  // internal direct cost (bundle fallback only)
  price: PRICE,                                        // divisor selling price — bypasses multiplier
  subtitle: 'Designer metal that reads like a European clay-tile roof, installed straight over your existing roof on a strapped batten system. No tear-off, no redeck. Pad-style snow guards (lower courses + over entries) and full chimney flashings included.',
  warranty_label: 'Lifetime panel · 15-yr workmanship · 50+ yr service life',
  _calc: { method: 'additive_cost_stack', divisor: DIVISOR, clay_per_sqft: CLAY_PER_SQFT,
           order_sqft: ORDER_SQFT, direct, directTotal, note: 'CLAY_PER_SQFT is SOP placeholder pending ARF June-1 2026 price increase' }
};

const { data: row, error: readErr } = await sb.from('estimates').select('custom_prices').eq('id', EST_ID).single();
if (readErr) { console.error('read failed', readErr); process.exit(1); }
const cp = row.custom_prices || {};
const env = cp._envelope;
if (!env) { console.error('no _envelope on estimate'); process.exit(1); }

// Merge metal road + flags, preserve everything else
env.components = env.components || {};
env.components.roof_metal = { label: 'European Clay Imitation Metal System', tiers: [clayTier] };
if (env.components.prep_redeck)  env.components.prep_redeck.systems  = ['asphalt'];
if (env.components.remediation)  env.components.remediation.systems  = ['asphalt'];
env.show_systems = ['asphalt', 'metal'];
env.default_system = 'asphalt';
env.default_selections = { ...(env.default_selections || {}), asphalt: { roofPrep: { redeck: true } }, metal: { roofPrep: {} } };

cp._envelope = env;
const { error: writeErr } = await sb.from('estimates').update({ custom_prices: cp }).eq('id', EST_ID);
if (writeErr) { console.error('write failed', writeErr); process.exit(1); }

console.log('✓ Seeded roof_metal + flags onto plus-ultra-78');
console.log('  show_systems:', JSON.stringify(env.show_systems), '| default_system:', env.default_system);
console.log('  default_selections:', JSON.stringify(env.default_selections));
console.log('  clay price:', `$${PRICE.toLocaleString()} pre-tax / $${Math.round(PRICE*1.15).toLocaleString()} w/HST`);
