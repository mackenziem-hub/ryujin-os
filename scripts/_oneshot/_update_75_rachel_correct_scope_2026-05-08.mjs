// Re-update #37 with the CORRECT scope: Structure #1 = main house, 14.44 SQ
// measured at mixed pitches. Earlier update was wrong (used Structure #2 / 4 SQ).
//
// EagleView 65990322 Structure #1 breakdown:
//   1188 sf at 6/12  (82.2%)  — main body
//    124 sf at 8/12  ( 8.6%)
//     30 sf at 10/12 ( 2.1%)
//    104 sf at 11/12 ( 7.2%)  — steep dormer / accent
// Linear (Structure #1): Eaves 74 / Rakes 103 / Ridges 64 / Hips 39 / Valleys 61 / Step 18
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateMultiOfferQuote } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const SHARE = 'plus-ultra-egbuwoku-75rachel';

// Pitch multipliers must match engine
const PM = { '6/12': 1.118, '8/12': 1.202, '10/12': 1.302, '11/12': 1.357 };

// Each plane = sqft (2D footprint). Engine pitch-uplifts per plane.
// Back out from EagleView's 3D pitch-adjusted area:
const planes = [
  { sqft: Math.round(1188 / PM['6/12']),  pitch: '6/12',  label: 'Main 6/12' },         // 1063
  { sqft: Math.round( 124 / PM['8/12']),  pitch: '8/12',  label: '8/12 facet' },         // 103
  { sqft: Math.round(  30 / PM['10/12']), pitch: '10/12', label: '10/12 facet' },        //  23
  { sqft: Math.round( 104 / PM['11/12']), pitch: '11/12', label: '11/12 dormer/accent' } //  77
];
console.log('Planes 2D total:', planes.reduce((a,b) => a + b.sqft, 0), 'sqft  (EagleView 3D total: 1444 sf)');

const measurements = {
  planes,
  squareFeet: 0,             // ignored when planes provided
  pitch: '6/12',             // dominant — for material rates
  complexity: 'complex',     // 10 facets, valleys, multi-pitch
  distanceKM: 28,
  extraLayers: 0,
  eavesLF: 74,
  rakesLF: 103,
  ridgesLF: 64,
  hipsLF: 39,
  valleysLF: 61,
  wallsLF: 18,
  pipes: 1,
  vents: 0,
  stories: 1
};

const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

console.log('\n=== SOP PRICING (Structure #1 main house, multi-pitch) ===');
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers[slug]; const s = o.summary;
  console.log(`  ${slug.padEnd(10)} measuredSQ=${o.measurements.measuredSQ}  hardCost=$${s.hardCost.toFixed(0).padStart(7)}  ×${s.multiplier}  → sell $${String(s.sellingPrice).padStart(7)}  + HST $${s.tax.toFixed(0).padStart(5)}  =  $${s.totalWithTax.toFixed(0).padStart(7)}  /  ${s.netMargin}`);
}

console.log('\nPer-plane base labor lines (Gold, sub paysheet):');
const subLabor = (q.offers.gold.lineItems || []).filter(li => li.included && /Base labor/.test(li.label || ''));
for (const li of subLabor) {
  console.log(`  ${(li.label||'').slice(0,55).padEnd(55)}  qty=${String(li.quantity).padStart(4)}  rate=$${String(li.unit_cost).padStart(5)}  total=$${String(li.total_cost).padStart(7)}`);
}

// Build calculated_packages — clean SOP, no strikethrough
const cp = {};
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers[slug]; const s = o.summary;
  cp[slug] = {
    total: s.sellingPrice,
    totalWithTax: s.totalWithTax,
    tax: Math.round(s.sellingPrice * 0.15 * 100) / 100,
    persq: s.pricePerSQ,
    margin: s.netMargin,
    customPrice: false,
    lineItems: o.lineItems
  };
}

// Update #37
const { data: ex } = await sb.from('estimates')
  .select('id, estimate_number, notes, tags, selected_package, custom_prices')
  .eq('share_token', SHARE).single();

const newNotes = [...(ex.notes || []), {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: `SCOPE CORRECTION (REVISED) — May 8 2026

Earlier update misread "main house only, roughly 4 squares" — I picked Structure #2 (the small 4 SQ section). Mac corrected: the main house is Structure #1, ~16 SQ. The garage/secondary structure was the 4 SQ being removed from scope.

CORRECTED EAGLEVIEW MAPPING:
- Structure #1 (KEEP — main house): 14.44 SQ measured at mixed pitches:
  - 1188 sf at 6/12 dominant
  -  124 sf at 8/12
  -   30 sf at 10/12
  -  104 sf at 11/12 dormer/accent
- Structure #2 (REMOVE — garage): ~4 SQ at 7/12

Multi-plane input used so each section gets correct labor band ($130 at 6/12 / $160 at 8/12 / $190 at 10/12 + 11/12).

NEW SOP PRICING (clean v2.1 canonical, no honored discount):
- Gold:     $${cp.gold.total} pre-tax / $${cp.gold.totalWithTax.toFixed(0)} incl HST
- Platinum: $${cp.platinum.total} pre-tax / $${cp.platinum.totalWithTax.toFixed(0)} incl HST
- Diamond:  $${cp.diamond.total} pre-tax / $${cp.diamond.totalWithTax.toFixed(0)} incl HST

Was previously locked at Gold $14,355 (full 18.5 SQ scope, June 2024 honored). New SOP for 14.44 SQ ≈ 16 SQ scope is Gold $${cp.gold.totalWithTax.toFixed(0)} incl HST. Honored discount intentionally removed — customer's price drop comes from scope reduction (garage out), not from negotiation.`
}];

const NOW = new Date().toISOString();
await sb.from('estimates').update({ locked_at: null }).eq('id', ex.id);

const { error } = await sb.from('estimates').update({
  roof_area_sqft: planes.reduce((a, b) => a + b.sqft, 0),
  roof_pitch: '6/12',
  planes,
  complexity: 'complex',
  eaves_lf: 74, rakes_lf: 103, ridges_lf: 64, valleys_lf: 61, hips_lf: 39, walls_lf: 18,
  pipes: 1, vents: 0, extra_layers: 0,
  distance_km: 28,
  calculated_packages: cp,
  custom_prices: {},
  final_accepted_total: cp.gold.totalWithTax,
  notes: newNotes
}).eq('id', ex.id);
if (error) { console.error(error.message); process.exit(1); }

await sb.from('estimates').update({
  locked_at: NOW,
  locked_reason: `Scope-corrected (revised) main-house-only locked May 8 2026 — Structure #1 ONLY (14.44 SQ multi-pitch). Garage Structure #2 removed. Final accepted Gold $${cp.gold.totalWithTax.toFixed(0)} incl HST.`
}).eq('id', ex.id);

console.log(`\n✓ #${ex.estimate_number} updated and re-locked at corrected scope`);
console.log(`Share URL: https://ryujin-os.vercel.app/proposal-client.html?share=${SHARE}`);
