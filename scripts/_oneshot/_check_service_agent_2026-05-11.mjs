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

const { data: serviceRows } = await sb.from('briefing_items')
  .select('source_agent, for_date, title')
  .eq('tenant_id', tenant.id)
  .eq('source_agent', 'service')
  .order('for_date', { ascending: false })
  .limit(10);
console.log('briefing_items where source_agent=service (most recent 10):');
for (const r of serviceRows || []) console.log(`  ${r.for_date}  ${r.title?.slice(0, 80)}`);
if (!serviceRows || serviceRows.length === 0) console.log('  (none)');

const { data: distinct } = await sb.from('briefing_items')
  .select('source_agent')
  .eq('tenant_id', tenant.id);
const seen = new Set();
for (const r of distinct || []) seen.add(r.source_agent || '(null)');
console.log('\nAll distinct source_agent values seen in briefing_items:');
for (const s of [...seen].sort()) console.log('  -', s);
