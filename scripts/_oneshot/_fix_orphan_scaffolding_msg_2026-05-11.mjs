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
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();
const { data: mac } = await sb.from('users').select('id, name').eq('tenant_id', tenant.id).eq('name', 'Mackenzie Mazerolle').single();
const { data: aj } = await sb.from('users').select('id, name').eq('tenant_id', tenant.id).eq('name', 'AJ').single();

const { data: orphans } = await sb.from('messages')
  .select('id, subject, body, created_at, from_user_id, from_label, to_user_id, metadata')
  .eq('tenant_id', tenant.id)
  .eq('to_user_id', aj.id)
  .is('from_user_id', null)
  .ilike('subject', '%scaffolding%')
  .order('created_at', { ascending: false })
  .limit(3);

console.log('Found candidates:');
for (const o of orphans) {
  console.log(`  ${o.id}  subj="${o.subject}"  from_label="${o.from_label}"  at=${o.created_at}`);
}
if (orphans.length === 0) { console.log('Nothing to patch.'); process.exit(0); }

const target = orphans[0];
console.log(`\nPatching ${target.id}: from_user_id null → ${mac.id} (Mac)`);
const { error } = await sb.from('messages')
  .update({
    from_user_id: mac.id,
    from_label: mac.name,
    metadata: { ...(target.metadata || {}), patched_by: 'fix_orphan_scaffolding_msg_2026-05-11', original_from_label: target.from_label }
  })
  .eq('id', target.id);
if (error) console.error('FAIL:', error.message);
else console.log('OK.');
