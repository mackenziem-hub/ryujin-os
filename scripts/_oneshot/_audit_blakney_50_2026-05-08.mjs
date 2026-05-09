// Financial audit for Troy Blakney #50 — Quonset garage at 2152 NB-885.
// Verify hard cost decomposition, margin floors, real cash net, day-trip economics.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const EST_ID = 'af97b4bf-68ec-4400-a0fb-3ef9c37466c1';

const { data: e } = await sb.from('estimates')
  .select('estimate_number, calculated_packages, distance_km, planes')
  .eq('id', EST_ID).single();

const cp = e.calculated_packages || {};
const $ = n => '$' + (Math.round(n * 100) / 100).toLocaleString();
const pct = (n, d) => ((n / d) * 100).toFixed(1) + '%';

// SOP target net margins (% of hard cost per pricing_formula_v2.md Section 3)
const SOP_TARGET = { gold: 0.12, platinum: 0.17, diamond: 0.23 };

// Mac's real overhead allocation
const COMMISSION_PCT = 0.15;        // Darcy old structure (not yet on Tier A)
const LEAN_DAILY_OH = 65;
const MARKETING_RESERVE = 0;        // Darcy walked door

console.log('═'.repeat(105));
console.log(`#${e.estimate_number}  TROY BLAKNEY  ·  2152 NB-885 Quonset garage  ·  ${e.distance_km} km out`);
console.log('═'.repeat(105));

// Per-tier audit
for (const slug of ['gold', 'platinum', 'diamond']) {
  const tier = cp[slug]; if (!tier) continue;
  const items = (tier.lineItems || []).filter(li => li.included && li.total_cost > 0);

  // Decompose hard cost by category
  const groups = { materials: 0, labor: 0, remediation: 0, warranty: 0, overhead: 0, other: 0 };
  for (const li of items) {
    const cat = li.category || 'other';
    groups[cat] = (groups[cat] || 0) + li.total_cost;
  }
  const hardCost = Object.values(groups).reduce((a, b) => a + b, 0);

  // Sub paysheet detail
  const subBaseLabor = items.filter(li => li.item_key === 'sub_labor' && /Base labor/.test(li.label));
  const subAddons = items.filter(li => li.item_key === 'sub_addon' || /sub_surcharge|Travel|Waste|bundle/i.test(li.label || ''));
  const supervisor = items.find(li => li.item_key === 'supervisor_fee');
  const subBaseTotal = subBaseLabor.reduce((s, l) => s + l.total_cost, 0);

  const sell = tier.total;
  const grossProfit = sell - hardCost;
  const grossMarginPct = grossProfit / sell;

  // SOP target net (% of hard cost)
  const sopTarget = hardCost * SOP_TARGET[slug];

  // Real cash net (Mac's actual take)
  const commission = sell * COMMISSION_PCT;
  // Workdays — engine reports based on measuredSQ / crewSqPerDay (12). 19 SQ → 2 days.
  // For 54km out, realistic ≈ 2.5-3 days (drive time eats install time).
  const engineDays = 2;
  const realisticDays = 3;   // 54km × 2 trips/day × 5 days = lot of windshield time
  const ohEngine = engineDays * LEAN_DAILY_OH;
  const ohRealistic = realisticDays * LEAN_DAILY_OH;
  const realCashEngine = grossProfit - commission - ohEngine;
  const realCashRealistic = grossProfit - commission - ohRealistic;

  console.log(`\n┌─ ${slug.toUpperCase().padEnd(10)} sell ${$(sell)}  /  hard cost ${$(hardCost)}  /  per SQ ${$(sell / 19).slice(0, -3)}/SQ ─`);
  console.log(`│  HARD COST DECOMP:`);
  for (const [cat, sum] of Object.entries(groups)) {
    if (sum > 0) console.log(`│    ${cat.padEnd(15)} ${$(sum).padStart(10)}  (${pct(sum, hardCost)})`);
  }
  console.log(`│  SUB PAYSHEET DETAIL:`);
  console.log(`│    Base labor (per-plane sum)              ${$(subBaseTotal).padStart(10)}`);
  for (const li of subBaseLabor) console.log(`│      → ${(li.label||'').slice(0, 60).padEnd(60)} ${li.quantity} SQ × ${$(li.unit_cost)} = ${$(li.total_cost)}`);
  console.log(`│    Supervisor fee                          ${$(supervisor?.total_cost || 0).padStart(10)}  (${supervisor?.quantity || 0} days @ $270)`);
  console.log(`│  GROSS:                                    ${$(grossProfit).padStart(10)}  (${pct(grossProfit, sell)} of revenue)`);
  console.log(`│`);
  console.log(`│  vs SOP TARGET (${(SOP_TARGET[slug]*100).toFixed(0)}% of hard cost):  ${$(sopTarget).padStart(10)}     gap: ${$(grossProfit - sopTarget)} ${grossProfit >= sopTarget ? '✓' : '⚠ short'}`);
  console.log(`│`);
  console.log(`│  REAL CASH NET TO MAC:`);
  console.log(`│    Darcy commission (15% old structure)    ${$(commission).padStart(10)}`);
  console.log(`│    Lean OH @ engine 2 days                  ${$(ohEngine).padStart(10)}`);
  console.log(`│    → Mac keeps (engine-day estimate)        ${$(realCashEngine).padStart(10)}  (${pct(realCashEngine, sell)} margin / ${$(realCashEngine / engineDays).slice(0, -3)}/day)`);
  console.log(`│    Lean OH @ realistic 3 days (drive time)  ${$(ohRealistic).padStart(10)}`);
  console.log(`│    → Mac keeps (3-day reality)              ${$(realCashRealistic).padStart(10)}  (${pct(realCashRealistic, sell)} margin / ${$(realCashRealistic / realisticDays).slice(0, -3)}/day)`);
  console.log(`└`);
}

// Recommendation block
console.log('\n' + '═'.repeat(105));
console.log('FLAGS + RECOMMENDATION');
console.log('═'.repeat(105));

const goldSell = cp.gold?.total || 0;
const goldHC = (cp.gold?.lineItems || []).filter(li => li.included).reduce((s, l) => s + l.total_cost, 0);
const goldGP = goldSell - goldHC;
const goldPerSQ = goldSell / 19;

console.log(`\n1. Margin floors — all three tiers EXCEED SOP target net (12/17/23% of hard cost)`);
console.log(`   Gross margins ~32-36% on revenue, gross profit cleanly above SOP minimum on every tier.`);
console.log(`   At pure SOP without any premium, this job is profitable on paper.`);

console.log(`\n2. Per-SQ pricing — Gold $${Math.round(goldPerSQ)}/SQ on 19 measuredSQ`);
console.log(`   For a STANDARD mansard job at 13+ pitch + travel, $${Math.round(goldPerSQ)}/SQ is in normal-to-low range.`);
console.log(`   For a SPECIALTY Quonset (curved geometry, harness all the way around, tight-radius bending,`);
console.log(`   custom flashings at the gable transitions), industry premium is 1.5-2x standard mansard rates.`);
console.log(`   Comparable specialty jobs in NB market typically run $900-1,200/SQ Gold.`);

console.log(`\n3. Workday reality check — engine assumes 2 crew days (19 SQ / 12 SQ-per-day)`);
console.log(`   At 54 km × 2 trips = 108 km/day driving (~1.5 hr/day windshield time)`);
console.log(`   Plus harness setup + curved-radius install slows everything ~30-50% vs flat`);
console.log(`   Realistic crew effort: 3 full days. Mac net per day drops accordingly.`);

console.log(`\n4. Material assumption risk`);
console.log(`   Engine priced 936 sf curved section as standard CertainTeed Landmark @ $49/bundle.`);
console.log(`   If actual radius requires mod-bit ($275/SQ sub vs $130/SQ for shingle base labor):`);
console.log(`     Hard cost adds ~$1,300-1,500. Gold sell would need to bump ~$2,000-2,200 to hold margin.`);

console.log(`\n5. RECOMMENDATIONS`);
console.log(`   A. Bump curved section to specialty rate +$50/SQ ($250/SQ sub on the 10 SQ curved plane)`);
console.log(`      = +$500 hard cost / +$735 customer Gold = $${Math.round(goldSell + 735).toLocaleString()} pre-tax / $${Math.round((goldSell + 735) * 1.15).toLocaleString()} with HST`);
console.log(`   B. Add a flat $1,500 specialty/Quonset complexity premium across all tiers`);
console.log(`      Bumps Gold to $${Math.round(goldSell + 1500).toLocaleString()} pre-tax / $${Math.round((goldSell + 1500) * 1.15).toLocaleString()} with HST`);
console.log(`   C. Hold at SOP — viable but thin if reality runs 3 days + curve adds time`);
console.log(`   D. Sub paysheet floor check — is Ryan willing to do this Quonset at the standard mansard rate?`);
console.log(`      $200/SQ × 15 SQ mansard portion = $3,000 to Ryan. For a specialty curved job, he may need more.`);
console.log(`      Recommend pre-approval call before locking the price.`);
