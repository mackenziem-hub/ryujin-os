// Apply migration 061 (users.magic_token + magic_expires_at) via Supabase Management API.
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

const sql = fs.readFileSync('schema/migration_061_user_magic_link.sql', 'utf8');

console.log(`Applying migration_061 to project ${projectRef}…`);
const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql })
});
const body = await r.text();
console.log('HTTP', r.status);
console.log(body);
if (!r.ok) process.exit(1);
console.log('\n✅ Migration 061 applied.');
