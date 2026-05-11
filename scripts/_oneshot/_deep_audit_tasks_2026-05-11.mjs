// Deep audit of tasks/tickets/assignments. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug','plus-ultra').single();
const T = tenant.id;
const now = new Date();

// Helpers
const { data: users } = await sb.from('users').select('id,name,role,active').eq('tenant_id', T);
const uName = (id) => users.find(u => u.id === id)?.name || (id ? id.slice(0,8) : '—');
const uRole = (id) => users.find(u => u.id === id)?.role || '—';

console.log('═══ USERS ═══');
for (const u of users) console.log(`  ${u.id.slice(0,8)}  ${u.name.padEnd(22)} ${u.role.padEnd(12)} active=${u.active}`);

// ── service_tickets ───────────────────────────────────────────
console.log('\n═══ SERVICE_TICKETS (all open / active) ═══');
const { data: tickets } = await sb.from('service_tickets')
  .select('id, title, status, priority, assigned_to, created_by, due_date, created_at, updated_at, customer_id, address, category, sub_status')
  .eq('tenant_id', T)
  .order('created_at', { ascending: false })
  .limit(500);

const openStatuses = ['open','in_progress','active','pending','scheduled'];
const opens = (tickets || []).filter(t => openStatuses.includes((t.status||'').toLowerCase()));
const closed = (tickets || []).filter(t => !openStatuses.includes((t.status||'').toLowerCase()));

console.log(`  Total tickets: ${(tickets||[]).length}`);
console.log(`  Open/active:   ${opens.length}`);
console.log(`  Closed/done:   ${closed.length}`);

// Assignment by user
const byOwner = new Map();
for (const t of opens) {
  const owner = uName(t.assigned_to);
  byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
}
console.log('\n  Open tickets by assignee:');
for (const [name, n] of [...byOwner.entries()].sort((a,b) => b[1]-a[1])) {
  console.log(`    ${n.toString().padStart(3)}  ${name}`);
}

// Overdue
const overdue = opens.filter(t => t.due_date && new Date(t.due_date) < now);
console.log(`\n  Overdue: ${overdue.length}`);
for (const t of overdue.slice(0,8)) {
  const days = Math.ceil((now - new Date(t.due_date)) / 86400000);
  console.log(`    [${days}d overdue]  ${uName(t.assigned_to).padEnd(15)} ${(t.title||'').slice(0,55)}`);
}

// Stale (no activity in 14d)
const stale = opens.filter(t => t.updated_at && (now - new Date(t.updated_at)) > 14 * 86400000);
console.log(`\n  Stale (no update 14d+): ${stale.length}`);
for (const t of stale.slice(0,8)) {
  const days = Math.ceil((now - new Date(t.updated_at)) / 86400000);
  console.log(`    [${days}d stale]  ${uName(t.assigned_to).padEnd(15)} ${(t.title||'').slice(0,55)}`);
}

// Unassigned
const unassigned = opens.filter(t => !t.assigned_to);
console.log(`\n  Unassigned open: ${unassigned.length}`);
for (const t of unassigned.slice(0,8)) console.log(`    ${(t.title||'').slice(0,80)}  status=${t.status}`);

// Sample of open with quick context
console.log('\n  Open ticket detail (latest 10):');
for (const t of opens.slice(0,10)) {
  const due = t.due_date ? new Date(t.due_date).toISOString().slice(0,10) : '—';
  const updated = t.updated_at ? new Date(t.updated_at).toISOString().slice(0,10) : '—';
  console.log(`    [${(t.status||'?').padEnd(11)}] ${(t.priority||'').padEnd(7)} ${uName(t.assigned_to).padEnd(15)} due=${due.padEnd(10)} upd=${updated}  ${(t.title||'').slice(0,40)}`);
}

// ── tickets table (legacy?) ──────────────────────────────────
console.log('\n═══ TICKETS table (legacy) ═══');
const { data: legacy } = await sb.from('tickets').select('id, title, status, assigned_to, due_date, created_at, type, tags').eq('tenant_id', T).limit(200);
console.log(`  Total rows: ${(legacy||[]).length}`);
if ((legacy||[]).length) {
  const stats = {};
  for (const t of legacy) {
    const k = `${t.status||'?'} · ${uName(t.assigned_to)}`;
    stats[k] = (stats[k] || 0) + 1;
  }
  for (const [k,n] of Object.entries(stats).sort((a,b)=>b[1]-a[1]).slice(0,20)) console.log(`    ${n.toString().padStart(3)}  ${k}`);
}

// ── quests / agent quests ────────────────────────────────────
const tableCheck = async (table) => {
  try {
    const { data, error } = await sb.from(table).select('*').eq('tenant_id', T).limit(5);
    if (error) return { exists: false, error: error.message };
    return { exists: true, sample: data, count: data.length };
  } catch (e) { return { exists: false, error: e.message }; }
};

console.log('\n═══ TABLE PROBES ═══');
for (const tbl of ['quests','tasks','agent_runs','agent_briefings','briefing_log','watchdog_log']) {
  const r = await tableCheck(tbl);
  console.log(`  ${tbl}:  ${r.exists ? `OK (sample=${r.count})` : 'NOT FOUND — ' + r.error}`);
}

// ── job_log_entries pending ──────────────────────────────────
console.log('\n═══ JOB_LOG_ENTRIES (pending approval) ═══');
const { data: pendings } = await sb.from('job_log_entries')
  .select('id, entry_type, description, amount, status, sub_id_uploaded:subcontractor_id, workorder_id, created_at')
  .eq('tenant_id', T)
  .eq('status', 'pending')
  .order('created_at', { ascending: false })
  .limit(30);
console.log(`  Pending: ${(pendings||[]).length}`);
for (const e of (pendings||[]).slice(0,8)) {
  const age = Math.ceil((now - new Date(e.created_at)) / 86400000);
  console.log(`    [${age}d]  ${(e.entry_type||'').padEnd(15)} $${(e.amount||0).toString().padStart(7)}  ${(e.description||'').slice(0,55)}`);
}

// ── recent activity_log ──────────────────────────────────────
console.log('\n═══ RECENT activity_log (last 24h) ═══');
const dayAgo = new Date(Date.now() - 86400000).toISOString();
const { data: acts } = await sb.from('activity_log')
  .select('id, entity_type, action, user_id, created_at, details')
  .eq('tenant_id', T)
  .gte('created_at', dayAgo)
  .order('created_at', { ascending: false })
  .limit(30);
console.log(`  Last 24h: ${(acts||[]).length}`);
const actionCounts = {};
for (const a of acts || []) {
  const k = `${a.entity_type}/${a.action}`;
  actionCounts[k] = (actionCounts[k] || 0) + 1;
}
for (const [k,n] of Object.entries(actionCounts).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`    ${n.toString().padStart(3)}  ${k}`);
