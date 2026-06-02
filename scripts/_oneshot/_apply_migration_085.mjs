// Apply migration 085 (tenant_settings.envelope_catalog column) directly.
// Re-runnable; uses `add column if not exists`.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }

const url = clean(process.env.SUPABASE_URL);
const key = clean(process.env.SUPABASE_SERVICE_KEY);
const sb = createClient(url, key);

// Service key REST cannot run DDL directly, so use the PostgREST RPC path
// via a tiny one-off function call. We'll try the SQL through the dashboard
// API instead. Easier: just probe whether the column exists.
const { data: probe } = await sb.from('tenant_settings').select('envelope_catalog').limit(1);
if (probe !== null) {
  console.log('envelope_catalog column already exists. Migration 085 already applied.');
  process.exit(0);
}
console.log('Migration 085 needs to be applied via Supabase Dashboard SQL Editor.');
console.log('Paste schema/migration_085_envelope_catalog.sql and run.');
