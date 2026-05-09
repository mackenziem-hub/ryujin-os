// Apply migrations 036, 037, 038, 039 to Supabase via Management API.
// Uses SUPABASE_PAT (personal access token) from .env.local.
//
// Why not pg/run-migration.mjs: no DATABASE_URL in env. PAT can hit
// api.supabase.com/v1/projects/{ref}/database/query which executes raw SQL.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const PAT = (process.env.SUPABASE_PAT || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
if (!PAT) { console.error('SUPABASE_PAT missing'); process.exit(1); }

// Extract project ref from URL: https://vnhamjbcvrzmmisdcstl.supabase.co
const m = SUPABASE_URL.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
if (!m) { console.error(`Could not parse project ref from ${SUPABASE_URL}`); process.exit(1); }
const PROJECT_REF = m[1];

const QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function execSql(label, sql) {
  console.log(`\n━━━ ${label} ━━━`);
  console.log(`  bytes: ${sql.length}`);
  const res = await fetch(QUERY_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  ✗ HTTP ${res.status}: ${text.slice(0, 800)}`);
    return false;
  }
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  console.log(`  ✓ applied`);
  if (Array.isArray(data) && data.length > 0 && data.length < 20) {
    console.log(`  rows: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return true;
}

// Smoke test first
const ok = await execSql('SMOKE TEST', 'SELECT current_database() AS db, current_user AS usr;');
if (!ok) {
  console.error('\nSmoke test failed — aborting. Check SUPABASE_PAT scope (must include "Read all projects" + Database write).');
  process.exit(1);
}

const migrations = [
  'schema/migration_036_claims_library.sql',
  'schema/migration_037_paysheet_state_machine.sql',
  'schema/migration_038_proposal_state_machine.sql',
  'schema/migration_039_change_orders.sql'
];

const results = [];
for (const path of migrations) {
  const sql = readFileSync(resolve(process.cwd(), path), 'utf8');
  const success = await execSql(path, sql);
  results.push({ path, success });
  if (!success) {
    console.error(`\nMigration failed at ${path}. Halting batch.`);
    break;
  }
}

console.log('\n━━━ SUMMARY ━━━');
for (const r of results) console.log(`  ${r.success ? '✓' : '✗'}  ${r.path}`);

const allOk = results.length === migrations.length && results.every(r => r.success);
if (!allOk) process.exit(1);

// Verify the new tables exist
console.log('\n━━━ VERIFY ━━━');
await execSql(
  'verify tables',
  `SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
      AND table_name IN ('claims','claims_audit','paysheet_state_log','estimate_state_log','change_orders','change_order_log')
    ORDER BY table_name;`
);
await execSql(
  'verify paysheets.state column',
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='paysheets' AND column_name IN ('state','version','superseded_token_at','completed_at','payable_at','paid_at')
    ORDER BY column_name;`
);
await execSql(
  'verify estimates.state column',
  `SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name='estimates' AND column_name IN ('state','approved_at','rate_hold_expires_at','rep_call_due_at','contract_status','deposit_status','finance_status','schedule_due_by','last_synced_at','ghl_sync_status')
    ORDER BY column_name;`
);

console.log('\n✓ All migrations applied successfully.');
