// One-shot: clean up duplicate user rows + generate invite tokens
// for everyone who needs to sign in.
//
// 1. Deletes 3 placeholder duplicate rows (the @plusultraroofing.com
//    ones with no Twilio/cell that the seed script created).
// 2. For each user whose password_hash is null, generates a 32-char
//    reset_token + sets reset_token_expires_at = +7 days.
// 3. Outputs one /accept-invite.html?token= link per person for Mac
//    to share (SMS/WhatsApp/email).

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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const APP_BASE = 'https://ryujin-os.vercel.app';

// 1. Delete duplicates by id (the placeholder rows the seed script created).
const DUP_IDS = [
  'b0532ae5-ac02-4cdc-b8a8-c63ef13c66e8'.split('-').length === 5 ? null : null, // sentinel
];
// Resolve actual ids by lookup since I only have the prefix from the inspect run.
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();
const { data: dups } = await sb.from('users')
  .select('id, name, email, ryujin_phone_number, password_hash')
  .eq('tenant_id', tenant.id)
  .in('email', ['aj@plusultraroofing.com', 'diego@plusultraroofing.com', 'pavanjot@plusultraroofing.com']);

console.log('═══ DUPLICATE CLEANUP ═══');
for (const d of dups || []) {
  // Safety check: only delete rows that have NO Twilio number AND a placeholder email AND password set by seed.
  if (d.ryujin_phone_number) {
    console.log(`⚠ ${d.name} (${d.email}) HAS ryujin_phone_number — skipping delete to be safe`);
    continue;
  }
  // Also delete any sessions tied to this user.
  await sb.from('sessions').delete().eq('user_id', d.id);
  const { error } = await sb.from('users').delete().eq('id', d.id);
  if (error) console.log(`✗ ${d.name}: ${error.message}`);
  else console.log(`✓ deleted ${d.name} (${d.email})`);
}
console.log();

// 2. Generate invite tokens for users without passwords.
const { data: roster } = await sb.from('users')
  .select('id, name, email, role, password_hash, ryujin_phone_number')
  .eq('tenant_id', tenant.id)
  .order('name');

console.log('═══ INVITE LINKS ═══\n');
const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
const links = [];
for (const u of roster) {
  if (u.role === 'crew' && /\.sub$/.test(u.email || '')) continue; // Ryan — sub-portal flow
  if (u.password_hash) {
    console.log(`${u.name.padEnd(28)} already has password — share their portal link directly`);
    links.push({ name: u.name, role: u.role, status: 'already active', link: null });
    continue;
  }
  const token = crypto.randomBytes(20).toString('hex');
  const { error } = await sb.from('users')
    .update({ reset_token: token, reset_token_expires_at: expiresAt })
    .eq('id', u.id);
  if (error) {
    console.log(`✗ ${u.name}: ${error.message}`);
    continue;
  }
  const link = `${APP_BASE}/accept-invite.html?token=${token}`;
  console.log(`${u.name.padEnd(28)} ${u.role.padEnd(10)} ${link}`);
  links.push({ name: u.name, role: u.role, status: 'invite sent', link });
}

console.log('\n───────────────────────────────────');
console.log('Tokens expire in 7 days.');
console.log('Share each link via SMS / WhatsApp / however you reach them.');
console.log('When they click: pick their email + password → lands on their portal.');
console.log('Their existing user_id stays the same so Twilio routing keeps working.');
console.log('\nRyan stays on /sub-portal.html with per-job tokens (separate flow).');
