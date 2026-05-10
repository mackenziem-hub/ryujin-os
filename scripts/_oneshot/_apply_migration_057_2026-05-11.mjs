// Apply migration_057_agent_runs_service_check.sql via Supabase
// Management API (PAT-based DDL).
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0];
if (!PAT || !PROJECT_REF) throw new Error('SUPABASE_PAT or SUPABASE_URL missing');

const sql = fs.readFileSync(path.resolve('schema/migration_057_agent_runs_service_check.sql'), 'utf8');

const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await r.text();
console.log(`HTTP ${r.status}: ${text}`);
if (!r.ok) process.exit(1);

// Verify
const r2 = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'agent_runs_agent_slug_check';" }),
});
console.log('Verify:', await r2.text());
