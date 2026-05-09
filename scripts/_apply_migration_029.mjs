// One-shot: apply migration 029 (personas) via Supabase Management API.
// If this fails, paste the SQL into Supabase Dashboard → SQL Editor manually.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env.production
const envPath = resolve(process.cwd(), '.env.production');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch (e) {
  console.error('No .env.production found');
  process.exit(1);
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY missing');
  process.exit(1);
}

const sql = readFileSync('schema/migration_029_personas.sql', 'utf8');

// Supabase doesn't have a direct DDL endpoint via REST. Try pg-meta or fall through to manual.
// Alternative: try calling a generic exec function if it exists.
const projectRef = url.match(/https:\/\/([^.]+)\.supabase/)?.[1];
console.log(`Project ref: ${projectRef}`);
console.log(`SQL to apply (paste in Supabase Dashboard → SQL Editor if this fails):\n`);
console.log(sql);
console.log(`\n---`);

// Try the postgrest-meta-style query — usually requires pg_meta enabled
try {
  const r = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({ sql })
  });
  if (r.ok) {
    console.log('✓ Applied via RPC');
  } else {
    console.log(`RPC not available (${r.status}). Paste SQL manually in Supabase Dashboard.`);
  }
} catch (e) {
  console.log(`Auto-apply failed: ${e.message}`);
  console.log(`\nFallback: open Supabase Dashboard → SQL Editor → paste the SQL above → Run.`);
}
