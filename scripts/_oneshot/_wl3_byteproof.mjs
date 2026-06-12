// White-label PR3 byte-identity proof.
//
// Renders the same fixtures through the BEFORE tree (origin/main) and the
// AFTER tree (feat/whitelabel-3-renderers) and compares sha256 of every
// output. The hard guard: plus-ultra customer-facing output must be
// BYTE-IDENTICAL. Date + Math.random are frozen so jsPDF/doc timestamps
// cannot fake a diff; a BEFORE-vs-BEFORE control run proves determinism.
//
// Usage: node scripts/_oneshot/_wl3_byteproof.mjs <beforeDir> <afterDir>

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('usage: node _wl3_byteproof.mjs <beforeDir> <afterDir>');
  process.exit(1);
}

// lib/supabase.js (pulled in transitively by quote engine imports) constructs
// clients at module load; give it harmless dummies. No network is touched.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'dummy';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy';

// Freeze time + randomness for determinism across the two trees.
const FROZEN = new Date('2026-06-12T12:00:00Z');
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) { super(FROZEN.getTime()); } else { super(...a); } }
  static now() { return FROZEN.getTime(); }
}
globalThis.Date = FrozenDate;
Math.random = () => 0.42;

const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : Buffer.from(x)).digest('hex').slice(0, 16);

async function load(dir) {
  const u = (p) => pathToFileURL(dir.replace(/\\+$/, '') + '/' + p).href;
  return {
    docR: await import(u('lib/documentRenderer.js')),
    outG: await import(u('lib/outputGenerators.js')),
    pdfR: await import(u('lib/pdfRenderer.js')),
  };
}

// ── fixtures (shared verbatim by both trees) ──
const FIX = {
  // every brand fallback fires
  proposalEmpty: {},
  // partial: company name only, rep absent
  proposalPartial: { company: { name: 'Plus Ultra Roofing' }, customer: { name: 'Jordan Fixture' } },
  salesEmpty: {},
  salesPartial: { branding: { companyName: 'Plus Ultra Roofing' }, hero: { headline: 'Jordan Fixture, your roof' } },
  contract: { customer: { name: 'Jordan Fixture' } },
  pickup: {},
  quote: {
    offerName: 'Platinum', system: 'asphalt',
    pricing: { sellingPrice: 17024, totalWithTax: 19577.6, hst: 2553.6 },
    lineItems: [], measurements: { roofAreaSq: 18 },
  },
  wo: {
    wo_number: 17, customer_name: 'Jordan Fixture', address: '12 Maple Crescent',
    start_date: '2026-06-20', status: 'issued', job_type: 'full_replacement',
    total_sq: 18, roof_pitch: '6/12', shingle_product: 'Landmark', package_tier: 'platinum',
    scope_items: ['Tear off', { item: 'Ice & water', included: true, qty: 3 }],
    special_notes: 'Watch the flower beds.', notes: 'Crew of four.',
  },
  ps: {
    job_id: 'PU-90', address: '12 Maple Crescent', customer_name: 'Jordan Fixture',
    subcontractor: 'Atlantic Fixture Co', status: 'scheduled',
    labour_breakdown: [{ description: 'Install', qty_sq: 18, rate_per_sq: '95', total: 1710 }],
    subtotal: 1710, hst: 256.5, total: 1966.5,
    payment_tracker: [{ method: 'etransfer', amount: 500 }],
    paid_to_date: 500, balance_due: 1466.5, scope_notes: ['Gables only'],
  },
};

async function renderAll(mods, label) {
  const out = {};
  const tryRun = (key, fn) => {
    try { out[key] = sha(fn()); }
    catch (e) { out[key] = 'THROW:' + String(e && e.message).slice(0, 60); }
  };
  tryRun('proposal.empty', () => mods.docR.renderProposalHTML(FIX.proposalEmpty));
  tryRun('proposal.partial', () => mods.docR.renderProposalHTML(FIX.proposalPartial));
  tryRun('sales.empty', () => mods.docR.renderSalesPageHTML(FIX.salesEmpty));
  tryRun('sales.partial', () => mods.docR.renderSalesPageHTML(FIX.salesPartial));
  tryRun('contract.html', () => mods.docR.renderContractHTML(FIX.contract));
  tryRun('pickup.html', () => mods.docR.renderMaterialPickupHTML(FIX.pickup));
  tryRun('gen.proposal', () => JSON.stringify(mods.outG.generateProposal(FIX.quote, {})));
  tryRun('gen.contract', () => JSON.stringify(mods.outG.generateContract(FIX.quote, {})));
  tryRun('gen.salespage', () => JSON.stringify(mods.outG.generateSalesPageData(FIX.quote, {})));
  tryRun('pdf.workorder', () => mods.pdfR.renderWorkOrderPDF(FIX.wo, {}));
  tryRun('pdf.paysheet', () => mods.pdfR.renderPaysheetPDF(FIX.ps));
  return out;
}

const before = await load(beforeDir);
const after = await load(afterDir);

// Control: BEFORE twice - proves the harness itself is deterministic.
const c1 = await renderAll(before, 'control1');
const c2 = await renderAll(before, 'control2');
let controlOk = true;
for (const k of Object.keys(c1)) if (c1[k] !== c2[k]) { controlOk = false; console.log('CONTROL NONDETERMINISTIC: ' + k); }
console.log('control (before vs before): ' + (controlOk ? 'DETERMINISTIC' : 'FAILED'));
if (!controlOk) process.exit(2);

const a = await renderAll(after, 'after');
let fail = 0;
console.log('\nkey                 before           after            verdict');
for (const k of Object.keys(c1)) {
  const same = c1[k] === a[k];
  if (!same) fail++;
  console.log(k.padEnd(20) + String(c1[k]).padEnd(17) + String(a[k]).padEnd(17) + (same ? 'IDENTICAL' : '*** DIFF ***'));
}
console.log('\n' + (fail ? fail + ' DIFFS - NOT byte-identical' : 'ALL OUTPUTS BYTE-IDENTICAL'));
process.exit(fail ? 1 : 0);
