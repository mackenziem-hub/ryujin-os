// Itemize the hard cost line-by-line for Royal Oaks duplex per side (33 SQ at 8/12).
// Pulls real engine output — every line item that lands in hardCost.
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

const measurements = {
  squareFeet: 2709, pitch: '8/12', complexity: 'complex',
  distanceKM: 10, extraLayers: 1, eavesLF: 170, rakesLF: 30, ridgesLF: 42,
  hipsLF: 158, valleysLF: 113, wallsLF: 16, pipes: 2, vents: 0, stories: 1
};

const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

const $ = n => '$' + (Math.round(n * 100) / 100).toLocaleString();

function dump(slug) {
  const o = q.offers[slug];
  const items = (o.lineItems || []).filter(li => li.included && li.total_cost > 0);

  // Group by category
  const groups = {};
  for (const li of items) {
    const cat = li.category || 'other';
    (groups[cat] ||= []).push(li);
  }

  console.log('\n' + '═'.repeat(96));
  console.log(`${slug.toUpperCase()} — Hard cost breakdown (per side, 33 SQ)`);
  console.log('═'.repeat(96));

  const order = ['materials', 'labor', 'overhead', 'warranty', 'remediation', 'other'];
  let total = 0;
  for (const cat of order) {
    if (!groups[cat]) continue;
    let catSum = 0;
    console.log(`\n  ${cat.toUpperCase()}`);
    for (const li of groups[cat]) {
      const lbl = (li.label || '?').slice(0, 55);
      const qty = li.quantity != null ? `${li.quantity} ${li.unit || ''}`.trim() : '';
      const rate = li.unit_cost != null && li.unit_cost > 0 ? `@ $${li.unit_cost}` : '';
      const meta = [qty, rate].filter(Boolean).join(' ');
      console.log(`    ${lbl.padEnd(55)} ${meta.padStart(20)} ${$(li.total_cost).padStart(11)}`);
      catSum += li.total_cost;
    }
    console.log(`    ${' '.repeat(55)} ${'─'.repeat(20)} ${'─'.repeat(11)}`);
    console.log(`    ${cat.toUpperCase()} SUBTOTAL`.padEnd(76) + $(catSum).padStart(11));
    total += catSum;
  }
  console.log('\n  ' + '═'.repeat(94));
  console.log(`  HARD COST TOTAL`.padEnd(76) + $(total).padStart(11));
}

for (const slug of ['gold', 'platinum', 'diamond']) dump(slug);
