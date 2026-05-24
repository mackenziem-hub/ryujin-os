// Idempotent runner for paysheet_hygiene_2026-05-24.sql
//
// Flips the 4 stuck paysheets + 2 lagging workorders Mac caught in Sunday AM
// cockpit triage. Hygiene SQL was written for the Supabase Dashboard but
// never got pasted, and Karen Party + Shelagh Peach kept showing as active.
//
// Run: node scripts/_oneshot/paysheet_hygiene_runner_2026-05-24.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n/g, '').trim();
  }
}

const sb = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_KEY || '').trim(),
);

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

const STUCK_PAYSHEETS = [
  { id: '3c6b2a5f-ed06-4f95-ae16-96af79a4b14d', label: 'Kyle Graham' },
  { id: 'cdec1af1-a5bf-48c3-8b41-8a4bedc001b2', label: 'Shelagh Peach' },
  { id: '3fbf1dbf-493a-4e53-a85d-02fd029554b4', label: 'Donna Boosamra' },
  { id: '18ac64bd-a634-4473-bd76-e6b20bffad2f', label: 'Gary & Karen Pardy' },
];

const STUCK_WOS = [
  { id: '85635474-5352-47d0-9304-ab05ac3c1bb3', label: 'Shelagh Peach' },
  { id: 'd705a263-5786-47ba-a7ed-21c0ca4d95d0', label: 'Kyle Graham' },
];

console.log('Flipping stuck paysheets...');
for (const { id, label } of STUCK_PAYSHEETS) {
  const { data: cur } = await sb.from('paysheets').select('id, status').eq('id', id).maybeSingle();
  if (!cur) { console.log('  ! missing', label, id); continue; }
  if (cur.status === 'completed') { console.log('  = already completed', label); continue; }
  const { error } = await sb.from('paysheets').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('  ✗', label, error.message); continue; }
  console.log('  ✓', label, cur.status, '→ completed');
}

console.log('\nFlipping lagging workorders...');
for (const { id, label } of STUCK_WOS) {
  const { data: cur } = await sb.from('workorders').select('id, status, completed_at').eq('id', id).maybeSingle();
  if (!cur) { console.log('  ! missing', label, id); continue; }
  if (cur.status === 'completed') { console.log('  = already completed', label); continue; }
  // Workorders use 'complete' (no -d) per migration_013_production.sql line ~129.
  const updates = { status: 'complete', updated_at: new Date().toISOString() };
  if (!cur.completed_at) updates.completed_at = new Date().toISOString();
  const { error } = await sb.from('workorders').update(updates).eq('id', id);
  if (error) { console.error('  ✗', label, error.message); continue; }
  console.log('  ✓', label, cur.status, '→ completed');
}

console.log('\nDone.');
