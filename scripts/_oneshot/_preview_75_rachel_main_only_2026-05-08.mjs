// Preview corrected pricing for 75 Rachel (Egbuwoku) — main house ONLY
// (EagleView Structure #2 = 398 sf, 7/12 uniform, ~4 SQ).
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

// Pull existing distance_km off #37 so we use the same pricing model
const { data: ex } = await sb.from('estimates').select('distance_km').eq('share_token','plus-ultra-egbuwoku-75rachel').single();
const distKM = Number(ex?.distance_km) || 30;  // Shediac ~30km from Riverview = day trip
console.log('distance_km from existing #37:', distKM);

// Structure #2 = main house. 398sf real surface area at 7/12.
// Engine wants 2D footprint — back out the pitch multiplier (1.158 for 7/12).
const sqft2D = Math.round(398 / 1.158);  // = 344
const measurements = {
  squareFeet: sqft2D,
  pitch: '7/12',
  complexity: 'simple',     // 3 facets, no valleys
  distanceKM: distKM,
  extraLayers: 0,
  eavesLF: 60,
  rakesLF: 34,
  ridgesLF: 22,
  hipsLF: 1,
  valleysLF: 0,
  wallsLF: 3,
  pipes: 1,
  vents: 0,
  stories: 1
};
console.log('Measurements:', JSON.stringify(measurements));

const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

console.log('\n=== SOP PRICING (main house only, 4 SQ at 7/12) ===');
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers[slug];
  const s = o.summary;
  console.log(`  ${slug.padEnd(10)} measuredSQ=${o.measurements.measuredSQ}  hardCost=$${s.hardCost.toFixed(0)}  ×${s.multiplier}  → sell $${s.sellingPrice}  + HST $${s.tax.toFixed(0)}  =  $${s.totalWithTax.toFixed(0)}  /  ${s.netMargin}`);
}

console.log('\n=== KEY HARD-COST LINES (Gold) ===');
const goldLines = (q.offers.gold.lineItems || []).filter(li => li.included && li.total_cost > 0);
for (const li of goldLines) {
  console.log(`  ${(li.label||'').slice(0,55).padEnd(55)}  qty=${String(li.quantity).padStart(5)}  rate=$${String(li.unit_cost).padStart(6)}  total=$${String(li.total_cost).padStart(7)}`);
}
console.log(`  TOTAL HARD COST = $${q.offers.gold.summary.hardCost.toFixed(0)}`);

console.log('\n=== COMPARISON TO LOCKED #37 (18.5 SQ — both structures) ===');
console.log('  Old locked:  Gold $14,355 incl HST  (18.5 SQ scope, was $14,855 SOP)');
console.log(`  New SOP:     Gold $${q.offers.gold.summary.totalWithTax.toFixed(0)} incl HST  (4 SQ scope, main house only)`);
console.log(`  Reduction:   $${(14355 - q.offers.gold.summary.totalWithTax).toFixed(0)}  (${(((14355 - q.offers.gold.summary.totalWithTax)/14355)*100).toFixed(0)}% lower)`);
