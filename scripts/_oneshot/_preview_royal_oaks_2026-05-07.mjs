// Dry-run pricing preview for Jean Gauvin (694) + Sharon (696) Royal Oaks Blvd duplex.
// Uses 684 Royal Oaks EagleView split 50/50.
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

const half = {
  squareFeet: 2709,
  pitch: '8/12',
  complexity: 'complex',
  distanceKM: 10,
  extraLayers: 1,
  eavesLF: 170,
  rakesLF: 30,
  ridgesLF: 42,
  hipsLF: 158,
  valleysLF: 113,
  wallsLF: 16,
  pipes: 2,
  vents: 1,
  stories: 1
};

const { data: offers } = await sb.from('offers').select('id, slug').eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const offerIds = offers.map(o => o.id);

const q = await calculateMultiOfferQuote(sb, { tenantId: TENANT, offerIds, measurements: half });

console.log('Per-side pricing (each owner — 50/50 of duplex roof):');
console.log('='.repeat(70));
for (const slug of ['gold','platinum','diamond']) {
  const o = q.offers?.[slug]; if (!o) continue;
  const s = o.summary;
  console.log(`  ${slug.padEnd(10)} measuredSQ=${o.measurements.measuredSQ}  hardCost=$${s.hardCost.toFixed(0).padStart(7)}  sell=$${String(s.sellingPrice).padStart(7)}  HST=$${s.tax.toFixed(0).padStart(5)}  twt=$${s.totalWithTax.toFixed(0).padStart(7)}  margin=${s.netMargin}`);
}
console.log('\nFor reference, FULL building (both halves combined):');
const full = { ...half, squareFeet: 5418, eavesLF: 340, rakesLF: 61, ridgesLF: 83, hipsLF: 316, valleysLF: 225, wallsLF: 31, pipes: 4, vents: 2 };
const qf = await calculateMultiOfferQuote(sb, { tenantId: TENANT, offerIds, measurements: full });
for (const slug of ['gold','platinum','diamond']) {
  const o = qf.offers?.[slug]; if (!o) continue;
  const s = o.summary;
  console.log(`  ${slug.padEnd(10)} measuredSQ=${o.measurements.measuredSQ}  hardCost=$${s.hardCost.toFixed(0).padStart(7)}  sell=$${String(s.sellingPrice).padStart(7)}  twt=$${s.totalWithTax.toFixed(0).padStart(7)}  margin=${s.netMargin}`);
}

console.log('\nKey labor lines (gold tier, per-side):');
const goldLineItems = q.offers?.gold?.lineItems || [];
for (const li of goldLineItems.filter(l => l.included && (l.item_key === 'sub_labor' || l.item_key === 'sub_addon' || l.item_key === 'sub_surcharge' || l.item_key === 'supervisor_fee' || l.item_key === 'remediation'))) {
  console.log(`  ${(li.label||'').slice(0,60).padEnd(60)} qty=${String(li.quantity).padStart(4)} rate=$${String(li.unit_cost).padStart(6)} total=$${String(li.total_cost).padStart(7)}`);
}
