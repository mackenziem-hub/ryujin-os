// Dry-run of the sign choreography (lib/signFanout.js): show EXACTLY what would
// fan out when a real job signs. NO writes. Eyeball the roster + dollars before
// anything auto-creates (paysheets are real money).
//
// Usage (from C:/Users/Owner/Code/ryujin-os* with .env.local):
//   node --env-file=.env.local scripts/sign-fanout-dryrun.mjs [estimate_number]
// Defaults to a real recent hot-pipeline deal when no number is given.

import { planSignFanout } from '../lib/signFanout.js';

function clean(v) { return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').trim(); }
const SUPA = clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_KEY);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(p) { const r = await fetch(`${SUPA}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }

const TENANT = 'plus-ultra';
const argNum = process.argv[2];

const T = await rest(`tenants?slug=eq.${TENANT}&select=id`);
const tid = T[0].id;

// Resolve the fan-out people by first name (robust to id changes).
const users = await rest(`users?tenant_id=eq.${tid}&select=id,name,role`);
const byFirst = (n) => (users.find(u => String(u.name || '').toLowerCase().startsWith(n)) || {}).id || null;
const people = { ryan: byFirst('ryan'), diego: byFirst('diego'), cat: byFirst('cath') || byFirst('cat'), mac: byFirst('mac') };

// Pull a real signed job to demo against (an estimate). Default: a real hot deal.
const sel = 'estimate_number,selected_package,calculated_packages,customers(full_name,address,phone)';
let est;
if (argNum) {
  est = (await rest(`estimates?tenant_id=eq.${tid}&estimate_number=eq.${argNum}&select=${sel}&limit=1`))[0];
} else {
  // newest with a customer + a value; representative of a job that just signed
  const rows = await rest(`estimates?tenant_id=eq.${tid}&select=${sel}&order=updated_at.desc&limit=40`);
  est = rows.find(e => e.customers && e.customers.full_name && e.calculated_packages) || rows[0];
}
if (!est) { console.error('No estimate found to demo against.'); process.exit(1); }

const cp = est.calculated_packages || {};
const tier = cp[est.selected_package || 'platinum'] || cp.platinum || cp.gold || cp.economy || {};
const total = (tier.total != null ? tier.total * 1.15 : null) || (tier.summary && tier.summary.sellingPrice) || null;
const job = {
  customer: (est.customers || {}).full_name,
  address: (est.customers || {}).address,
  phone: (est.customers || {}).phone,
  total_incl_hst: total ? Math.round(total) : null,
  job_type: est.job_type || 'roof',
  estimate_id: est.estimate_number,
  scope_summary: `${est.selected_package || 'roof'} package`,
  labour_total: null, // computed from EagleView at execute, never the customer total
};

const plan = planSignFanout(job, people);

const fmt$ = (n) => n == null ? '(n/a)' : '$' + Number(n).toLocaleString();
console.log(`\n=== SIGN CHOREOGRAPHY · DRY RUN (no writes) ===`);
console.log(`Trigger: ${plan.job.customer} signs - ${plan.job.address} - ${fmt$(plan.job.total_incl_hst)} (estimate #${plan.job.estimate_id})\n`);
console.log(`The moment they sign, ${plan.artifacts.length} artifacts auto-fire:\n`);
for (const a of plan.artifacts) {
  const icon = a.kind === 'paysheet' ? '[PAYSHEET]' : a.kind === 'workorder' ? '[WORKORDER]' : '[TASK]    ';
  console.log(`  ${icon} -> ${a.to}`);
  if (a.kind === 'task') console.log(`     "${a.fields.title}"  (priority ${a.fields.priority})`);
  if (a.kind === 'paysheet') console.log(`     subcontractor pay, ${a.note}`);
  if (a.kind === 'workorder') console.log(`     ${a.note}`);
  console.log('');
}
if (plan.warnings.length) { console.log('WARNINGS:'); for (const w of plan.warnings) console.log(`  ! ${w}`); }
else console.log('All fan-out targets resolved to real users. Ready to wire live after review.');
console.log(`\nResolved people: Ryan=${people.ryan ? 'ok' : 'MISSING'} Diego=${people.diego ? 'ok' : 'MISSING'} Cat=${people.cat ? 'ok' : 'MISSING'} Mac=${people.mac ? 'ok' : 'MISSING'}`);
console.log('\nFull JSON plan:');
console.log(JSON.stringify(plan, null, 1));
