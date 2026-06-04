// Ad-hoc read query against Supabase via the Management API (PAT).
// Usage: node --env-file=.env.local scripts/db-query.mjs "select ..."
import process from 'node:process';

const PAT = (process.env.SUPABASE_PAT || '').trim();
const URL = (process.env.SUPABASE_URL || '').trim();
const ref = (URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const sql = process.argv.slice(2).join(' ');

if (!PAT || !ref || !sql) {
  console.error('Need SUPABASE_PAT, SUPABASE_URL, and a SQL string arg.');
  process.exit(1);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});
const txt = await res.text();
console.log('HTTP', res.status);
console.log(txt.slice(0, 2000));
if (!res.ok) process.exit(1);
