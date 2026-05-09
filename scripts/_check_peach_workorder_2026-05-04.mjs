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
const sb = createClient((process.env.SUPABASE_URL || '').trim(), (process.env.SUPABASE_SERVICE_KEY || '').trim());

const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

console.log('=== workorders table (if exists) ===');
const wo = await sb.from('workorders').select('*').eq('tenant_id', tenant.id).limit(200);
if (wo.error) console.log('workorders error:', wo.error.message);
else {
  const matches = wo.data.filter(w => JSON.stringify(w).toLowerCase().includes('peach'));
  console.log('matches:', matches.length);
  matches.forEach(m => console.log(JSON.stringify(m, null, 2)));
}

console.log('\n=== tickets table ===');
const tk = await sb.from('tickets').select('*').eq('tenant_id', tenant.id).limit(200);
if (tk.error) console.log('tickets error:', tk.error.message);
else {
  const matches = tk.data.filter(t => JSON.stringify(t).toLowerCase().includes('peach'));
  console.log('matches:', matches.length);
  matches.forEach(m => console.log(JSON.stringify(m, null, 2)));
}

console.log('\n=== estimates table — full row for Peach ===');
const est = await sb.from('estimates').select('*').eq('tenant_id', tenant.id).eq('share_token', 'plus-ultra-peach-platinum').single();
if (est.error) console.log('estimate error:', est.error.message);
else {
  console.log('estimate_number:', est.data.estimate_number);
  console.log('selected_package:', est.data.selected_package);
  console.log('proposal_status:', est.data.proposal_status);
  console.log('locked_at:', est.data.locked_at);
  console.log('shingle / color fields scan:');
  for (const [k, v] of Object.entries(est.data)) {
    const sv = String(v).toLowerCase();
    if (sv.includes('color') || sv.includes('weathered') || sv.includes('determined') || sv.includes('pending') || sv.includes('tbd')) {
      console.log('  ', k, '=', v);
    }
  }
}
