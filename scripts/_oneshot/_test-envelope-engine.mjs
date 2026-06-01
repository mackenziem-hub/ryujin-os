// Smoke test for envelopeEngine. Asserts a few key combos return sane numbers.
import { computeEnvelope, computeStandalone, resolveBundleTier, resolveEveModifier, getPackageName } from '../../lib/envelopeEngine.js';

const ENV = {
  default_system: 'metal',
  components: {
    roof_metal: {
      tiers: [
        { slug: 'metal-americana',     tier: 1, hard: 11300, label: 'Metal Standard' },
        { slug: 'metal-standing-seam', tier: 2, hard: 12600, label: 'Metal Enhanced' },
        { slug: 'metal-premium',       tier: 3, hard: 18300, label: 'Metal Premium' }
      ]
    },
    roof_asphalt: {
      tiers: [
        { slug: 'gold',     tier: 1, hard: 5400, label: 'Gold' },
        { slug: 'platinum', tier: 2, hard: 7000, label: 'Platinum' },
        { slug: 'diamond',  tier: 3, hard: 10200, label: 'Diamond' }
      ]
    },
    wall_assembly: { hard: 8500, label: 'OSB + foam + VentiGrid' },
    siding: {
      tiers: [
        { slug: 'none',           tier: 0, hard: 0,     label: 'Skip siding' },
        { slug: 'vinyl-standard', tier: 1, hard: 5000,  label: 'Standard Vinyl' },
        { slug: 'vinyl-sequoia',  tier: 2, hard: 8800,  label: 'Sequoia Premium' },
        { slug: 'cedar-shake',    tier: 3, hard: 10500, label: 'Cedar Shake' }
      ]
    },
    trim_gutters: { hard: 1000, label: 'Gutters' },
    trim_soffit:  { hard: 1200, label: 'Soffit' },
    trim_fascia:  { hard: 700,  label: 'Fascia' }
  }
};

function assertNum(actual, expected, label, tolerance = 50) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label}: got ${actual} expected ~${expected}`);
  if (!ok) process.exitCode = 1;
}

console.log('\n=== Test 1: Metal Standard alone, no siding ===');
let r1 = computeEnvelope(ENV, { system: 'metal', roof: 'metal-americana', siding: 'none', trim: {} });
console.log('  packageName:', r1.packageName);
console.log('  bundle.mode:', r1.bundle.mode);
console.log('  sellingPre:', r1.bundle.sellingPre, 'withTax:', r1.bundle.sellingWithTax);
console.log('  savings:', r1.savings);
// (11300+1200) × 1.52 = 19000
assertNum(r1.bundle.sellingPre, 19000, 'metal-std alone selling');
assertNum(r1.savings, 0, 'no savings (single component)');

console.log('\n=== Test 2: Metal Enh + Sequoia, no trim (Performance Shell Plus) ===');
let r2 = computeEnvelope(ENV, { system: 'metal', roof: 'metal-standing-seam', siding: 'vinyl-sequoia', trim: {} });
console.log('  packageName:', r2.packageName);
console.log('  bundle.mode:', r2.bundle.mode);
console.log('  totalHard:', r2.bundle.totalHard, 'mult:', r2.bundle.tier?.mult);
console.log('  sellingPre:', r2.bundle.sellingPre, 'withTax:', r2.bundle.sellingWithTax);
console.log('  alonePreTax:', r2.alonePreTax);
console.log('  savings:', r2.savings);
// hard = 12600 + 8500 + 8800 = 29900; × 1.52 = 45448
assertNum(r2.bundle.totalHard, 29900, 'shell-plus hard total');
assertNum(r2.bundle.sellingPre, 45448, 'shell-plus selling');
// Alone: roof (12600+1200)*1.52 = 20976; siding+wall (8800+8500+1200)*1.52 = 28120; sum = 49096
assertNum(r2.alonePreTax, 49096, 'shell-plus alone total', 100);
// savings = 49096 - 45448 = 3648
assertNum(r2.savings, 3648, 'shell-plus savings', 100);

console.log('\n=== Test 3: Metal Prem + Cedar Shake + all 3 trim (Plus Ultra + Ultra Eve) ===');
let r3 = computeEnvelope(ENV, {
  system: 'metal',
  roof: 'metal-premium',
  siding: 'cedar-shake',
  trim: { gutters: true, soffit: true, fascia: true }
});
console.log('  packageName:', r3.packageName);
console.log('  bundle.mode:', r3.bundle.mode);
console.log('  totalHard:', r3.bundle.totalHard, 'mult:', r3.bundle.tier?.mult);
console.log('  sellingPre:', r3.bundle.sellingPre);
console.log('  alonePreTax:', r3.alonePreTax);
console.log('  savings:', r3.savings);
console.log('  cashDiscount:', JSON.stringify(r3.cashDiscount));
console.log('  finalSelling:', r3.finalSelling);
// hard = 18300 + 8500 + 10500 + 1000+1200+700 = 40200; × 1.58 = 63516
assertNum(r3.bundle.totalHard, 40200, 'ultra hard total');
assertNum(r3.bundle.sellingPre, 63516, 'ultra selling');
console.log('  expected packageName ends with "Ultra Eve Protection":', r3.packageName.endsWith('Ultra Eve Protection') ? 'OK' : 'FAIL');

console.log('\n=== Test 4: Asphalt Gold + Standard Vinyl (Performance Shell entry) ===');
let r4 = computeEnvelope(ENV, { system: 'asphalt', roof: 'gold', siding: 'vinyl-standard', trim: {} });
console.log('  packageName:', r4.packageName);
// hard = 5400+8500+5000 = 18900; × 1.47 = 27783
assertNum(r4.bundle.sellingPre, 27783, 'shell entry selling', 100);
console.log('  expected name "Performance Shell":', r4.packageName === 'Performance Shell' ? 'OK' : 'FAIL');

console.log('\n=== Test 5: Cash discount unlocks at $50K ===');
let r5 = computeEnvelope(ENV, {
  system: 'metal',
  roof: 'metal-premium',
  siding: 'vinyl-sequoia',
  trim: { gutters: true, soffit: true, fascia: true }
});
console.log('  bundle.sellingPre:', r5.bundle.sellingPre);
console.log('  cashDiscount:', JSON.stringify(r5.cashDiscount));
console.log('  cashOff:', r5.cashOff, '(should be > 0 if bundle > $50K)');

console.log('\n=== Test 6: Remediation = FACE VALUE, added after markup (bundle.sellingPre is work-only) ===');
const ENV_REM = JSON.parse(JSON.stringify(ENV));
ENV_REM.components.remediation = { hard: 2500, label: 'Remediation Allowance' };
// Bundle work = Test 4 (gold+std vinyl): 18900 × 1.47 = 27783 (no cash discount). final = 27783 + 2500 face
const r6 = computeEnvelope(ENV_REM, { system: 'asphalt', roof: 'gold', siding: 'vinyl-standard', trim: {} });
console.log('  work sellingPre:', r6.bundle.sellingPre, '| remediation:', r6.remediation, '| final:', r6.finalSelling);
assertNum(r6.bundle.sellingPre, 27783, 'bundle work sellingPre (no allowance)');
assertNum(r6.finalSelling, 30283, 'bundle final = work + face allowance');
// Standalone work = gold alone (5400+1200)×1.52 = 10032; final = 10032 + 2500 face
const r7 = computeEnvelope(ENV_REM, { system: 'asphalt', roof: 'gold', siding: 'none', trim: {} });
console.log('  work sellingPre:', r7.bundle.sellingPre, '| final:', r7.finalSelling);
assertNum(r7.finalSelling, 12532, 'standalone final = work + face allowance');
// No roof selected → no project, no allowance
const r8 = computeEnvelope(ENV_REM, { system: 'asphalt', roof: null, siding: 'none', trim: {} });
assertNum(r8.finalSelling, 0, 'no roof → no allowance, final 0');

console.log('\n=== Test 7: Cash discount applies to WORK only, never the refundable allowance ===');
// metal-premium 18300 + wall 8500 + sequoia 8800 = 35600 work; score 5 → shell_ultra 1.58 = 56248
// cashOff = 3% of 56248 (work) = 1687, NOT 3% of (56248+2500). final = 56248 - 1687 + 2500
const r9 = computeEnvelope(ENV_REM, { system: 'metal', roof: 'metal-premium', siding: 'vinyl-sequoia', trim: {} });
console.log('  work sellingPre:', r9.bundle.sellingPre, '| cashOff:', r9.cashOff, '| remediation:', r9.remediation, '| final:', r9.finalSelling);
assertNum(r9.bundle.sellingPre, 56248, 'work sellingPre (discount base)');
assertNum(r9.cashOff, 1687, 'cash discount on work only (not allowance)');
assertNum(r9.finalSelling, 57061, 'final = work - discount + face allowance');

console.log('\n=== Done ===\n');
