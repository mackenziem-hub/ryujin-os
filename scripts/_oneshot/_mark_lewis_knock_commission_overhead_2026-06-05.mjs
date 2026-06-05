// Mark Lewis #80 — Mac direct deal pricing.
//   Drop 10% sales commission AND drop overhead from 20% to 10%.
//   Net multiplier reduction: -0.20 across all tiers.
//   Follows Guy PU-76 Option A pattern: stash originals in _adjusted, add tag.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const SQ = 44; // EagleView true area

const MULT = {
  gold:     { old: 1.47, neu: 1.27 },  // 1.00 + 0.05 mkt + 0.10 oh + 0.12 tp
  platinum: { old: 1.52, neu: 1.32 },  // 1.00 + 0.05 mkt + 0.10 oh + 0.17 tp
  diamond:  { old: 1.58, neu: 1.38 }   // 1.00 + 0.05 mkt + 0.10 oh + 0.23 tp
};
const round25 = n => Math.round(n / 25) * 25;

const { data: est } = await sb.from('estimates')
  .select('calculated_packages, tags').eq('id', ID).single();

const cp = JSON.parse(JSON.stringify(est.calculated_packages));
const stamp = new Date().toISOString();
const log = [];

for (const slug of ['gold','platinum','diamond']) {
  const cur = cp[slug];
  const m = MULT[slug];
  const ratio = m.neu / m.old;
  const newTotal = round25(cur.total * ratio);
  const newTax = Math.round(newTotal * 0.15 * 100) / 100;
  const newTotalWithTax = Math.round((newTotal + newTax) * 100) / 100;
  const persq = Math.round(newTotal / SQ);

  cp[slug] = {
    ...cur,
    total: newTotal,
    totalWithTax: newTotalWithTax,
    tax: newTax,
    persq,
    _adjusted: {
      reason: 'Mac direct deal: 10% commission removed + overhead 20→10',
      applied_at: stamp,
      old_total: cur.total,
      old_totalWithTax: cur.totalWithTax,
      old_mult: m.old,
      new_mult: m.neu,
      mult_delta: -0.20,
      formula: '1.00 cost + 0.05 marketing + 0.10 overhead + target_profit'
    }
  };
  log.push({ slug, oldTotal: cur.total, newTotal, persq, saves: cur.total - newTotal });
}

const newTags = Array.from(new Set([...(est.tags || []),
  'commission_removed_overhead_halved_2026-06-05',
  'mac_direct_deal_pricing'
]));

const { error } = await sb.from('estimates')
  .update({ calculated_packages: cp, tags: newTags })
  .eq('id', ID);
if (error) throw new Error(error.message);

console.log('✓ Tiers re-priced (Mac direct deal: -10% commission, -10% overhead)\n');
console.log('Tier         Old         New          $/SQ    Customer saves');
for (const r of log) {
  console.log(`  ${r.slug.padEnd(10)} $${String(r.oldTotal).padStart(7)} → $${String(r.newTotal).padStart(7)}    $${String(r.persq).padStart(4)}    $${String(r.saves).padStart(5)}`);
}
console.log('\nIncl HST:');
for (const slug of ['gold','platinum','diamond']) {
  console.log(`  ${slug.padEnd(10)} $${cp[slug].totalWithTax.toLocaleString()}`);
}
console.log('\nCustomer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80');
console.log('(hard-refresh)');
