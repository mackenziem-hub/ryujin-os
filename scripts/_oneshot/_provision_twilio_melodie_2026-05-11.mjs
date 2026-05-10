// One-shot: buy a Twilio NB number with webhooks pre-set and assign
// it to Melodie Wuttunee. Same shape as _buy_and_provision_twilio_*,
// scoped to a single user.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOK = process.env.TWILIO_AUTH_TOKEN;
if (!SID || !TOK) { console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN'); process.exit(1); }

const APP_BASE = 'https://ryujin-os.vercel.app';
const VOICE_URL = `${APP_BASE}/api/twilio-voice`;
const STATUS_URL = `${APP_BASE}/api/twilio-status`;
const AREA_CODE = '506';
const TARGET_EMAIL = 'melodi.wuttunee@gmail.com';

const auth = Buffer.from(`${SID}:${TOK}`).toString('base64');
const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' };

// 1. Search
const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/AvailablePhoneNumbers/CA/Local.json?AreaCode=${AREA_CODE}&VoiceEnabled=true&PageSize=5`;
const searchRes = await fetch(searchUrl, { headers: { Authorization: `Basic ${auth}` } });
if (!searchRes.ok) { console.error(`Search ${searchRes.status}:`, await searchRes.text()); process.exit(1); }
const offered = (await searchRes.json()).available_phone_numbers || [];
if (offered.length === 0) { console.error('No 506 numbers available — try 902 / 902 / 506 with delay'); process.exit(1); }
const cand = offered[0];
console.log(`Buying ${cand.phone_number}…`);

// 2. Buy with webhooks
const body = new URLSearchParams({
  PhoneNumber: cand.phone_number,
  VoiceUrl: VOICE_URL,
  VoiceMethod: 'POST',
  StatusCallback: STATUS_URL,
  StatusCallbackMethod: 'POST',
});
for (const ev of ['initiated','ringing','answered','completed']) body.append('StatusCallbackEvent', ev);

const buyRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`, {
  method: 'POST', headers, body: body.toString(),
});
const bought = await buyRes.json();
if (!buyRes.ok) { console.error('Buy failed:', bought); process.exit(1); }
console.log(`✓ purchased ${bought.phone_number} (sid=${bought.sid})`);
console.log(`  voice → ${VOICE_URL}`);
console.log(`  status → ${STATUS_URL}`);

// 3. Assign to Melodie
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug','plus-ultra').single();
const { data: user, error: findErr } = await sb.from('users').select('id, name, ryujin_phone_number')
  .eq('tenant_id', tenant.id).eq('email', TARGET_EMAIL).maybeSingle();
if (findErr || !user) { console.error('Could not find Melodie:', findErr); process.exit(1); }
if (user.ryujin_phone_number) {
  console.log(`\n⚠ ${user.name} already has ${user.ryujin_phone_number}. New number ${bought.phone_number} purchased but NOT assigned. Re-route or release manually.`);
  process.exit(0);
}
const { error: assignErr } = await sb.from('users').update({ ryujin_phone_number: bought.phone_number }).eq('id', user.id);
if (assignErr) { console.error(`Assign failed: ${assignErr.message}`); process.exit(1); }
console.log(`✓ assigned ${bought.phone_number} → ${user.name}`);
