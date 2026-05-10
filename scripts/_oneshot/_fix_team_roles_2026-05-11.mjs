// One-shot: fix role + name issues that break the routing map.
// AJ: crew → admin (per GM promotion in SESSION_CONTEXT)
// Darcy: estimator → sales (estimator isn't a recognized role)
// Mac: name typo Maseroll → Mazerolle
//
// All idempotent — won't error if already correct.

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

const FIXES = [
  { match: { name_ilike: 'AJ' }, set: { role: 'admin' }, why: 'GM (was crew)' },
  { match: { name_ilike: 'Darcy%' }, set: { role: 'sales' }, why: 'outside sales (was estimator)' },
  { match: { name_ilike: 'Mackenzie%' }, set: { name: 'Mackenzie Mazerolle' }, why: 'spelling fix' },
];

const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

for (const f of FIXES) {
  let q = sb.from('users').update(f.set).eq('tenant_id', tenant.id);
  if (f.match.name_ilike) q = q.ilike('name', f.match.name_ilike);
  const { data, error } = await q.select('id, name, role');
  if (error) { console.log(`✗ ${f.why}: ${error.message}`); continue; }
  if (!data || data.length === 0) console.log(`— no match for ${JSON.stringify(f.match)}`);
  else for (const r of data) console.log(`✓ ${r.name.padEnd(28)} role=${r.role.padEnd(8)} (${f.why})`);
}

// Verify final state.
console.log('\n═══ FINAL ROSTER ═══');
const { data: roster } = await sb.from('users')
  .select('name, role, ryujin_phone_number, phone')
  .eq('tenant_id', tenant.id)
  .order('name');
for (const u of roster) {
  console.log(`${u.name.padEnd(28)} ${u.role.padEnd(8)} ${(u.ryujin_phone_number || '—').padEnd(14)} cell=${u.phone || '—'}`);
}
