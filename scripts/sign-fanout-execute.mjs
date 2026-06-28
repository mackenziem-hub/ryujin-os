// CONTROLLED TEST of the sign choreography executor (lib/signFanout.js).
// Runs executeSignFanout against a SYNTHETIC test job (no real customer touched),
// prints the real artifacts created, then cleans them up. Proves the live path
// before it is hooked into the sign endpoint for all signings.
//
// Usage: node --env-file=.env.local scripts/sign-fanout-execute.mjs

import { executeSignFanout } from '../lib/signFanout.js';

function clean(v) { return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').trim(); }
const SUPA = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_KEY);
const SVC = clean(process.env.RYUJIN_SERVICE_TOKEN);
const APP = clean(process.env.RYUJIN_APP_URL) || 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(p, init) { const r = await fetch(`${SUPA}/rest/v1/${p}`, { headers: H, ...init }); return r; }

const T = await (await rest(`tenants?slug=eq.${TENANT}&select=id`)).json();
const tid = T[0].id;
const users = await (await rest(`users?tenant_id=eq.${tid}&select=id,name`)).json();
const byFirst = (n) => (users.find(u => String(u.name || '').toLowerCase().startsWith(n)) || {}).id || null;
const people = { ryan: byFirst('ryan'), diego: byFirst('diego'), cat: byFirst('cath') || byFirst('cat'), mac: byFirst('mac') };

// Synthetic test job (clearly labeled, no real customer record).
const job = {
  customer: 'TEST - Sign Fanout (auto-cleanup)',
  address: 'TEST job site',
  phone: null,
  total_incl_hst: 9999,
  estimate_id: null, // null -> not linked to a real estimate
  scope_summary: 'TEST package',
  labour_total: null,
};

console.log('=== CONTROLLED TEST: executeSignFanout (synthetic job) ===');
const res = await executeSignFanout(job, people, { baseUrl: APP, serviceToken: SVC, tenant: TENANT });
console.log('skipped:', res.skipped);
console.log('\nArtifacts created:');
for (const c of res.created) {
  if (c.error) console.log(`  [FAIL] ${c.kind} -> ${c.to}: ${c.error}`);
  else console.log(`  [OK]   ${c.kind} -> ${c.to}  id=${c.id}${c.number ? ' #' + c.number : ''}`);
}

// Cleanup: delete the test artifacts so no test data lingers.
console.log('\nCleaning up test artifacts...');
const tableOf = { paysheet: 'paysheets', workorder: 'workorders', task: 'tickets' };
let cleaned = 0;
for (const c of res.created) {
  if (!c.id) continue;
  const tbl = tableOf[c.kind];
  try {
    const r = await rest(`${tbl}?id=eq.${c.id}`, { method: 'DELETE', headers: { ...H, Prefer: 'return=minimal' } });
    if (r.ok) { cleaned++; }
    else console.log(`  could not delete ${c.kind} ${c.id}: HTTP ${r.status}`);
  } catch (e) { console.log(`  cleanup error ${c.kind} ${c.id}: ${e.message}`); }
}
console.log(`Cleaned ${cleaned}/${res.created.filter(c => c.id).length} test artifacts.`);
console.log('\nVerdict:', res.created.every(c => c.id && !c.error) ? 'ALL 4 ARTIFACTS FIRED OK -> executor is live-ready' : 'SOME ARTIFACTS FAILED -> see errors above');
