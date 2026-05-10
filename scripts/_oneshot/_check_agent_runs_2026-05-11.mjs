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
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

const { data: runs, error: runsErr } = await sb.from('agent_runs')
  .select('agent_slug, started_at, completed_at, status, duration_ms, summary, error_message')
  .eq('tenant_id', tenant.id)
  .order('started_at', { ascending: false })
  .limit(40);
const errs = (runs || []).filter(r => r.status === 'error' || r.error_message);
if (errs.length) { console.log('\n!!! ERROR RUNS:'); for (const r of errs) console.log(`  ${r.started_at?.slice(0,19)} ${r.agent_slug} ${r.error_message}`); }
const serviceRuns = (runs || []).filter(r => r.agent_slug === 'service');
console.log(`\nservice runs in last 40: ${serviceRuns.length}`);

if (runsErr) { console.error('agent_runs query error:', runsErr); process.exit(1); }
console.log(`Most recent ${(runs||[]).length} agent_runs:`);
for (const r of runs || []) {
  const sum = typeof r.summary === 'string' ? r.summary : JSON.stringify(r.summary || {}).slice(0, 70);
  console.log(`  ${r.started_at?.slice(0, 19) || '?'.padEnd(19)}  ${(r.agent_slug || '').padEnd(10)} ${r.status?.padEnd(8)} ${r.duration_ms ?? '?'}ms  ${sum.slice(0, 80)}`);
}
