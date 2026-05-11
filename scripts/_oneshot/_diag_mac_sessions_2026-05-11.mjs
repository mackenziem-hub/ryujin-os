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
const { data: mac } = await sb.from('users').select('id,name,email,role,password_hash').eq('tenant_id', tenant.id).eq('name', 'Mackenzie Mazerolle').single();

console.log('═══ MAC USER ROW ═══');
console.log(`  id=${mac.id}`);
console.log(`  email=${mac.email}`);
console.log(`  role=${mac.role}`);
console.log(`  has_password=${!!mac.password_hash}`);

console.log('\n═══ MAC ALL SESSIONS (ordered newest) ═══');
const now = new Date();
const { data: sessions } = await sb.from('sessions')
  .select('id, token, expires_at, created_at')
  .eq('user_id', mac.id)
  .order('created_at', { ascending: false })
  .limit(20);
for (const s of sessions || []) {
  const expired = new Date(s.expires_at) < now;
  console.log(`  ${expired?'❌':'✅'}  token=${s.token.slice(0,16)}…  exp=${s.expires_at.slice(0,16)}  created=${s.created_at.slice(0,16)}`);
}

console.log('\n═══ MAC INBOX (last 5 messages where to=Mac) ═══');
const { data: inbox } = await sb.from('messages')
  .select('id, from_label, subject, created_at, read_at, from_user_id, to_user_id')
  .eq('tenant_id', tenant.id)
  .eq('to_user_id', mac.id)
  .order('created_at', { ascending: false })
  .limit(5);
for (const m of inbox || []) {
  console.log(`  [${m.created_at.slice(11,19)}]  from_user_id=${m.from_user_id?.slice(0,8)||'NULL'}  label="${m.from_label||'-'}"  subj="${m.subject||'-'}"  read=${m.read_at?'Y':'N'}`);
}

console.log('\n═══ MAC SENT (last 5 messages where from=Mac) ═══');
const { data: sent } = await sb.from('messages')
  .select('id, subject, created_at, to_user_id')
  .eq('tenant_id', tenant.id)
  .eq('from_user_id', mac.id)
  .order('created_at', { ascending: false })
  .limit(5);
for (const m of sent || []) {
  console.log(`  [${m.created_at.slice(11,19)}]  to=${m.to_user_id.slice(0,8)}  subj="${m.subject||'-'}"`);
}
