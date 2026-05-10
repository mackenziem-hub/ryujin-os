// One-shot: pull every Twilio incoming phone number from Mac's account,
// pull every operator from Plus Ultra's users table, and assign numbers
// to operators in priority order. Output the resulting roster.
//
// Priority for assignment (per Plus Ultra org structure in SESSION_CONTEXT):
//   Mac → AJ → Catherine → Darcy → Diego → Pavanjot → (any others)
//
// If Mac has more numbers than operators, the extras stay unassigned.
// If fewer numbers than operators, lower-priority operators get nothing.
//
// Idempotent: skips operators whose ryujin_phone_number is already set
// (won't overwrite).
//
// Required env (in .env.local):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//
// Run: node scripts/_oneshot/_assign_twilio_numbers_2026-05-11.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) { console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── 1. Pull Twilio numbers ──────────────────────────────────────
const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
const numUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=50`;
const numRes = await fetch(numUrl, { headers: { Authorization: `Basic ${auth}` } });
if (!numRes.ok) {
  console.error(`Twilio fetch failed (${numRes.status}):`, await numRes.text());
  process.exit(1);
}
const { incoming_phone_numbers: twilioNumbers } = await numRes.json();
console.log(`Found ${twilioNumbers.length} Twilio number(s):`);
for (const n of twilioNumbers) console.log(`  ${n.phone_number}  ${n.friendly_name || ''}`);
console.log();

if (twilioNumbers.length === 0) { console.error('No Twilio numbers in this account. Buy at least one before running this script.'); process.exit(1); }

// ─── 2. Pull plus-ultra users ────────────────────────────────────
const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }

const { data: users } = await sb.from('users')
  .select('id, name, role, phone, ryujin_phone_number')
  .eq('tenant_id', tenant.id)
  .order('name', { ascending: true });

console.log(`Found ${users.length} user(s) under plus-ultra.\n`);

// ─── 3. Priority order for assignment ────────────────────────────
const PRIORITY = ['mackenzie', 'mac', 'aj', 'catherine', 'darcy', 'diego', 'pavanjot'];

function priority(user) {
  const slug = (user.name || '').toLowerCase().split(/\s+/)[0];
  const idx = PRIORITY.indexOf(slug);
  return idx === -1 ? 999 : idx;
}

const sorted = [...users].sort((a, b) => priority(a) - priority(b));

// ─── 4. Assign ────────────────────────────────────────────────────
const assignments = [];
let numIdx = 0;
for (const user of sorted) {
  if (numIdx >= twilioNumbers.length) {
    assignments.push({ user, twilio: null, status: 'NO NUMBER LEFT' });
    continue;
  }
  if (user.ryujin_phone_number) {
    assignments.push({ user, twilio: { phone_number: user.ryujin_phone_number }, status: 'already assigned (skipped)' });
    continue;
  }
  const num = twilioNumbers[numIdx++];
  const { error } = await sb.from('users')
    .update({ ryujin_phone_number: num.phone_number })
    .eq('id', user.id);
  if (error) {
    assignments.push({ user, twilio: num, status: `WRITE FAILED: ${error.message}` });
  } else {
    assignments.push({ user, twilio: num, status: 'ASSIGNED' });
  }
}

// ─── 5. Report ────────────────────────────────────────────────────
console.log('═══ ASSIGNMENT RESULT ═══\n');
for (const a of assignments) {
  const num = a.twilio?.phone_number || '—';
  console.log(`${a.user.name.padEnd(24)} ${a.user.role.padEnd(8)} ${num.padEnd(14)} ${a.status}`);
}
console.log('\n───────────────────────────────────');
console.log('Numbers in Twilio but not assigned to anyone:');
for (let i = numIdx; i < twilioNumbers.length; i++) console.log(`  ${twilioNumbers[i].phone_number}`);
if (numIdx === twilioNumbers.length) console.log('  (none — all assigned)');

console.log('\nNext: configure each Twilio number\'s webhooks in the dashboard:');
console.log('  Voice URL:           https://ryujin-os.vercel.app/api/twilio-voice  (POST)');
console.log('  Status callback URL: https://ryujin-os.vercel.app/api/twilio-status (POST)');
console.log('  Status callback events: initiated, ringing, answered, completed');
