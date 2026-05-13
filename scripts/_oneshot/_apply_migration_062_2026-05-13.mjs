// Apply migration 062 (agent_runs.agent_slug CHECK adds 'inventory') via Supabase Management API.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1];
if (!PAT) { console.error('Missing SUPABASE_PAT in .env.local'); process.exit(1); }
if (!projectRef) { console.error('Could not extract projectRef from SUPABASE_URL'); process.exit(1); }

const sql = fs.readFileSync('schema/migration_062_agent_runs_inventory_check.sql', 'utf8');

console.log(`Applying migration_062 (agent_runs slug CHECK +inventory) to project ${projectRef}…`);
const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});
const body = await r.text();
console.log('HTTP', r.status);
console.log(body);
if (!r.ok) process.exit(1);

// Verify — check the new constraint includes 'inventory'
const verify = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select pg_get_constraintdef(oid) as def from pg_constraint where conname='agent_runs_agent_slug_check'` })
});
console.log('\nVerify constraint:');
console.log(await verify.text());

console.log('\n✅ Migration 062 applied.');
