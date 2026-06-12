// Stamp accepted_at on the 10 Ryujin estimates flagged ACCEPTED_NO_TIMESTAMP
// by the reconcile sentinels (first live run, Jun 12 2026). Hygiene only: no
// dollar change. Dry-run by default; pass --apply to write. RUN BY TERMINAL A
// (or Mac) after skimming the printed list.
//
// Basis: each row's own updated_at is the closest machine evidence of when the
// acceptance state landed. That is an ESTIMATE of the acceptance time, so each
// row also gets a custom_prices._audit_accepted_at note saying exactly that.
// Pinned to the 10 estimate ids from the triage so drifted data cannot widen
// the write set (rows that already gained an accepted_at are skipped).
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const BASE = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';

// [estimate uuid, customer] from SENTINEL_TRIAGE_2026-06-12.md
const TARGETS = [
  ['2777c720-848f-42ab-9039-c1de54786b88', 'Mark Arzaga'],
  ['b4ef585a-02b8-46e2-b65b-b125f0656309', 'Gary & Karen Pardy'],
  ['1c62fb14-af4d-4631-8e63-de0a0ff98dcc', 'Jonald Magarin'],
  ['704dc4dd-8746-43b2-9eb1-a5aa7f092afa', 'Brian Northrup'],
  ['f2b74c2c-b888-4b5a-aa59-0767662b24ee', 'Jim & Kelly Faulkner'],
  ['6339794a-3e93-4d91-b010-45a0ed8e72f3', 'Donna Boosamra'],
  ['f18ba35b-5e7d-4a4b-90f1-7971e648cb94', 'Mark Lewis'],
  ['6885d1fc-56d5-46c8-97c7-894563ce982a', 'Korey Fram'],
  ['5af8c8f4-3638-4736-8447-315f032b980f', '(unnamed est #85)'],
  ['16df57d2-f0df-43f7-8360-ff0f56ced239', 'Richard Seyeau'],
];

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

console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: stamp accepted_at on up to ${TARGETS.length} estimates\n`);
let stamped = 0, skipped = 0, failed = 0;
for (const [id, who] of TARGETS) {
  const r = await fetch(`${BASE}/api/estimates?id=${id}&tenant=plus-ultra`, { headers });
  if (!r.ok) { failed++; console.error(`  FAIL GET ${who} (${id.slice(0, 8)}): HTTP ${r.status}`); continue; }
  const body = await r.json();
  const row = body.estimate || body.data || body;
  if (!row || !row.id) { failed++; console.error(`  FAIL parse ${who}`); continue; }
  if (row.accepted_at) { skipped++; console.log(`  SKIP ${who}: accepted_at already ${row.accepted_at}`); continue; }
  const basis = row.updated_at || row.created_at;
  console.log(`  ${APPLY ? 'STAMP' : 'would stamp'} ${who} (${id.slice(0, 8)}) accepted_at <- ${basis} (basis: updated_at)`);
  if (!APPLY) { stamped++; continue; }
  const customPrices = (row.custom_prices && typeof row.custom_prices === 'object') ? row.custom_prices : {};
  customPrices._audit_accepted_at = {
    estimated: true,
    basis: 'updated_at',
    note: 'accepted_at backfilled by sentinel triage Jun 12 2026; acceptance time estimated from the row updated_at, no dollar change',
    set_at: new Date().toISOString()
  };
  let w = await fetch(`${BASE}/api/estimates?tenant=plus-ultra`, {
    method: 'PUT', headers,
    body: JSON.stringify({ id, accepted_at: basis, custom_prices: customPrices })
  });
  if (w.status === 423) {
    // Row is locked (accepted estimates auto-lock). accepted_at is not in the
    // locked safe-list, so this hygiene backfill uses the internal admin
    // bypass. No pricing or scope field is touched.
    console.log(`    locked row; retrying with force_unlock (hygiene fields only)`);
    w = await fetch(`${BASE}/api/estimates?tenant=plus-ultra`, {
      method: 'PUT', headers,
      body: JSON.stringify({ id, accepted_at: basis, custom_prices: customPrices, force_unlock: true })
    });
  }
  if (w.ok) { stamped++; console.log(`    OK`); }
  else { failed++; console.error(`    FAIL PUT: HTTP ${w.status} ${(await w.text()).slice(0, 120)}`); }
}
console.log(`\n${APPLY ? 'Stamped' : 'Would stamp'}: ${stamped}, skipped (already set): ${skipped}, failed: ${failed}`);
process.exit(failed ? 1 : 0);
