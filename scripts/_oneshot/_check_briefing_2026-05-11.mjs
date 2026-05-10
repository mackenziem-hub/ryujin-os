import fs from 'node:fs'; import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)) { const m=line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug','plus-ultra').single();
console.log('Today (UTC):', new Date().toISOString().slice(0,10));
console.log('Now (UTC):', new Date().toISOString());
const { data: counts } = await sb.from('briefing_items').select('for_date, source_agent, count:id').eq('tenant_id', tenant.id).order('for_date',{ ascending:false }).limit(50);
console.log('\nBriefing items by date+agent (most recent 50 rows ungrouped):');
const bydate = {};
for (const r of counts || []) { const k = `${r.for_date} / ${r.source_agent || '(none)'}`; bydate[k] = (bydate[k]||0)+1; }
for (const [k,v] of Object.entries(bydate)) console.log(`  ${k.padEnd(35)} ${v}`);
const today = new Date().toISOString().slice(0,10);
const { data: today_items } = await sb.from('briefing_items').select('id, source_agent, priority, for_date, for_user_id, title, dismissed_at').eq('tenant_id', tenant.id).eq('for_date', today).order('priority').limit(20);
console.log(`\nToday's (${today}) briefing items:`);
for (const b of today_items || []) console.log(`  ${(b.source_agent||'(none)').padEnd(10)} ${b.priority||''} ${b.title?.slice(0,70)}`);
