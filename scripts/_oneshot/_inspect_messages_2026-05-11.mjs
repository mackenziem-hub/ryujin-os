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

const { data: users } = await sb.from('users')
  .select('id, name, email, role')
  .eq('tenant_id', tenant.id);
const byId = Object.fromEntries(users.map(u => [u.id, u]));

console.log('═══ USERS ═══');
for (const u of users) console.log(`  ${u.id.slice(0,8)}  ${u.name.padEnd(20)} ${u.role.padEnd(15)} ${u.email||''}`);

console.log('\n═══ RECENT MESSAGES (last 20) ═══');
const { data: msgs } = await sb.from('messages')
  .select('id, thread_id, from_user_id, from_label, to_user_id, subject, body, created_at, read_at, archived_at, metadata')
  .eq('tenant_id', tenant.id)
  .order('created_at', { ascending: false })
  .limit(20);
for (const m of msgs || []) {
  const from = m.from_user_id ? byId[m.from_user_id]?.name : (m.from_label || 'system');
  const to = byId[m.to_user_id]?.name || m.to_user_id?.slice(0,8) || '?';
  console.log(`  [${m.created_at.slice(11,19)}]  ${from} → ${to}`);
  console.log(`     subj="${m.subject||'(none)'}"  read=${m.read_at?'Y':'N'}  thread=${m.thread_id?.slice(0,8)||'-'}`);
  console.log(`     body: ${m.body?.slice(0,120)}${m.body?.length>120?'...':''}`);
}

console.log('\n═══ SESSIONS (active) ═══');
const { data: sessions } = await sb.from('sessions')
  .select('user_id, token, expires_at, created_at')
  .gt('expires_at', new Date().toISOString())
  .order('created_at', { ascending: false })
  .limit(10);
for (const s of sessions || []) {
  const u = byId[s.user_id];
  console.log(`  ${u?.name||s.user_id.slice(0,8).padEnd(20)} token=${s.token.slice(0,8)}...  expires=${s.expires_at.slice(0,16)}  created=${s.created_at.slice(0,16)}`);
}
