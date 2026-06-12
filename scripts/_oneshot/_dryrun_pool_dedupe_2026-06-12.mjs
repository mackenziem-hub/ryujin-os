// Dry-run: estimate-pool dedupe effect on payment->contract bindings.
// Read-only, no writes. Run from repo root:
//   node scripts/_oneshot/_dryrun_pool_dedupe_2026-06-12.mjs
// Builds the cashflow estimate pool the OLD way (both sources concatenated,
// estimator-os first) and the NEW way (dedupeEstimatePool), then matches the
// live payment ledger against both and reports every binding whose contract
// value changes, plus the over-collection picture before vs after.
import fs from 'node:fs';
import path from 'node:path';
import { matchPaymentToEstimate, dedupeEstimatePool } from '../../lib/paymentMatcher.js';

const BASE = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
let TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
if (!TOKEN) {
  for (const p of ['.env.local', path.resolve(process.env.USERPROFILE || process.env.HOME || '.', 'OneDrive/Desktop/Plus Ultra/_brain/.env')]) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^RYUJIN_SERVICE_TOKEN\s*=\s*(.*)$/);
        if (m && m[1].trim()) { TOKEN = m[1].trim(); break; }
      }
    } catch { /* keep looking */ }
    if (TOKEN) break;
  }
}
if (!TOKEN) { console.error('No RYUJIN_SERVICE_TOKEN found'); process.exit(1); }
const headers = { Authorization: `Bearer ${TOKEN}`, 'x-tenant-id': 'plus-ultra' };

async function getPool() {
  const pool = [];
  const lk = await fetch(`${BASE}/api/lookup?type=estimates`, { headers });
  const lkData = await lk.json();
  for (const src of lkData.results || []) {
    if (src.source !== 'Estimator OS') continue;
    for (const e of src.data || []) {
      if (e.proposalStatus === 'Accepted' || e.jobStatus === 'Proposal Accepted') {
        pool.push({ id: e.id, source: 'estimator-os', fullName: e.customer?.fullName || '', address: e.customer?.address || '', finalAcceptedTotal: e.finalAcceptedTotal ?? null });
      }
    }
  }
  const r = await fetch(`${BASE}/api/estimates?tenant=plus-ultra&status=accepted&limit=100`, { headers });
  if (r.ok) {
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.estimates || data.data || []);
    for (const e of arr) {
      pool.push({ id: e.id, source: 'ryujin', fullName: e.customer?.full_name || e.customer?.fullName || '', address: e.customer?.address || '', finalAcceptedTotal: e.final_accepted_total ?? null });
    }
  }
  return pool;
}

const oldPool = await getPool();
const newPool = dedupeEstimatePool(oldPool);
console.log(`pool: ${oldPool.length} rows raw -> ${newPool.length} after dedupe (${oldPool.length - newPool.length} duplicate customer rows collapsed)\n`);

const pr = await fetch(`${BASE}/api/payments?since_days=120&limit=500`, { headers });
if (!pr.ok) { console.error(`/api/payments HTTP ${pr.status}`); process.exit(1); }
const { payments } = await pr.json();

const oldJobs = {}, newJobs = {};
function tally(jobs, est, amount) {
  const k = `${est.source}:${est.id}`;
  jobs[k] = jobs[k] || { customer: est.fullName, contract: est.finalAcceptedTotal, collected: 0 };
  jobs[k].collected += amount;
}
let rebound = 0;
for (const row of payments) {
  const pmt = { customer: row.customer_name, invoiceDescription: row.invoice_description };
  const o = matchPaymentToEstimate(pmt, oldPool);
  const nw = matchPaymentToEstimate(pmt, newPool);
  if (o) tally(oldJobs, o, parseFloat(row.amount));
  if (nw) tally(newJobs, nw, parseFloat(row.amount));
  const oK = o ? `${o.source}:${o.id}` : null;
  const nK = nw ? `${nw.source}:${nw.id}` : null;
  if (oK !== nK) {
    rebound++;
    console.log(`REBIND: ${row.customer_name} $${row.amount}`);
    console.log(`   old: ${o ? `${o.source}#${o.id} contract=${o.finalAcceptedTotal}` : 'unmatched'}  new: ${nw ? `${nw.source}#${nw.id} contract=${nw.finalAcceptedTotal}` : 'unmatched'}`);
  }
}

function overs(jobs) {
  return Object.values(jobs)
    .filter(j => j.contract != null && j.collected > j.contract + 1)
    .map(j => `${j.customer} collected ${j.collected.toFixed(2)} vs contract ${j.contract} (excess ${(j.collected - j.contract).toFixed(2)})`);
}
console.log(`\npayments rebound to a different estimate row: ${rebound}`);
console.log(`\nover-collections BEFORE dedupe:`); for (const s of overs(oldJobs)) console.log('  ' + s);
console.log(`over-collections AFTER dedupe:`); for (const s of overs(newJobs)) console.log('  ' + s);
