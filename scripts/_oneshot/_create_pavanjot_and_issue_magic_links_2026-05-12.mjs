// Create Pavanjot's user record + issue magic-link URLs for Diego and Pavanjot.
// 2026-05-12 — one-tap Crew OS rollout.
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
if (!PAT || !projectRef) { console.error('Missing SUPABASE_PAT or SUPABASE_URL'); process.exit(1); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`SQL HTTP ${r.status}: ${body}`);
  return JSON.parse(body);
}

function tokenHex(n = 32) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

const tenant = (await sql(`select id from tenants where slug = 'plus-ultra' limit 1`))[0];
console.log(`Tenant: ${tenant.id}`);

// Pavanjot — create if missing
const existing = await sql(`select id, name from users where tenant_id = '${tenant.id}' and email = 'pavanjot@plusultraroofing.com' limit 1`);
let pavanjot;
if (existing.length) {
  pavanjot = existing[0];
  console.log(`Pavanjot exists: ${pavanjot.id}`);
} else {
  const inserted = await sql(`
    insert into users (tenant_id, email, name, role, active)
    values ('${tenant.id}', 'pavanjot@plusultraroofing.com', 'Pavanjot Singh', 'crew', true)
    returning id, name
  `);
  pavanjot = inserted[0];
  console.log(`Created Pavanjot: ${pavanjot.id}`);
}

// Diego — must exist
const diego = (await sql(`select id, name from users where tenant_id = '${tenant.id}' and email = 'diego@plusultra.crew' limit 1`))[0];
if (!diego) { console.error('Diego not found'); process.exit(1); }
console.log(`Diego: ${diego.id}`);

// Issue magic tokens — 14 day TTL so they can use the link this week and next.
const ttlMs = 14 * 24 * 60 * 60 * 1000;
const out = [];
for (const u of [diego, pavanjot]) {
  const t = tokenHex(32);
  const expires = new Date(Date.now() + ttlMs).toISOString();
  await sql(`
    update users
    set magic_token = '${t}', magic_expires_at = '${expires}'
    where id = '${u.id}'
  `);
  const url = `https://ryujin-os.vercel.app/magic.html?t=${t}`;
  out.push({ name: u.name, id: u.id, url, expires });
  console.log(`\n${u.name}: ${url}\n  expires: ${expires}`);
}

console.log('\n— Done. Tokens stored on users.magic_token. URLs above are single-use, 14-day TTL.');
fs.writeFileSync('scripts/_oneshot/_crew_magic_links_2026-05-12.json', JSON.stringify(out, null, 2));
console.log('Wrote: scripts/_oneshot/_crew_magic_links_2026-05-12.json');
