// Clean real-money breakdown for Royal Oaks duplex at honored 2024 Hiscock pricing.
// Removes double-counting from v1. Shows TWO views:
//   1. SOP-textbook reference — what the multiplier was DESIGNED to deliver at 1.47/1.52/1.58
//   2. Real-money flow — what actually hits Mac's bank account on this specific deal
//
// Real-money assumptions (per project_plus_ultra_economics.md):
//   - Darcy commission: 12% pre-tax revenue (Tier A, May 15+ effective)
//   - Lean fixed overhead: ~$65/day allocated (rent, software, phones, insurance amortized)
//   - Marketing reserve: $0 (Darcy walked the door — not a Meta-funded lead)
//   - HST is pass-through (collected, remitted, not income)
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
const COMMISSION_PCT = 0.12;          // Darcy Tier A
const LEAN_DAILY_OVERHEAD = 65;       // Mac's real overhead allocation per day worked
const MARKETING_RESERVE = 0;          // Darcy walked door — no ad cost on this lead

const { data: offers } = await sb.from('offers').select('id, slug')
  .eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, {
  tenantId: TENANT, offerIds: offers.map(o => o.id), measurements
});

const $ = n => '$' + Math.round(n).toLocaleString();
const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%';

function row(slug) {
  const o = q.offers[slug];
  const s = o.summary;
  const cats = s.byCategory || {};

  const sopSell = s.sellingPrice;
  const honoredSell = HONORED[slug];
  const hardCost = s.hardCost;
  const workdays = o.measurements.workdays;
  const sopTargetPct = slug === 'gold' ? 0.12 : slug === 'platinum' ? 0.17 : 0.23;
  const sopTargetNet = hardCost * sopTargetPct; // SOP target is % OF HARD COST

  // Real-money flow at honored price
  const grossProfit = honoredSell - hardCost;
  const commission = honoredSell * COMMISSION_PCT;
  const fixedOH = workdays * LEAN_DAILY_OVERHEAD;
  const realCashNet = grossProfit - commission - fixedOH - MARKETING_RESERVE;
  const realPerDay = realCashNet / workdays;

  return {
    slug, sopSell, honoredSell, hardCost, workdays, sopTargetPct, sopTargetNet,
    materials: cats.materials || 0,
    labor: cats.labor || 0,
    remediation: cats.remediation || 0,
    warranty: cats.warranty || 0,
    grossProfit,
    grossMarginPct: grossProfit / honoredSell,
    commission, fixedOH, realCashNet, realPerDay
  };
}

const rows = ['gold', 'platinum', 'diamond'].map(row);

// ── PER-SIDE TABLE ──
console.log('\n' + '═'.repeat(98));
console.log('PER-SIDE FINANCIALS — Honored Hiscock 2024 pricing · 33 SQ at 8/12 complex local · 3 workdays');
console.log('═'.repeat(98));
console.log('Line                              │  GOLD       │  PLATINUM   │  DIAMOND');
console.log('─'.repeat(98));
const fields = [
  ['Revenue (pre-tax)',           r => $(r.honoredSell)],
  ['  vs SOP price',              r => `${$(r.sopSell)} (${$(r.sopSell - r.honoredSell)} discount)`],
  ['HST collected (pass-through)', r => $(r.honoredSell * 0.15)],
  ['Customer pays total',         r => $(r.honoredSell * 1.15)],
  ['',                            r => ''],
  ['Materials',                   r => $(r.materials)],
  ['Labor (Ryan + supervisor)',   r => $(r.labor)],
  ['Remediation buffer',          r => $(r.remediation)],
  ['Warranty adder',              r => r.warranty > 0 ? $(r.warranty) : '—'],
  ['HARD COST TOTAL',             r => $(r.hardCost)],
  ['',                            r => ''],
  ['GROSS PROFIT (rev − hardcost)',r => `${$(r.grossProfit)}  (${pct(r.grossProfit, r.honoredSell)})`],
  ['',                            r => ''],
  ['Darcy commission (12%)',      r => $(r.commission)],
  ['Fixed OH ($65/day × 3 days)', r => $(r.fixedOH)],
  ['Marketing reserve',           r => MARKETING_RESERVE > 0 ? $(MARKETING_RESERVE) : '$0 (Darcy door)'],
  ['',                            r => ''],
  ['REAL CASH NET TO MAC',        r => $(r.realCashNet)],
  ['  per workday',               r => $(r.realPerDay) + '/day'],
  ['  margin of revenue',         r => pct(r.realCashNet, r.honoredSell)],
  ['',                            r => ''],
  ['SOP target net (reference)',  r => `${$(r.sopTargetNet)} (${(r.sopTargetPct*100).toFixed(0)}% of hard cost)`],
  ['  vs SOP target (gap)',       r => $(r.realCashNet - r.sopTargetNet)]
];
for (const [label, f] of fields) {
  const cells = rows.map(r => f(r).padStart(11));
  console.log(label.padEnd(33) + ' │ ' + cells.join(' │ '));
}

// ── COMBINED ──
console.log('\n' + '═'.repeat(98));
console.log('COMBINED — IF BOTH JEAN AND SHARON SIGN AT THE SAME TIER');
console.log('═'.repeat(98));
console.log('  (5 crew days for full duplex — single mob, shared delivery, supervisor allocation pooled)');
const COMBINED_DAYS = 5;
console.log();
const fields2 = [
  ['Revenue (both sides, pre-tax)',  r => $(r.honoredSell * 2)],
  ['Customer pays total',            r => $(r.honoredSell * 2 * 1.15)],
  ['Hard cost (both sides)',         r => $(r.hardCost * 2)],
  ['Gross profit',                   r => `${$(r.grossProfit * 2)}  (${pct(r.grossProfit, r.honoredSell)})`],
  ['Total commission paid out',      r => $(r.commission * 2)],
  ['Fixed OH ($65/day × 5)',         r => $(COMBINED_DAYS * LEAN_DAILY_OVERHEAD)],
  ['REAL CASH NET (both sides)',     r => $(r.realCashNet * 2 + (r.fixedOH * 2 - COMBINED_DAYS * LEAN_DAILY_OVERHEAD))],
  ['  per workday combined',         r => $((r.realCashNet * 2 + (r.fixedOH * 2 - COMBINED_DAYS * LEAN_DAILY_OVERHEAD)) / COMBINED_DAYS) + '/day'],
  ['  vs $700/day floor',            r => {
    const combined = (r.realCashNet * 2 + (r.fixedOH * 2 - COMBINED_DAYS * LEAN_DAILY_OVERHEAD)) / COMBINED_DAYS;
    return combined >= 700 ? `✓ +${$(combined - 700)}/day above` : `✗ ${$(700 - combined)}/day under`;
  }]
];
console.log('Line                              │  GOLD       │  PLATINUM   │  DIAMOND');
console.log('─'.repeat(98));
for (const [label, f] of fields2) {
  const cells = rows.map(r => f(r).padStart(11));
  console.log(label.padEnd(33) + ' │ ' + cells.join(' │ '));
}

// ── COMPARISON: HOLD vs HONOR ──
console.log('\n' + '═'.repeat(98));
console.log('DECISION COMPARISON — Hold SOP vs. Honor 2024 (per-side)');
console.log('═'.repeat(98));
console.log();
for (const r of rows) {
  // SOP-priced cash net
  const sopCommission = r.sopSell * COMMISSION_PCT;
  const sopGross = r.sopSell - r.hardCost;
  const sopRealCash = sopGross - sopCommission - r.fixedOH;
  const honoredRealCash = r.realCashNet;
  const opportunityCost = sopRealCash - honoredRealCash;

  console.log(`  ${r.slug.toUpperCase()}`);
  console.log(`    Hold at SOP $${r.sopSell.toLocaleString()}    → Mac keeps ${$(sopRealCash)} per side  (${$(sopRealCash * 2)} both sides)`);
  console.log(`    Honor at $${r.honoredSell.toLocaleString()}     → Mac keeps ${$(honoredRealCash)} per side  (${$(honoredRealCash * 2)} both sides)`);
  console.log(`    Cost of dropping price = ${$(opportunityCost)}/side · ${$(opportunityCost * 2)} combined if both sign`);
  console.log();
}

console.log('═'.repeat(98));
console.log('FINAL CALL — Honored pricing economics (Platinum, both signing, recommended tier):');
console.log('═'.repeat(98));
const plat = rows[1];
const platBoth = plat.realCashNet * 2 + (plat.fixedOH * 2 - COMBINED_DAYS * LEAN_DAILY_OVERHEAD);
console.log(`  Combined revenue:        ${$(plat.honoredSell * 2)}`);
console.log(`  Combined hard cost:      ${$(plat.hardCost * 2)}`);
console.log(`  Combined Darcy comm:     ${$(plat.commission * 2)}`);
console.log(`  Combined real OH:        ${$(COMBINED_DAYS * LEAN_DAILY_OVERHEAD)}`);
console.log(`  Real cash to Mac:        ${$(platBoth)} ← what's actually left after the dust settles`);
console.log(`  Per-day:                 ${$(platBoth / COMBINED_DAYS)}/day across ${COMBINED_DAYS} crew days`);
console.log(`  vs $700/day floor:       ${platBoth/COMBINED_DAYS >= 700 ? '✓ above' : '✗ below ($' + Math.round(700 - platBoth/COMBINED_DAYS) + '/day under)'}`);
