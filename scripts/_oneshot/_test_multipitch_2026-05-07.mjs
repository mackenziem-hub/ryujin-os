// Multi-pitch verification — Kataria geometry single vs planes.
// 32×30 upper main 5/12 (= 960 sqft 2D) + side rakes ~80 sqft 12/12 + front rake ~80 sqft 12/12.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateQuoteV3 } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

async function quote(slug, m, label) {
  const { data: offer } = await sb.from('offers').select('id, slug').eq('tenant_id', TENANT).eq('slug', slug).single();
  const r = await calculateQuoteV3(sb, { tenantId: TENANT, offerId: offer.id, measurements: m, mode: 'advanced' });
  if (r.error) { console.log(`  [${slug}] ERROR: ${r.error}`); return null; }
  const subLines = r.lineItems.filter(li => li.item_key === 'sub_labor' && li.included && /Base labor/.test(li.label || ''));
  console.log(`\n  --- ${label} → ${slug} ---`);
  console.log(`    measuredSQ=${r.measurements.measuredSQ}  multiPitch=${r.measurements.multiPitch}  hardCost=$${r.summary.hardCost.toFixed(0)}  sell=$${r.summary.sellingPrice}`);
  if (r.measurements.planes) {
    for (const p of r.measurements.planes) {
      console.log(`    plane: ${p.label || '—'}  raw=${p.sqft}sqft  pitch=${p.pitch}  adj=${p.adjustedSqft}sqft  sq=${p.sq}`);
    }
  }
  console.log(`    base labor lines:`);
  for (const li of subLines) console.log(`      ${li.label}  qty=${li.quantity}  rate=$${li.unit_cost}  total=$${li.total_cost}`);
  return r;
}

console.log('=== Single-pitch baseline (entire roof at 5/12, like the chat-tool default) ===');
const single = {
  squareFeet: 1097, pitch: '5/12', complexity: 'medium',
  distanceKM: 5, extraLayers: 1, pipes: 1, eavesLF: 80, rakesLF: 80, ridgesLF: 30
};
await quote('gold', single, 'single-pitch 5/12');

console.log('\n=== Multi-plane (5/12 main + 12/12 rakes, today\'s actual geometry) ===');
const multi = {
  ...single,
  squareFeet: 0, // ignored when planes provided, but kept for API safety
  planes: [
    { sqft: 960, pitch: '5/12', label: 'Upper main' },
    { sqft: 80,  pitch: '12/12', label: 'Side rakes' },
    { sqft: 57,  pitch: '12/12', label: 'Front rake' }
  ]
};
await quote('gold', multi, 'multi-plane 5/12+12/12');
await quote('platinum', multi, 'multi-plane platinum');
await quote('diamond', multi, 'multi-plane diamond');

console.log('\n=== Combined offer sub paysheet check (gold-shell) ===');
const shell = {
  squareFeet: 2000, pitch: '6/12', complexity: 'medium',
  distanceKM: 5, pipes: 2, wallSqFt: 1500, eavesLF: 100, rakesLF: 80, ridgesLF: 40
};
const r = await quote('gold-shell', shell, 'combined gold-shell');
if (r) {
  const hasSubLabor = r.lineItems.some(li => li.item_key === 'sub_labor' && li.included);
  console.log(`    combined offer sub paysheet active: ${hasSubLabor ? '✓ YES' : '✗ NO — bug'}`);
}

console.log('\nDone.');
