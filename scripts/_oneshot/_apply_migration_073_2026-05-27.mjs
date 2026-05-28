// Apply migration 073 (ticket_number uniqueness) via Supabase Management API.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PAT = (process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN || '').trim().replace(/^"|"$/g, '').replace(/\\n$/, '');
const projectRef = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1];
if (!PAT) { console.error('Missing SUPABASE_PAT in .env.local'); process.exit(1); }
if (!projectRef) { console.error('Could not extract projectRef from SUPABASE_URL'); process.exit(1); }

const sql = fs.readFileSync('schema/migration_073_ticket_number_unique.sql', 'utf8');

console.log(`Applying migration_073 (ticket_number uniqueness) to project ${projectRef}…\n`);

// Pre-state snapshot.
const preState = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    select tenant_id, ticket_number, count(*) as n
    from tickets
    group by tenant_id, ticket_number
    having count(*) > 1
    order by tenant_id, ticket_number;
  ` }),
});
console.log('Pre-apply duplicates:');
console.log(await preState.text());
console.log('');

const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const body = await r.text();
console.log('Apply HTTP', r.status);
console.log(body);
if (!r.ok) process.exit(1);

// Verify: duplicates gone, constraint present, sequence advanced.
const verify = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    select tenant_id, ticket_number, count(*) as n
    from tickets
    group by tenant_id, ticket_number
    having count(*) > 1
    order by tenant_id, ticket_number;
  ` }),
});
console.log('\nPost-apply duplicates (should be empty):');
console.log(await verify.text());

const constraintCheck = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conname = 'tickets_tenant_number_unique';
  ` }),
});
console.log('\nConstraint present:');
console.log(await constraintCheck.text());

const seqCheck = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `
    select last_value, is_called
    from ${`tickets_ticket_number_seq`};
  ` }),
});
console.log('\nSequence state:');
console.log(await seqCheck.text());

console.log('\n✅ Migration 073 applied.');
