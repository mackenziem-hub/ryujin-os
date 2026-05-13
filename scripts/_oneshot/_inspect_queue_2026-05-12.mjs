#!/usr/bin/env node
// One-shot: inspect what's actually in Mac's portal-mobile queue today.
// Reads briefing_items + quests directly so we can decide what to prune.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envText = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);
const TENANT = (await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').maybeSingle()).data;
if (!TENANT) { console.error('No plus-ultra tenant'); process.exit(1); }
console.log(`\n=== Tenant: ${TENANT.slug} (${TENANT.id}) — date ${today} ===\n`);

// 1. Briefing items today
const { data: briefing } = await sb
  .from('briefing_items')
  .select('id, title, body, priority, source_agent, for_user_id, for_date, created_at, dismissed_at')
  .eq('tenant_id', TENANT.id)
  .eq('for_date', today)
  .is('dismissed_at', null)
  .order('created_at', { ascending: false });

console.log(`── BRIEFING_ITEMS for ${today} (undismissed): ${briefing?.length || 0} ──`);
for (const b of (briefing || [])) {
  const age = Math.round((Date.now() - new Date(b.created_at).getTime()) / 3600000);
  console.log(`  [${b.priority}] ${b.title}`);
  console.log(`     src=${b.source_agent || '—'}  for_user=${b.for_user_id?.slice(0,8) || 'ALL'}  ${age}h old`);
  if (b.body) console.log(`     body: ${b.body.slice(0, 120)}${b.body.length > 120 ? '…' : ''}`);
}

// 2. Open quests
const { data: quests } = await sb
  .from('quests')
  .select('id, title, status, priority, assigned_to, source_agent, due_date, scheduled_for, created_at, metadata')
  .eq('tenant_id', TENANT.id)
  .eq('status', 'open')
  .order('created_at', { ascending: false })
  .limit(50);

console.log(`\n── QUESTS open: ${quests?.length || 0} ──`);
for (const q of (quests || [])) {
  const age = Math.round((Date.now() - new Date(q.created_at).getTime()) / 86400000);
  const due = q.due_date || q.scheduled_for;
  const meta = q.metadata || {};
  const intent = meta.intent || '';
  const job = meta.job_address || meta.address || '';
  const ab = (meta.tags || []).filter(t => /^ab:/.test(t))[0] || '';
  console.log(`  [${q.priority || 'normal'}] ${q.title}`);
  console.log(`     src=${q.source_agent || '—'}  intent=${intent}  due=${due || '—'}  ${age}d old  ${ab}`);
  if (job) console.log(`     job: ${job}`);
}

// 3. Age histogram
console.log('\n── AGE HISTOGRAM (open quests) ──');
const buckets = { '0-1d': 0, '2-7d': 0, '8-30d': 0, '30d+': 0 };
for (const q of (quests || [])) {
  const days = Math.round((Date.now() - new Date(q.created_at).getTime()) / 86400000);
  if (days <= 1) buckets['0-1d']++;
  else if (days <= 7) buckets['2-7d']++;
  else if (days <= 30) buckets['8-30d']++;
  else buckets['30d+']++;
}
console.log(`  ${JSON.stringify(buckets)}`);

// 4. Source agent histogram (where are stale items coming from?)
const sources = {};
for (const q of (quests || [])) {
  const s = q.source_agent || '—';
  sources[s] = (sources[s] || 0) + 1;
}
console.log('\n── SOURCE AGENT (open quests) ──');
console.log('  ' + JSON.stringify(sources));

// 5. tickets vs service_tickets — figure out where the 33 actually live
const { count: ticketsCount } = await sb.from('tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT.id);
const { count: stCount } = await sb.from('service_tickets').select('*', { count: 'exact', head: true }).eq('tenant_id', TENANT.id);
console.log(`\n── TABLE COUNTS (tenant scoped) ──`);
console.log(`  tickets:         ${ticketsCount}`);
console.log(`  service_tickets: ${stCount}`);

const { data: tickets, error: terr } = await sb
  .from('tickets')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(100);
if (terr) console.log('  tickets err:', terr.message);

console.log(`\n── TICKETS pulled (no tenant filter): ${tickets?.length || 0} ──`);
if (tickets?.[0]) console.log('  columns:', Object.keys(tickets[0]).join(', '));
const tStatus = {};
for (const t of (tickets || [])) tStatus[t.status] = (tStatus[t.status] || 0) + 1;
console.log('  status:', JSON.stringify(tStatus));
console.log('\n  Top 15 open:');
for (const t of (tickets || []).filter(t => !['completed','archived','closed','done'].includes(t.status)).slice(0, 15)) {
  const days = Math.round((Date.now() - new Date(t.created_at).getTime()) / 86400000);
  console.log(`    [${t.urgency || t.priority || 'med'}] ${t.title}  (${t.status}, ${days}d, due ${t.due_date || '—'})`);
}
