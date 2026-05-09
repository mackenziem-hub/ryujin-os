// One-shot: investigate the Patricia 153-bundle anomaly.
// Pulls quote_line_items for estimate #25 + Gold offer's scope_template
// to identify whether bundles_per_sq was overridden or waste was off.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

console.log('=== PATRICIA (estimate #25) ===');
const { data: est, error: e1 } = await sb
  .from('estimates')
  .select('id, estimate_number, square_feet, complexity, pitch, calculated_packages')
  .eq('tenant_id', TENANT).eq('id', 25).single();
if (e1) { console.error('estimate err:', e1); process.exit(1); }
console.log(JSON.stringify({
  id: est.id, number: est.estimate_number, sqft: est.square_feet,
  complexity: est.complexity, pitch: est.pitch
}, null, 2));
console.log('calculated_packages:', JSON.stringify(est.calculated_packages, null, 2));

console.log('\n=== quote_line_items for estimate #25 (shingle-related) ===');
const { data: lines } = await sb
  .from('quote_line_items')
  .select('item_key, label, quantity, unit, unit_cost, total_cost, config, offer_slug')
  .eq('tenant_id', TENANT).eq('estimate_id', 25)
  .in('item_key', ['shingles','underlayment','starter','ridge_cap','drip_edge','base_labor','tearoff_labor']);
for (const li of lines || []) {
  console.log(`  [${li.offer_slug || '?'}] ${li.item_key.padEnd(20)} qty=${String(li.quantity).padEnd(6)} unit=${(li.unit||'').padEnd(8)} config=${JSON.stringify(li.config || {})}`);
}

console.log('\n=== Gold offer scope_template (Plus Ultra) ===');
const { data: gold } = await sb
  .from('offers')
  .select('id, slug, name, multipliers, scope_template, margin_floor')
  .eq('tenant_id', TENANT).eq('slug', 'gold').single();
console.log('multipliers:', JSON.stringify(gold?.multipliers));
console.log('margin_floor:', gold?.margin_floor);
const shingleEntry = (gold?.scope_template || []).find(t => t.key === 'shingles');
console.log('shingles scope entry:', JSON.stringify(shingleEntry, null, 2));

console.log('\n=== Math reconciliation ===');
const measuredSQ = Math.ceil((est.square_feet || 0) * 1.083 / 100); // assume 5/12 default
const totalSQ_complex = Math.ceil(measuredSQ * 1.20);
const totalSQ_medium = Math.ceil(measuredSQ * 1.15);
console.log(`measuredSQ (assuming 5/12 pitch): ${measuredSQ}`);
console.log(`totalSQ at complex (20%): ${totalSQ_complex} → bundles@3bps = ${totalSQ_complex * 3}`);
console.log(`totalSQ at medium (15%): ${totalSQ_medium} → bundles@3bps = ${totalSQ_medium * 3}`);
console.log(`Engine reportedly produced 153 bundles. To get 153: totalSQ × bps = 153.`);
console.log(`  If bps=3, totalSQ would be 51 → measuredSQ ${Math.ceil(51/1.20)} (complex) or ${Math.ceil(51/1.15)} (medium)`);
console.log(`  If totalSQ=42 (34.54×1.20), bps would need to be ${(153/42).toFixed(2)}`);
