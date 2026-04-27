// Cornhill (#24) sanity check vs new engine
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const { calculateMultiOfferQuote } = await import('../../lib/quoteEngineV3.js');

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// Cornhill measurements (from session notes / estimate row)
const measurements = {
  squareFeet: 3400,
  pitch: '8/12',           // 7-9/12 simple — pick middle
  complexity: 'simple',
  distanceKM: 0,
  eavesLF: 220,
  rakesLF: 140,
  ridgesLF: 50,
  hipsLF: 80,
  valleysLF: 35,
  pipes: 1,
  vents: 4,
  extraLayers: 0
};

const { data: offers } = await supabase
  .from('offers').select('id, slug, system')
  .eq('tenant_id', TENANT)
  .in('slug', ['gold','platinum','diamond']);

console.log('Calling engine...');
const result = await calculateMultiOfferQuote(supabase, {
  tenantId: TENANT,
  offerIds: offers.map(o => o.id),
  measurements,
  overrides: {},
  choices: {},
  extras: []
});

console.log('\n=== Cornhill #24 (3400 sqft, 8/12, simple, 0 km) ===');
console.log('Memory says: sold for ~$23,200 Gold, paysheet was $6,543.50');
console.log('Audit Apr 24: 28% blended margin\n');
for (const slug of ['gold','platinum','diamond']) {
  const r = result.offers[slug];
  if (!r) continue;
  const s = r.summary;
  console.log(`--- ${slug.toUpperCase()} ---`);
  console.log(`  Sell: $${s.sellingPrice} | Hard: $${s.hardCost} | Mult: ${s.multiplier} | workdays: ${r.measurements.workdays}`);
  console.log(`  subPaysheet: $${s.subPaysheetTotal} | supervisor: $${s.supervisorFee}`);
  console.log(`  legacy netMargin (gross): ${s.netMargin}`);
  // Phase 1 (Apr 27): floor/loading fields replaced with SOP + lean-cash reporting.
  console.log(`  SOP profit (${(s.sopTargetPct*100).toFixed(0)}% of hard): $${s.sopProfit}`);
  console.log(`  realCashNet (after ${(s.realLoadingPct*100).toFixed(0)}% lean loading): $${s.realCashNet} (${s.realCashNetMargin})`);
  console.log(`  belowBreakeven? ${s.belowBreakeven}${s.belowBreakeven ? ' -- ' + s.breakevenWarning : ''}`);
}
