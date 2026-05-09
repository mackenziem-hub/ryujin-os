// Kataria #45 — inject vinyl siding rework line into metal tiers' lineItems
// and recompute customer-facing total at the same margin rate.
//
// Why: the /api/quote `extras` param didn't propagate into the returned
// lineItems on this run, so the siding rework cost wasn't reflected in
// the metal tier totals. Patching directly so the breakdown is honest
// and customer total matches scope.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const SIDING_REWORK_LINE = {
  unit: 'LF',
  label: 'Vinyl Siding Rework — Rake Walls',
  notes: 'Pull, set aside, and reinstall regular vinyl siding along ~50 LF where rake-return roof planes meet sidewalls. Includes replacement pieces for any that crack on removal. Required for metal install only.',
  config: { system: 'metal_specific' },
  category: 'labor',
  included: true,
  item_key: 'siding_rework_rake_walls',
  quantity: 50,
  estimated: false,
  unit_cost: 20,
  sort_order: 99,
  total_cost: 1000,
  is_override: true,
  price_source: 'manual_override',
  source_detail: 'Mac directive May 9 2026 — medium NB rate, regular vinyl'
};

const { data } = await sb.from('estimates').select('id, calculated_packages').eq('estimate_number', 45).single();
const cp = { ...(data.calculated_packages || {}) };

const METAL_KEYS = ['metal-americana', 'metal-standing-seam', 'metal-premium'];

console.log('Injecting siding rework into metal tiers + recomputing totals at preserved margin rate:\n');

for (const slug of METAL_KEYS) {
  const tier = cp[slug];
  if (!tier) continue;

  // Skip if already injected
  if ((tier.lineItems || []).some(li => li.item_key === 'siding_rework_rake_walls')) {
    console.log(`  ${slug.padEnd(22)} already has siding rework — skipping`);
    continue;
  }

  // Parse current margin rate from string like "51.3%" → 0.513
  const marginPct = parseFloat(String(tier.margin || '0').replace('%','')) / 100;

  // Old totals
  const oldTotal = Number(tier.total) || 0;
  const oldHard = oldTotal * (1 - marginPct);
  const newHard = oldHard + 1000;     // raw cost layer
  // Preserve same margin rate: newHard / newTotal = (1 - marginPct)
  // → newTotal = newHard / (1 - marginPct)
  const newTotalRaw = newHard / (1 - marginPct);
  const newTotal = Math.round(newTotalRaw / 25) * 25;  // round to $25 increments per Ryujin convention
  const newTotalWithTax = Math.round(newTotal * 1.15);
  const newPerSq = Math.round(newTotal / 12);          // 12 SQ on this job

  cp[slug] = {
    ...tier,
    total: newTotal,
    totalWithTax: newTotalWithTax,
    persq: newPerSq,
    tax: newTotalWithTax - newTotal,
    lineItems: [...(tier.lineItems || []), SIDING_REWORK_LINE]
  };

  console.log(`  ${slug.padEnd(22)} $${oldTotal.toLocaleString().padStart(7)} → $${newTotal.toLocaleString().padStart(7)} pre-tax  (Δ +$${(newTotal - oldTotal).toLocaleString()} customer-facing for $1,000 raw cost @ ${(marginPct*100).toFixed(1)}% margin)`);
}

const { error } = await sb.from('estimates').update({
  calculated_packages: cp
}).eq('id', data.id);
if (error) { console.error(error.message); process.exit(1); }

console.log('\n✓ #45 metal tiers now carry the siding rework line item visibly in the breakdown.');
console.log(`\nFinal pricing:`);
console.log(`  ASPHALT (siding undisturbed):`);
for (const k of ['gold','platinum','diamond']) {
  const t = cp[k]; if (!t) continue;
  console.log(`    ${k.padEnd(22)} $${t.total.toLocaleString().padStart(7)} pre-tax  /  $${(t.totalWithTax || 0).toLocaleString().padStart(7)} incl HST`);
}
console.log(`  METAL (with siding rework):`);
for (const k of METAL_KEYS) {
  const t = cp[k]; if (!t) continue;
  const star = k === 'metal-standing-seam' ? '  ← recommended' : '';
  console.log(`    ${k.padEnd(22)} $${t.total.toLocaleString().padStart(7)} pre-tax  /  $${(t.totalWithTax || 0).toLocaleString().padStart(7)} incl HST${star}`);
}
