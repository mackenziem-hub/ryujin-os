// Add Melodie Wuttunee — Accounts Payable Manager, admin access.
// Generates an invite token; emits the /i/melodie short link.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

const profile = {
  tenant_id: tenant.id,
  name: 'Melodie Wuttunee',
  email: 'melodi.wuttunee@gmail.com',
  phone: '+15065401498',
  role: 'admin',
  bio: 'Accounts Payable Manager',
  active: true,
};

// Idempotent: update if a row with this email already exists; insert otherwise.
const { data: existing } = await sb.from('users').select('id, name').eq('tenant_id', tenant.id).eq('email', profile.email).maybeSingle();

const token = crypto.randomBytes(20).toString('hex');
const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

let userId;
if (existing) {
  const { error } = await sb.from('users').update({
    ...profile,
    reset_token: token,
    reset_token_expires_at: expiresAt,
    password_hash: null,           // force re-activation through invite
  }).eq('id', existing.id);
  if (error) throw error;
  userId = existing.id;
  console.log(`Updated existing user (${existing.name} → Melodie Wuttunee).`);
} else {
  const { data, error } = await sb.from('users').insert({
    ...profile,
    reset_token: token,
    reset_token_expires_at: expiresAt,
  }).select('id').single();
  if (error) throw error;
  userId = data.id;
  console.log(`Inserted new user, id=${userId}.`);
}

console.log('\n─────────────────────────────────────────────');
console.log(`Name:    ${profile.name}`);
console.log(`Email:   ${profile.email}`);
console.log(`Phone:   ${profile.phone}`);
console.log(`Role:    ${profile.role}  (${profile.bio})`);
console.log(`Token:   ${token}`);
console.log(`Expires: ${expiresAt}`);
console.log('');
console.log(`Short link:  https://ryujin-os.vercel.app/i/melodie`);
console.log(`Long link:   https://ryujin-os.vercel.app/accept-invite.html?token=${token}`);
console.log(`Portal:      https://ryujin-os.vercel.app/portal-melodie.html`);
