// Apply a SQL migration file to Supabase via the Management API (PAT).
// Usage: node --env-file=.env.local scripts/apply-migration.mjs <path-to-sql>
// Requires SUPABASE_PAT + SUPABASE_URL in the env. Idempotent migrations only.
import { readFileSync } from 'node:fs';

const PAT = (process.env.SUPABASE_PAT || '').trim();
const URL = (process.env.SUPABASE_URL || '').trim();
const ref = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const file = process.argv[2];

if (!PAT || !ref || !file) {
  console.error('Need SUPABASE_PAT, SUPABASE_URL (to derive project ref), and a file arg.');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});
const txt = await res.text();
console.log(`${file} -> HTTP ${res.status}`);
console.log(txt.slice(0, 600));
if (!res.ok) process.exit(1);
console.log('OK');
