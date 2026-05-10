// One-shot: seed the Plus Ultra team into users + sessions so each person
// can log in with a known temp password and bookmark their portal link.
//
// Idempotent: if a user already exists by email, the script DOES NOT
// overwrite their password (avoids surprises). It only sets a password
// when password_hash is NULL. Output at the end is the link + temp
// password for each person — Mac shares directly.
//
// Run: node scripts/_oneshot/_seed_team_users_2026-05-11.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const sb = createClient((process.env.SUPABASE_URL||'').trim(), (process.env.SUPABASE_SERVICE_KEY||'').trim());

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const PUBLIC_BASE = 'https://ryujin-os.vercel.app';

// Plus Ultra team — names match the routing-map slug derivation
// (lowercase first name → 'mackenzie' / 'catherine' / 'darcy' / 'diego' /
// 'aj' / 'pavanjot'). routingMap uses 'aj', 'diego', 'catherine' explicitly;
// owner+admin route by role.
const TEAM = [
  { name: 'Mackenzie Mazerolle',  email: 'mackenzie.m@plusultraroofing.com', role: 'owner', portal: '/portal-mac.html',       title: 'Owner' },
  { name: 'Catherine',            email: 'catherine@plusultraroofing.com',   role: 'admin', portal: '/portal-catherine.html', title: 'EA · all-access' },
  { name: 'AJ Mazerolle',         email: 'aj@plusultraroofing.com',          role: 'admin', portal: '/portal-aj.html',        title: 'GM (formalizing) · service' },
  { name: 'Darcy Mazerolle',      email: 'darcy@plusultraroofing.com',       role: 'sales', portal: '/portal-darcy.html',     title: 'Outside sales' },
  { name: 'Diego',                email: 'diego@plusultraroofing.com',       role: 'crew',  portal: '/portal-diego.html',     title: 'Operations specialist' },
  { name: 'Pavanjot',             email: 'pavanjot@plusultraroofing.com',    role: 'crew',  portal: '/portal-pavanjot.html',  title: 'Production assistant' },
];

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').maybeSingle();
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }

const results = [];

for (const member of TEAM) {
  const { data: existing } = await sb
    .from('users').select('id, email, name, role, password_hash')
    .eq('tenant_id', tenant.id).eq('email', member.email).maybeSingle();

  let userId, tempPw = null, status;

  if (existing) {
    userId = existing.id;
    // Update name + role to ensure they match the routing map.
    await sb.from('users').update({ name: member.name, role: member.role }).eq('id', userId);
    if (!existing.password_hash) {
      tempPw = crypto.randomBytes(6).toString('hex');   // 12-char temp
      await sb.from('users').update({ password_hash: hashPassword(tempPw) }).eq('id', userId);
      status = 'existed · password set';
    } else {
      status = 'existed · password already set (not overwritten)';
    }
  } else {
    tempPw = crypto.randomBytes(6).toString('hex');
    const { data: created, error } = await sb.from('users')
      .insert({ tenant_id: tenant.id, name: member.name, email: member.email, role: member.role, password_hash: hashPassword(tempPw) })
      .select('id').single();
    if (error) { console.error(`create ${member.email}: ${error.message}`); continue; }
    userId = created.id;
    status = 'CREATED';
  }

  results.push({ ...member, user_id: userId, temp_password: tempPw, status, link: PUBLIC_BASE + member.portal });
}

// ─── Output ─────────────────────────────────────────────────────
console.log('\n═══ TEAM PORTAL LINKS ═══\n');
for (const r of results) {
  console.log(`${r.name}  (${r.title})`);
  console.log(`  email:    ${r.email}`);
  console.log(`  role:     ${r.role}`);
  console.log(`  link:     ${r.link}`);
  console.log(`  password: ${r.temp_password || '(unchanged — they already have one)'}`);
  console.log(`  status:   ${r.status}`);
  console.log('');
}
console.log('───────────────────────────────────');
console.log('First time anyone signs in:');
console.log(`  1. Open ${PUBLIC_BASE}/login.html`);
console.log('  2. Email + temp password from above');
console.log('  3. Bookmark their portal link (above)');
console.log('  4. Session lasts 30 days');
console.log('───────────────────────────────────');
console.log('\nRyan (subcontractor) uses /sub-portal.html with a separate auth flow (per-job tokens — Mac generates each from /admin → Sub Portal). Not part of this seed.');
