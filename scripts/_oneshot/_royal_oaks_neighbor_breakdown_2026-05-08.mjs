// Detailed margin/profit/expense breakdown for Royal Oaks duplex at honored
// 2024 Hiscock per-SQ pricing.
//
// Per side: 33 SQ, 8/12, complex, local, 1 layer extra, 2 pipes, 0 vents.
// Honored pricing matches Hiscock 689 Royal Oaks Aug 2024 per-SQ:
//   Gold $608/SQ · Platinum $662/SQ · Diamond $1,015/SQ.

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

const HONORED = { gold: 20050, platinum: 21875, diamond: 33500 };

const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

function fmt(n) { return '$' + Math.round(n).toLocaleString(); }
function pct(n, d) { return ((n / d) * 100).toFixed(1) + '%'; }

function breakdown(slug, label) {
  const o = q.offers[slug];
  const s = o.summary;
  const sopSell = s.sellingPrice;
  const honoredSell = HONORED[slug];
  const hardCost = s.hardCost;
  const workdays = o.measurements.workdays;

  // Material vs labor split from byCategory
  const cats = s.byCategory || {};
  const materials = cats.materials || 0;
  const labor = cats.labor || 0;
  const overhead = cats.overhead || 0;
  const remediation = cats.remediation || 0;
  const warranty = cats.warranty || 0;

  // S+M+O allocations (% of pre-tax revenue, per pricing_formula_v2.md Section 3)
  // Using Darcy's Tier A commission 12% effective May 15 (these jobs likely close after)
  const COMMISSION_PCT = 0.12; // Darcy Tier A
  const MARKETING_PCT = 0.05;
  const OVERHEAD_PCT = 0.20;
  const REAL_OVERHEAD_PCT = 0.12; // Mac's lean reality

  const grossProfit = honoredSell - hardCost;
  const grossMarginPct = (grossProfit / honoredSell) * 100;

  const commission = honoredSell * COMMISSION_PCT;
  const marketing = honoredSell * MARKETING_PCT;
  const sopOverhead = honoredSell * OVERHEAD_PCT;
  const sopAllocations = commission + marketing + sopOverhead;
  const sopNet = grossProfit - sopAllocations;
  const sopNetPerDay = sopNet / workdays;

  const realLoading = honoredSell * REAL_OVERHEAD_PCT;
  const realCashNet = grossProfit - realLoading - commission; // commission is real cash out, overhead is leaner
  const realCashNetPerDay = realCashNet / workdays;

  const sopReferenceProfit = honoredSell * (slug === 'gold' ? 0.12 : slug === 'platinum' ? 0.17 : 0.23);
  const profitVsSop = sopNet - sopReferenceProfit;

  return {
    label, slug, sopSell, honoredSell, hardCost, workdays,
    materials, labor, overhead, remediation, warranty,
    grossProfit, grossMarginPct,
    commission, marketing, sopOverhead, sopAllocations,
    sopNet, sopNetPerDay,
    realLoading, realCashNet, realCashNetPerDay,
    sopReferenceProfit, profitVsSop
  };
}

const rows = ['gold','platinum','diamond'].map(s => breakdown(s, s));

// ── Print ──
console.log('\n' + '='.repeat(90));
console.log('PER-SIDE BREAKDOWN — Honored Hiscock 2024 pricing (33 SQ at 8/12 complex local)');
console.log('='.repeat(90));

for (const r of rows) {
  console.log(`\n┌─ ${r.label.toUpperCase()} ─────────────────────────────────────────────`);
  console.log(`│  Revenue (pre-tax)            ${fmt(r.honoredSell).padStart(10)}     [SOP would be ${fmt(r.sopSell)} — discount $${(r.sopSell-r.honoredSell).toLocaleString()}]`);
  console.log(`│  HST (15%)                    ${fmt(r.honoredSell*0.15).padStart(10)}`);
  console.log(`│  Customer pays                ${fmt(r.honoredSell*1.15).padStart(10)}`);
  console.log(`├─ HARD COSTS (out of pocket)`);
  console.log(`│   Materials                   ${fmt(r.materials).padStart(10)}`);
  console.log(`│   Labor (Ryan + supervisor)   ${fmt(r.labor).padStart(10)}`);
  console.log(`│   Remediation buffer          ${fmt(r.remediation).padStart(10)}     [refunded if unused]`);
  if (r.overhead) console.log(`│   Project overhead            ${fmt(r.overhead).padStart(10)}`);
  if (r.warranty) console.log(`│   Warranty adder              ${fmt(r.warranty).padStart(10)}`);
  console.log(`│   ────────────────────────`);
  console.log(`│   Total hard cost             ${fmt(r.hardCost).padStart(10)}`);
  console.log(`├─ GROSS PROFIT (revenue − hard cost)`);
  console.log(`│   Gross profit                ${fmt(r.grossProfit).padStart(10)}     ${r.grossMarginPct.toFixed(1)}% gross margin`);
  console.log(`├─ ALLOCATIONS (per SOP § 3 — money out the door post-job)`);
  console.log(`│   Darcy commission (12% Tier A) ${fmt(r.commission).padStart(10)}`);
  console.log(`│   Marketing reserve (5%)      ${fmt(r.marketing).padStart(10)}`);
  console.log(`│   Company overhead (20%)      ${fmt(r.sopOverhead).padStart(10)}`);
  console.log(`│   ────────────────────────`);
  console.log(`│   Total S+M+O                 ${fmt(r.sopAllocations).padStart(10)}     (${pct(r.sopAllocations, r.honoredSell)} of revenue)`);
  console.log(`├─ NET TO MAC — Two views`);
  console.log(`│   SOP-textbook net            ${fmt(r.sopNet).padStart(10)}     ${pct(r.sopNet, r.honoredSell)} of revenue · $${Math.round(r.sopNetPerDay).toLocaleString()}/day across ${r.workdays} days`);
  console.log(`│     vs SOP target (${(slug=>slug==='gold'?'12':slug==='platinum'?'17':'23')(r.slug)}%):  ${r.profitVsSop>=0?'+':''}${fmt(r.profitVsSop)} vs target`);
  console.log(`│   Real-cash net (12% lean OH) ${fmt(r.realCashNet).padStart(10)}     ${pct(r.realCashNet, r.honoredSell)} of revenue · $${Math.round(r.realCashNetPerDay).toLocaleString()}/day`);
  console.log(`└─`);
}

console.log('\n' + '='.repeat(90));
console.log('COMBINED — IF BOTH JEAN AND SHARON SIGN AT THE SAME TIER');
console.log('='.repeat(90));
console.log('  (assumes 5 crew days total for the duplex — single mob, shared delivery, same day-rate supervisor allocation)');

const COMBINED_DAYS = 5;
for (const r of rows) {
  const rev = r.honoredSell * 2;
  const hc = r.hardCost * 2;
  const gross = r.grossProfit * 2;
  const sopAlloc = r.sopAllocations * 2;
  const sopNet = r.sopNet * 2;
  const realCash = r.realCashNet * 2;
  console.log(`\n  ${r.label.toUpperCase()}`);
  console.log(`    Revenue (both sides, pre-tax) ${fmt(rev).padStart(10)}     Customer pays total ${fmt(rev*1.15)}`);
  console.log(`    Hard cost (both)              ${fmt(hc).padStart(10)}`);
  console.log(`    Gross profit                  ${fmt(gross).padStart(10)}     ${pct(gross, rev)}`);
  console.log(`    SOP-textbook net to Mac       ${fmt(sopNet).padStart(10)}     ${pct(sopNet, rev)} · $${Math.round(sopNet/COMBINED_DAYS).toLocaleString()}/day across ${COMBINED_DAYS} duplex days`);
  console.log(`    Real-cash net to Mac          ${fmt(realCash).padStart(10)}     ${pct(realCash, rev)} · $${Math.round(realCash/COMBINED_DAYS).toLocaleString()}/day`);
}

console.log('\n' + '='.repeat(90));
console.log('FLOOR CHECK — $700/day minimum target per project_pricing_engine_v3_2026-04-27.md');
console.log('='.repeat(90));
for (const r of rows) {
  const combined = r.realCashNet * 2 / COMBINED_DAYS;
  const status = combined >= 700 ? '✓ ABOVE FLOOR' : '✗ BELOW FLOOR';
  console.log(`  ${r.label.padEnd(10)} ${status}   $${Math.round(combined)}/day vs $700/day target  (combined both sides)`);
}
