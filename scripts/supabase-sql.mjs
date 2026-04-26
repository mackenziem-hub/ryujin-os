#!/usr/bin/env node
// Run SQL against the Supabase Postgres instance via the Management API.
//
// Usage:
//   node scripts/supabase-sql.mjs <path-to-sql-file>           # run a file
//   node scripts/supabase-sql.mjs -e "select 1"                # inline query
//
// Required in .env.local:
//   SUPABASE_PAT      Personal Access Token (sbp_...) from
//                     https://supabase.com/dashboard/account/tokens
//   SUPABASE_URL      Project URL (project ref is parsed from this)
//
// Why this exists: Supabase doesn't expose DATABASE_URL in Vercel env, and
// the connection-pooling page moves around the dashboard. This goes through
// the official Management API instead — works for any DDL/DML.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const PAT = (process.env.SUPABASE_PAT || '').trim();
const URL_ENV = (process.env.SUPABASE_URL || '').trim();

if (!PAT) {
  console.error('SUPABASE_PAT missing in .env.local');
  console.error('Generate one at https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}
if (!URL_ENV) {
  console.error('SUPABASE_URL missing in .env.local');
  process.exit(1);
}

const refMatch = URL_ENV.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
if (!refMatch) {
  console.error(`Could not parse project ref from SUPABASE_URL=${URL_ENV}`);
  process.exit(1);
}
const ref = refMatch[1];

const args = process.argv.slice(2);
let sql;
if (args[0] === '-e') {
  sql = args.slice(1).join(' ');
  if (!sql) { console.error('usage: -e "<sql>"'); process.exit(1); }
} else if (args[0]) {
  sql = readFileSync(resolve(process.cwd(), args[0]), 'utf8');
} else {
  console.error('usage: node scripts/supabase-sql.mjs <file.sql>');
  console.error('       node scripts/supabase-sql.mjs -e "<inline sql>"');
  process.exit(1);
}

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const text = await r.text();
let data;
try { data = JSON.parse(text); } catch { data = text; }

if (!r.ok) {
  console.error(`✗ Supabase Management API ${r.status}`);
  console.error(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  process.exit(1);
}

if (Array.isArray(data) && data.length) {
  console.log(`✓ ok — ${data.length} row(s)`);
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log(`✓ ok${args[0] !== '-e' ? ' — ' + args[0] : ''}`);
}
