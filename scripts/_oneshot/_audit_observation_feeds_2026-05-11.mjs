// Mirror each loadXxxObservations helper's query and report what
// would land in the chat prompt right now.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) for (const l of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: t } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();
const tid = t.id;

async function check(label, fn) {
  try {
    const result = await fn();
    console.log(`  ${label}: ${result}`);
  } catch (e) { console.log(`  ${label}: ERROR ${e.message?.slice(0,100)}`); }
}

console.log('━━━ Patched feeds — should now be error-free ━━━');
const now = new Date();
const horizon = new Date(now.getTime() + 7 * 86400000).toISOString();

await check('estimates scheduled (next 7d)', async () => {
  const r = await sb.from('estimates').select('id, scheduled_at').eq('tenant_id', tid).not('scheduled_at', 'is', null).gte('scheduled_at', now.toISOString()).lte('scheduled_at', horizon).limit(5);
  return r.error ? `ERR ${r.error.message}` : `${r.data.length} rows`;
});

await check('voice_memos.uploader_user_id', async () => {
  const r = await sb.from('voice_memos').select('uploader_user_id, transcription').eq('tenant_id', tid).limit(3);
  return r.error ? `ERR ${r.error.message}` : `${r.data.length} rows`;
});

await check('phone_calls.from_user_id', async () => {
  const r = await sb.from('phone_calls').select('from_user_id, from_phone, direction, status').eq('tenant_id', tid).limit(3);
  return r.error ? `ERR ${r.error.message}` : `${r.data.length} rows`;
});

await check('activity_log (entity_type/action)', async () => {
  const r = await sb.from('activity_log').select('user_id, entity_type, action, details').eq('tenant_id', tid).limit(3);
  return r.error ? `ERR ${r.error.message}` : `${r.data.length} rows`;
});
