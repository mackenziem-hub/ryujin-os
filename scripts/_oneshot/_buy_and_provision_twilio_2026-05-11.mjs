// One-shot: buy N NB-area-code Twilio numbers with webhooks pre-configured,
// then assign them to Plus Ultra operators.
//
// Default N = 6 (one per operator: Mac, AJ, Catherine, Darcy, Diego, Pavanjot).
// Override: node ... 4 (buys 4 instead).
//
// Each number costs ~$1.15 USD/mo + a small setup fee. 6 = ~$7/mo recurring.
// Free $15 trial credit covers the first month easily.

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

const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) { console.error('Missing TWILIO_*'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_*'); process.exit(1); }

const APP_BASE = 'https://ryujin-os.vercel.app';
const VOICE_URL = `${APP_BASE}/api/twilio-voice`;
const STATUS_URL = `${APP_BASE}/api/twilio-status`;
const COUNT = parseInt(process.argv[2], 10) || 6;
const AREA_CODE = process.argv[3] || '506';        // NB

const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
const baseHeaders = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' };

console.log(`Buying ${COUNT} number(s) in area code ${AREA_CODE} with webhooks pointing at ${APP_BASE}`);
console.log();

// ─── 1. Search available numbers ─────────────────────────────────
const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/CA/Local.json?AreaCode=${AREA_CODE}&VoiceEnabled=true&PageSize=20`;
const searchRes = await fetch(searchUrl, { headers: { Authorization: `Basic ${auth}` } });
if (!searchRes.ok) { console.error(`Search failed (${searchRes.status}):`, await searchRes.text()); process.exit(1); }
const { available_phone_numbers } = await searchRes.json();
console.log(`Twilio offered ${available_phone_numbers.length} number(s) in ${AREA_CODE}.`);
if (available_phone_numbers.length === 0) {
  console.log('Try a different area code (502, 902, 416, etc.) — re-run with: node ... <count> <areaCode>');
  process.exit(1);
}
const candidates = available_phone_numbers.slice(0, COUNT);

// ─── 2. Buy each, with webhooks pre-set ──────────────────────────
const purchased = [];
for (const cand of candidates) {
  const body = new URLSearchParams({
    PhoneNumber: cand.phone_number,
    VoiceUrl: VOICE_URL,
    VoiceMethod: 'POST',
    StatusCallback: STATUS_URL,
    StatusCallbackMethod: 'POST',
  });
  // StatusCallbackEvent is multi-value; URLSearchParams supports append.
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) {
    body.append('StatusCallbackEvent', ev);
  }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: baseHeaders,
    body: body.toString(),
  });
  const data = await r.json();
  if (!r.ok) {
    console.error(`Buy ${cand.phone_number} FAILED (${r.status}):`, data?.message || JSON.stringify(data));
    continue;
  }
  console.log(`✓ bought ${data.phone_number}  sid=${data.sid}`);
  purchased.push(data);
}
console.log();
console.log(`Total purchased: ${purchased.length}/${candidates.length}`);
console.log();

if (purchased.length === 0) { console.error('No numbers purchased — aborting assignment.'); process.exit(1); }

// ─── 3. Assign to operators ──────────────────────────────────────
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
const { data: users } = await sb.from('users')
  .select('id, name, role, phone, ryujin_phone_number')
  .eq('tenant_id', tenant.id)
  .order('name', { ascending: true });

const PRIORITY = ['mackenzie', 'mac', 'aj', 'catherine', 'darcy', 'diego', 'pavanjot'];
function priority(user) {
  const slug = (user.name || '').toLowerCase().split(/\s+/)[0];
  const idx = PRIORITY.indexOf(slug);
  return idx === -1 ? 999 : idx;
}
const sorted = [...users].sort((a, b) => priority(a) - priority(b));

console.log('═══ ASSIGNMENT ═══\n');
let numIdx = 0;
for (const user of sorted) {
  if (user.ryujin_phone_number) {
    console.log(`${user.name.padEnd(24)} ${user.role.padEnd(8)} ${user.ryujin_phone_number.padEnd(14)} already assigned (skipped)`);
    continue;
  }
  if (numIdx >= purchased.length) {
    console.log(`${user.name.padEnd(24)} ${user.role.padEnd(8)} ${'—'.padEnd(14)} no number available`);
    continue;
  }
  const num = purchased[numIdx++];
  const { error } = await sb.from('users')
    .update({ ryujin_phone_number: num.phone_number })
    .eq('id', user.id);
  if (error) {
    console.log(`${user.name.padEnd(24)} ${user.role.padEnd(8)} ${num.phone_number.padEnd(14)} WRITE FAILED: ${error.message}`);
  } else {
    console.log(`${user.name.padEnd(24)} ${user.role.padEnd(8)} ${num.phone_number.padEnd(14)} ASSIGNED`);
  }
}

console.log('\n───────────────────────────────────');
console.log('Webhooks were pre-configured at purchase time:');
console.log(`  Voice URL:           ${VOICE_URL}`);
console.log(`  Status callback URL: ${STATUS_URL}`);
console.log('No manual config in Twilio Console needed.');
console.log();
console.log('Next:');
console.log('  1. Have each operator log in once at /login.html (use temp passwords from _seed_team_users)');
console.log('  2. Each bookmarks their portal-*.html link');
console.log('  3. Test inbound: any team member dials another\'s Ryujin number from their personal cell');
console.log('  4. Outbound test: open /portal-calls.html → type a customer number → tap 📞 Call');
