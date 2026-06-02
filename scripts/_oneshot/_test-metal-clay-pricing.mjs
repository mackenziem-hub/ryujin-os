// Fixture test for the metal "European Clay Imitation" road added to the
// envelope configurator. Proves:
//   1. A metal tier's explicit divisor `price` IS the selling price (the
//      asphalt multiplier is bypassed).
//   2. Remediation is gated by component `systems` (metal-over-shingle = none).
//   3. Asphalt behavior is unchanged (Platinum roof-only reconciles to $32,889).
import { computeEnvelope, computeAloneTotal, roofSelling } from '../../lib/envelopeEngine.js';

let pass = 0, fail = 0;
const ok  = (label, got, want) => { const good = got === want; console.log(`${good?'OK ':'FAIL'}  ${label}: got ${got} expected ${want}`); good ? pass++ : fail++; };

const env = {
  default_system: 'asphalt',
  show_systems: ['asphalt', 'metal'],
  standalone_multiplier: 1.52,
  standalone_mob_premium: 1200,
  cash_discount_tiers: [
    { threshold: 50000, pct: 3 }, { threshold: 75000, pct: 5 }, { threshold: 100000, pct: 7 }
  ],
  components: {
    roof_asphalt: { tiers: [
      { slug: 'platinum', tier: 2, label: 'Platinum', hard: 18793, popular: true }
    ] },
    roof_metal: { tiers: [
      // direct cost 31,100 → ÷0.53 ≈ 58,679 → rounded 58,700 (stored as price)
      { slug: 'clay', tier: 2, label: 'European Clay Imitation', hard: 31100, price: 58700, popular: true }
    ] },
    prep_redeck: { hard: 5500, label: 'Full Redeck', systems: ['asphalt'] },
    trim_gutters: { hard: 2720, label: 'Gutters' },
    remediation: { hard: 2500, label: 'Remediation Allowance', systems: ['asphalt'] }
  }
};

console.log('=== Test 1: metal clay roof-only uses divisor price, NOT multiplier ===');
const naiveMultiplier = Math.round((31100 + 1200) * 1.52); // what the OLD code would have charged
const m = computeEnvelope(env, { system: 'metal', roof: 'clay', siding: 'none', trim: {} });
const cash1 = Math.round(58700 * 0.03); // 3% pay-in-full discount kicks in above $50K
ok('roofSelling returns explicit price', roofSelling(env, env.components.roof_metal.tiers[0]), 58700);
ok('bundle.sellingPre = divisor price (pre-discount)', m.bundle.sellingPre, 58700);
ok('alonePreTax (separate price) = divisor price', m.alonePreTax, 58700);
ok('savings 0 on single-line roof-only', m.savings, 0);
ok('cash discount applies on $58.7K (3%)', m.cashOff, cash1);
ok('finalSelling = price - pay-in-full discount', m.finalSelling, 58700 - cash1);
console.log(`  (sanity: naive multiplier path would have been ${naiveMultiplier}, divisor is 58700 — bypass confirmed)`);

console.log('\n=== Test 2: metal carries NO remediation (over-shingle, no tear-off) ===');
ok('bundle.remediation 0 on metal', m.bundle.remediation, 0);

console.log('\n=== Test 3: metal clay + optional gutters add-on ===');
const mg = computeEnvelope(env, { system: 'metal', roof: 'clay', siding: 'none', trim: { gutters: true } });
const gutterAddon = Math.round((2720 + 1200) * 1.52); // standalone gutter line, one trip
const mgPre = 58700 + gutterAddon;
ok('metal + gutters bundle.sellingPre = price + gutter add-on', mg.bundle.sellingPre, mgPre);
ok('metal + gutters final = bundle - pay-in-full discount', mg.finalSelling, mgPre - Math.round(mgPre * 0.03));

console.log('\n=== Test 4: asphalt Platinum roof-only unchanged (reconciles to $32,889) ===');
const a = computeEnvelope(env, { system: 'asphalt', roof: 'platinum', siding: 'none', trim: {} });
const aWork = Math.round((18793 + 1200) * 1.52); // 30389
ok('asphalt work sellingPre', a.bundle.sellingPre, aWork);
ok('asphalt final = work + remediation 2500', a.finalSelling, aWork + 2500); // 32889
ok('asphalt carries remediation', a.bundle.remediation, 2500);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
