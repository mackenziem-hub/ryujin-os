// One-shot: populate users.phone for the team so Twilio inbound calls
// can forward to their actual cells.

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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function normalizeE164(p, defaultCountry = '1') {
  const digits = String(p).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 12 && digits.startsWith('63')) return `+${digits}`;  // PH
  return `+${digits}`;
}

const ASSIGNMENTS = [
  { name_ilike: 'Diego%',     phone: normalizeE164('5065887948') },         // +15065887948
  { name_ilike: 'AJ%',        phone: normalizeE164('15068898283') },        // +15068898283
  { name_ilike: 'Ryan%',      phone: normalizeE164('15062910277') },        // +15062910277
  { name_ilike: 'Catherine%', phone: normalizeE164('639282539612', '63'), note: 'PH WhatsApp — voice calls incur international rates' },
  { name_ilike: 'Pavanjot%',  phone: normalizeE164('6478670480') },         // +16478670480 (Toronto)
];

const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

for (const a of ASSIGNMENTS) {
  const { data, error } = await sb.from('users')
    .update({ phone: a.phone })
    .eq('tenant_id', tenant.id)
    .ilike('name', a.name_ilike)
    .select('id, name, phone, ryujin_phone_number');
  if (error) { console.log(`✗ ${a.name_ilike}: ${error.message}`); continue; }
  if (!data?.length) console.log(`— no user matching ${a.name_ilike}`);
  else for (const u of data) console.log(`✓ ${u.name.padEnd(28)} cell=${u.phone}  ryujin=${u.ryujin_phone_number || '—'}${a.note ? '  ⚠ ' + a.note : ''}`);
}

console.log('\n═══ FINAL ROSTER ═══');
const { data: roster } = await sb.from('users')
  .select('name, role, ryujin_phone_number, phone')
  .eq('tenant_id', tenant.id)
  .order('name');
for (const u of roster) {
  const ready = u.ryujin_phone_number && u.phone ? '✓ ready' : (u.ryujin_phone_number ? '⚠ no cell' : (u.phone ? '⚠ no ryujin#' : '✗'));
  console.log(`${u.name.padEnd(28)} ${u.role.padEnd(8)} ryujin=${(u.ryujin_phone_number || '—').padEnd(14)} cell=${(u.phone || '—').padEnd(16)} ${ready}`);
}
