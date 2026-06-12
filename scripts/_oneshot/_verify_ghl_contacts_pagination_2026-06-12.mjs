// Verify the GHL contacts pagination fix (PR fix/ghl-contacts-pagination).
// RUN BY TERMINAL A against deployed prod AFTER the deploy. Read-only, no writes.
//
// Before the fix: /api/ghl?action=contacts only ever returned the newest ~100
// contacts (oldest 2026-05-16) and ignored offset/page. After the fix, passing
// limit>100 pages via meta.startAfter, so we should reach contacts older than
// 2026-05-16 and surface the two May-task contacts that the overdue pass could
// not see through the list path: Lisa Cerwin (xagFzUEWoyvLTLE5VIsf) and
// Julie Pondant (12jEpSctxV4odjg26Yaw).
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
let TOKEN = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();

// Fall back to .env.local then the brain .env so A can run it from the repo root.
if (!TOKEN) {
  for (const p of ['.env.local', path.resolve(process.env.USERPROFILE || process.env.HOME || '.', 'OneDrive/Desktop/Plus Ultra/_brain/.env')]) {
    try {
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^RYUJIN_SERVICE_TOKEN\s*=\s*(.*)$/);
        if (m) { TOKEN = m[1].trim(); break; }
      }
    } catch { /* keep looking */ }
    if (TOKEN) break;
  }
}
if (!TOKEN) { console.error('No RYUJIN_SERVICE_TOKEN found'); process.exit(1); }

const headers = { Authorization: `Bearer ${TOKEN}`, 'x-tenant-id': 'plus-ultra' };
const TARGETS = { xagFzUEWoyvLTLE5VIsf: 'Lisa Cerwin', '12jEpSctxV4odjg26Yaw': 'Julie Pondant' };

const r = await fetch(`${BASE}/api/ghl?action=contacts&limit=500`, { headers });
const data = await r.json();
const contacts = data.contacts || [];
const dates = contacts.map(c => c.createdAt).filter(Boolean).sort();
const oldest = dates[0] || null;
const found = Object.keys(TARGETS).filter(id => contacts.some(c => c.id === id));

console.log(`HTTP ${r.status}, returned ${contacts.length} contacts (total ${data.total})`);
console.log(`oldest createdAt in page: ${oldest}`);
console.log(`reached past 2026-05-16: ${oldest && oldest < '2026-05-16' ? 'YES' : 'NO'}`);
console.log(`target May-task contacts found: ${found.length ? found.map(id => `${TARGETS[id]} (${id})`).join(', ') : 'NONE'}`);
const pass = contacts.length > 100 && found.length > 0;
console.log(`PAGINATION FIX ${pass ? 'VERIFIED' : 'NOT VERIFIED'}`);
process.exit(pass ? 0 : 2);
