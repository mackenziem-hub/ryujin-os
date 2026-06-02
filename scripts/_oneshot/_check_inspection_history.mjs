import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY));

const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// 1. inspections table
console.log('=== inspections table ===');
try {
  const { data: insp, count } = await sb.from('inspections').select('*', { count: 'exact', head: false }).eq('tenant_id', TENANT).limit(5);
  console.log('total rows:', count || 0);
  if (insp?.length) {
    console.log('columns:', Object.keys(insp[0]).join(', '));
    insp.forEach(i => console.log('  -', i.id, '·', (i.title || i.summary || i.notes || '').toString().slice(0, 80)));
  } else {
    console.log('empty');
  }
} catch (e) { console.log('error:', e.message); }

// 2. estimate_photos tagged inspection/damage
console.log('\n=== estimate_photos with category=inspection or damage ===');
const { data: epi } = await sb.from('estimate_photos')
  .select('id, caption, category')
  .eq('tenant_id', TENANT)
  .in('category', ['inspection', 'damage'])
  .not('caption', 'is', null)
  .limit(15);
console.log('count:', epi?.length || 0);
(epi || []).forEach(p => console.log(`  [${p.category}] ${(p.caption||'').slice(0, 100)}`));

// 3. project_files captions
console.log('\n=== project_files with captions ===');
const { data: pf } = await sb.from('project_files')
  .select('id, caption, category')
  .eq('tenant_id', TENANT)
  .not('caption', 'is', null)
  .neq('caption', '')
  .limit(15);
console.log('count:', pf?.length || 0);
(pf || []).forEach(p => console.log(`  [${p.category}] ${(p.caption||'').slice(0, 100)}`));

// 4. companycam_archive sample captions (his crews' actual voice)
console.log('\n=== companycam_archive sample captions ===');
const { data: cc } = await sb.from('companycam_archive_photos')
  .select('id, caption')
  .eq('tenant_id', TENANT)
  .not('caption', 'is', null)
  .neq('caption', '')
  .order('captured_at', { ascending: false })
  .limit(15);
console.log('count:', cc?.length || 0);
if (cc?.[0]) console.log('caption shape sample:', JSON.stringify(cc[0]).slice(0,500));
(cc || []).slice(0, 5).forEach(p => console.log('  raw:', JSON.stringify(p.caption).slice(0,200)));

// 5. estimate sales_notes / proposal text from accepted asphalt jobs
console.log('\n=== recent estimate sales_notes ===');
const { data: est } = await sb.from('estimates')
  .select('id, estimate_number, sales_notes')
  .eq('tenant_id', TENANT)
  .not('sales_notes', 'is', null)
  .neq('sales_notes', '')
  .order('created_at', { ascending: false })
  .limit(8);
(est || []).forEach(e => console.log(`  PU-${e.estimate_number}: ${(e.sales_notes||'').slice(0, 150)}`));
