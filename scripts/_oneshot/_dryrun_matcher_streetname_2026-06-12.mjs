// Dry-run: old vs new payment matcher over the REAL payment ledger.
// Read-only, no writes. Run from repo root:
//   node scripts/_oneshot/_dryrun_matcher_streetname_2026-06-12.mjs
// Pulls the live payments table (GET /api/payments) + the live accepted-estimate
// pool (same two sources runCashflow uses, via deployed Ryujin APIs), then runs
// every payment through BOTH matchers and reports re-classifications.
import fs from 'node:fs';
import path from 'node:path';
import { matchPaymentToEstimate as newMatch } from '../../lib/paymentMatcher.js';

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

// The OLD matcher, verbatim from cashflow.js before this PR (number-only window).
function oldMatch(payment, estimates) {
  const pmtName = (payment.customer || '').toLowerCase().trim();
  if (!pmtName) return null;
  let hit = estimates.find(e => (e.fullName || '').toLowerCase().trim() === pmtName);
  if (hit) return hit;
  const pmtParts = pmtName.split(/\s+/);
  const lastName = pmtParts[pmtParts.length - 1];
  if (lastName && lastName.length >= 4) {
    const matches = estimates.filter(e => {
      const fn = (e.fullName || '').toLowerCase();
      const parts = fn.split(/\s+/);
      return parts[parts.length - 1] === lastName;
    });
    if (matches.length === 1) return matches[0];
  }
  if (payment.invoiceDescription) {
    const numMatch = payment.invoiceDescription.match(/\b(\d{2,5})\b/);
    if (numMatch) {
      const streetNum = parseInt(numMatch[1], 10);
      const exact = estimates.filter(e => (e.address || '').includes(numMatch[1]));
      if (exact.length === 1) return exact[0];
      const fuzzy = estimates.filter(e => {
        const m = (e.address || '').match(/\b(\d{2,5})\b/);
        if (!m) return false;
        return Math.abs(parseInt(m[1], 10) - streetNum) <= 20;
      });
      if (fuzzy.length === 1) return fuzzy[0];
    }
  }
  return null;
}

// Build the same unified estimate pool runCashflow uses.
async function getPool() {
  const pool = [];
  const lk = await fetch(`${BASE}/api/lookup?type=estimates`, { headers });
  const lkData = await lk.json();
  for (const src of lkData.results || []) {
    if (src.source !== 'Estimator OS') continue;
    for (const e of src.data || []) {
      if (e.proposalStatus === 'Accepted' || e.jobStatus === 'Proposal Accepted') {
        pool.push({ id: e.id, source: 'estimator-os', fullName: e.customer?.fullName || '', address: e.customer?.address || '' });
      }
    }
  }
  try {
    const r = await fetch(`${BASE}/api/estimates?tenant=plus-ultra&status=accepted&limit=100`, { headers });
    if (r.ok) {
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data.estimates || data.data || []);
      for (const e of arr) {
        pool.push({ id: e.id, source: 'ryujin', fullName: e.customer?.full_name || e.customer?.fullName || '', address: e.customer?.address || '' });
      }
    }
  } catch { /* ryujin source optional for the dry-run */ }
  return pool;
}

const pool = await getPool();
console.log(`estimate pool: ${pool.length} accepted estimates`);

const pr = await fetch(`${BASE}/api/payments?since_days=120&limit=500`, { headers });
if (!pr.ok) { console.error(`/api/payments HTTP ${pr.status}: ${await pr.text()}`); process.exit(1); }
const { payments } = await pr.json();
console.log(`payment ledger: ${payments.length} rows (since 120d)\n`);

let same = 0, lost = 0, gained = 0, changed = 0;
for (const row of payments) {
  const pmt = { customer: row.customer_name, invoiceDescription: row.invoice_description };
  const o = oldMatch(pmt, pool);
  const nw = newMatch(pmt, pool);
  const oId = o ? `${o.source}:${o.id}` : null;
  const nId = nw ? `${nw.source}:${nw.id}` : null;
  if (oId === nId) { same++; continue; }
  const tag = !nId ? (lost++, 'MATCH -> UNMATCHED') : !oId ? (gained++, 'UNMATCHED -> MATCH') : (changed++, 'MATCH -> DIFFERENT');
  console.log(`${tag}: ${row.customer_name} $${row.amount} "${row.invoice_description || ''}"`);
  console.log(`   old: ${o ? `${o.fullName} (${o.address})` : 'none'}  new: ${nw ? `${nw.fullName} (${nw.address})` : 'none'}`);
}
console.log(`\nRESULT: ${payments.length} payments, ${same} unchanged, ${lost} matched->unmatched, ${gained} unmatched->matched, ${changed} matched->different`);
