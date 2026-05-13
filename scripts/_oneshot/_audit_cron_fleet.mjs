// Cron/agent fleet live audit — runs/errors/quests/kpis in the last 48h.
import fs from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

for (const p of ['.env.local', '.env']) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
  } catch {}
}

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
console.log(`tenant: ${tenant.slug} (${tenant.id})\n`);

const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();

// 1. agent_runs in last 48h
console.log('═══ AGENT RUNS (last 48h) ═══');
const { data: runs } = await sb.from('agent_runs')
  .select('agent_slug, started_at, completed_at, status, duration_ms, error_message, trigger')
  .eq('tenant_id', tenant.id)
  .gte('started_at', cutoff)
  .order('started_at', { ascending: false });

const bySlug = {};
for (const r of runs || []) {
  if (!bySlug[r.agent_slug]) bySlug[r.agent_slug] = { runs: 0, errors: 0, last_status: null, last_run: null, last_err: null, triggers: new Set() };
  bySlug[r.agent_slug].runs++;
  if (r.status === 'error' || r.error_message) bySlug[r.agent_slug].errors++;
  if (!bySlug[r.agent_slug].last_run) {
    bySlug[r.agent_slug].last_status = r.status;
    bySlug[r.agent_slug].last_run = r.started_at;
    bySlug[r.agent_slug].last_err = r.error_message;
  }
  bySlug[r.agent_slug].triggers.add(r.trigger);
}
for (const [slug, agg] of Object.entries(bySlug).sort()) {
  const ageH = ((Date.now() - new Date(agg.last_run).getTime()) / 3600000).toFixed(1);
  console.log(`  ${slug.padEnd(14)} runs:${agg.runs} errors:${agg.errors} last:${agg.last_status} (${ageH}h ago) trig:${[...agg.triggers].join(',')}`);
  if (agg.last_err) console.log(`     err: ${agg.last_err.slice(0, 120)}`);
}
console.log(`  Total rows: ${runs?.length || 0}\n`);

// 2. quests emitted in last 48h
console.log('═══ QUESTS (last 48h) ═══');
const { data: quests } = await sb.from('quests')
  .select('category, status, source_agent, title, created_at')
  .eq('tenant_id', tenant.id)
  .gte('created_at', cutoff)
  .order('created_at', { ascending: false });

const questsBySource = {};
for (const q of quests || []) {
  const k = q.source_agent || 'manual';
  questsBySource[k] = (questsBySource[k] || 0) + 1;
}
for (const [src, n] of Object.entries(questsBySource).sort()) {
  console.log(`  ${src.padEnd(12)} ${n} quest(s)`);
}
console.log(`  Total: ${quests?.length || 0}\n`);

// 3. KPI freshness
console.log('═══ KPIs (any age) ═══');
const { data: kpis } = await sb.from('kpis')
  .select('key, label, value, unit, source_agent, last_updated_at')
  .eq('tenant_id', tenant.id)
  .order('last_updated_at', { ascending: false });

const kpisByDomain = {};
for (const k of kpis || []) {
  const d = k.key.split('.')[0];
  if (!kpisByDomain[d]) kpisByDomain[d] = [];
  kpisByDomain[d].push(k);
}
for (const [d, ks] of Object.entries(kpisByDomain).sort()) {
  const oldest = ks.reduce((a, b) => new Date(a.last_updated_at) < new Date(b.last_updated_at) ? a : b);
  const ageH = ((Date.now() - new Date(oldest.last_updated_at).getTime()) / 3600000).toFixed(1);
  console.log(`  ${d.padEnd(12)} ${ks.length} kpis (oldest ${ageH}h)`);
}
console.log(`  Total: ${kpis?.length || 0}\n`);

// 4. briefing_items in last 48h
console.log('═══ BRIEFING ITEMS (last 48h) ═══');
const { data: briefs } = await sb.from('briefing_items')
  .select('domain, title, source_agent, severity, created_at')
  .eq('tenant_id', tenant.id)
  .gte('created_at', cutoff)
  .order('created_at', { ascending: false });

const briefsByDomain = {};
for (const b of briefs || []) {
  briefsByDomain[b.domain] = (briefsByDomain[b.domain] || 0) + 1;
}
for (const [d, n] of Object.entries(briefsByDomain).sort()) {
  console.log(`  ${d.padEnd(12)} ${n}`);
}
console.log(`  Total: ${briefs?.length || 0}\n`);

// 5. agent_slug CHECK constraint — confirm it contains all 7 slugs
console.log('═══ AGENT_RUNS CHECK CONSTRAINT (slugs allowed) ═══');
try {
  const { data: ck } = await sb.rpc('exec_sql', { sql: `select pg_get_constraintdef(oid) as def from pg_constraint where conname like 'agent_runs%check%' or conname like '%agent_slug%check%'` });
  if (ck) console.log(JSON.stringify(ck, null, 2));
  else console.log('  (rpc unavailable; inspect manually)');
} catch (e) {
  console.log(`  (skipped: ${e.message})`);
}

// 6. Probe each slug with valid status='success' (skip — already confirmed via live runs above)
console.log('\n═══ Existing slug coverage from live data ═══');
const seen = Object.keys(bySlug);
const expected = ['sales','marketing','ops','finance','customer','service','strategy'];
for (const s of expected) {
  console.log(`  ${s.padEnd(10)} ${seen.includes(s) ? '✅ has runs' : '❌ NO RUNS'}`);
}

// 7. Watchdog deep-check — read its last-run state from Vercel Blob proxy
console.log('\n═══ WATCHDOG DEEP CHECK ═══');
try {
  // Try fetching the watchdog endpoint directly (will trigger it; just see if it's reachable)
  // Don't trigger — just see if the schedule is the issue. Check last 10 watchdog runs in agent_runs.
  const { data: wdr } = await sb.from('agent_runs')
    .select('started_at, status, error_message')
    .eq('tenant_id', tenant.id)
    .eq('agent_slug', 'watchdog')
    .order('started_at', { ascending: false })
    .limit(10);
  if (!wdr || wdr.length === 0) {
    console.log('  watchdog has NO rows in agent_runs ever — it doesn\'t persist there (snapshot only)');
  } else {
    for (const r of wdr) {
      console.log(`  ${r.started_at} ${r.status} ${r.error_message?.slice(0,80) || ''}`);
    }
  }
} catch (e) { console.log('  err:', e.message); }

// Last successful watchdog snapshot record
const { data: lastWdSnap } = await sb.from('agent_runs')
  .select('agent_slug, started_at')
  .eq('tenant_id', tenant.id)
  .order('started_at', { ascending: false })
  .limit(1);
console.log(`  latest agent_run overall: ${lastWdSnap?.[0]?.agent_slug} @ ${lastWdSnap?.[0]?.started_at}`);

// 7. Snapshot freshness check
console.log('\n═══ SNAPSHOT FRESHNESS ═══');
try {
  const r = await fetch('https://ryujin-os.vercel.app/api/snapshot?_t=' + Date.now(), { cache: 'no-store' });
  const snap = await r.json();
  const checks = [
    ['briefing_morning', snap?.sections?.briefing_morning?.timestamp],
    ['briefing_evening', snap?.sections?.briefing_evening?.timestamp],
    ['watchdog', snap?.sections?.watchdog?.lastRun],
    ['heartbeat', snap?.sections?.heartbeat?.lastRun],
    ['cashflow', snap?.sections?.cashflow?.last90Days ? new Date().toISOString() : null],
    ['metaAds', snap?.sections?.metaAds?._lastRefreshed || (snap?.sections?.metaAds ? 'present' : null)],
    ['agentReports.daily', snap?.sections?.agentReports?.daily?.lastRun]
  ];
  for (const [k, v] of checks) {
    if (!v) { console.log(`  ${k.padEnd(20)} (missing)`); continue; }
    const ts = typeof v === 'string' && v.match(/^\d{4}-/) ? new Date(v).getTime() : null;
    const ageH = ts ? ((Date.now() - ts) / 3600000).toFixed(1) + 'h' : v;
    console.log(`  ${k.padEnd(20)} ${ageH}`);
  }
} catch (e) {
  console.log(`  fetch failed: ${e.message}`);
}
