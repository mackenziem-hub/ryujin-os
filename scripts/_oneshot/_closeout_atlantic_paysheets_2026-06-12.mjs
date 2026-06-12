// Owner-override close-out: mark the 9 Atlantic paysheets Mac settled
// out-of-band as PAID in the system. RUN BY TERMINAL A. Dry-run by default;
// pass --apply to write. Surface the printed list to Mac before applying.
//
// WHY: the system carries ~$56K of Atlantic AP that reads as unpaid, but per
// Mac (Jun 11, memory project_ryan_atlantic_balance_state_jun11) everything is
// settled out-of-band except 34 Wilbur ($3,596.51) and 51 Woodlawn ($4,293.41).
// Ryan has no system-side payment visibility, every AP read is inflated, and
// the MIT lists this as the close-out backlog.
//
// WHAT IT DOES per row (deployed API, no direct DB):
//   PUT /api/paysheets { id, paid_at, paid_to_date: total, balance_due: 0,
//                        payment_tracker: [...existing, closeout entry] }
//   Status is NOT changed: the DB CHECK only allows scheduled/in_progress/
//   completed/invoice_final/cancelled (no 'paid' value), and paid_at +
//   paid_to_date are the schema's designed paid markers (migrations 013 + 037).
//
// SCOPE (tripwires assert this exact scope at runtime):
//   - subcontractor 7a03d15e-5d3b-4b6b-876b-59e1ba2c0a86 (Atlantic) AND
//     status === 'completed' AND paid_at still null
//   - expected: exactly 9 rows totalling $39,524.03
//   EXCLUDED on purpose:
//   - 34 Wilbur (in_progress) + 51 Woodlawn (scheduled): genuinely owed
//   - 10 Edgewater (invoice_final): PAID per Mac but the payout amount is
//     disputed (disk $5,495.28 vs system $8,909.17). Close it manually once
//     Mac confirms the real figure.
//   - non-Atlantic subs and the two NULL-sub rows (need attribution first)
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const BASE = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
const ATLANTIC = '7a03d15e-5d3b-4b6b-876b-59e1ba2c0a86';
const EXPECT_COUNT = 9;
const EXPECT_TOTAL = 39524.03;

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
const headers = { Authorization: `Bearer ${TOKEN}`, 'x-tenant-id': 'plus-ultra', 'Content-Type': 'application/json' };

const r = await fetch(`${BASE}/api/paysheets?tenant=plus-ultra&limit=100`, { headers });
if (!r.ok) { console.error(`GET paysheets HTTP ${r.status}`); process.exit(1); }
const body = await r.json();
const rows = Array.isArray(body) ? body : (body.paysheets || body.data || []);

const targets = rows.filter(p =>
  p.subcontractor_id === ATLANTIC &&
  p.status === 'completed' &&
  p.paid_at == null
);
const total = Math.round(targets.reduce((s, p) => s + Number(p.total || 0), 0) * 100) / 100;

console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: ${targets.length} Atlantic completed+unpaid paysheets, $${total.toFixed(2)}\n`);
for (const p of targets) {
  console.log(`  ${p.id.slice(0, 8)}  $${Number(p.total).toFixed(2).padStart(9)}  ${p.customer_name || '(no name)'}  ${p.address || ''}`);
}

// Tripwires: if live data drifted from the verified Jun 12 scope, abort rather
// than write a different set than Mac confirmed.
if (targets.length !== EXPECT_COUNT || Math.abs(total - EXPECT_TOTAL) > 0.01) {
  console.error(`\nABORT: scope drifted (expected ${EXPECT_COUNT} rows / $${EXPECT_TOTAL}, found ${targets.length} / $${total}).`);
  console.error('Re-verify against Mac before applying. No writes made.');
  process.exit(2);
}

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to write (after surfacing the list to Mac).');
  process.exit(0);
}

const now = new Date().toISOString();
let ok = 0, fail = 0;
for (const p of targets) {
  const tracker = Array.isArray(p.payment_tracker) ? p.payment_tracker : [];
  tracker.push({
    date: now,
    method: 'etransfer_oob',
    amount: Number(p.total),
    note: 'Owner close-out: settled out-of-band per Mac confirmation Jun 11 2026. Backfilled by _closeout_atlantic_paysheets_2026-06-12.'
  });
  const resp = await fetch(`${BASE}/api/paysheets`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      id: p.id,
      paid_at: now,
      paid_to_date: Number(p.total),
      balance_due: 0,
      payment_tracker: tracker
    })
  });
  if (resp.ok) { ok++; console.log(`  PAID ${p.id.slice(0, 8)} ${p.customer_name || ''}`); }
  else { fail++; console.error(`  FAIL ${p.id.slice(0, 8)} HTTP ${resp.status}: ${(await resp.text()).slice(0, 150)}`); }
}
console.log(`\nDone: ${ok} closed out, ${fail} failed.`);
console.log('Open Atlantic items remaining: 34 Wilbur $3,596.51 (in_progress), 51 Woodlawn $4,293.41 (scheduled), 10 Edgewater held for amount confirm.');
process.exit(fail ? 1 : 0);
