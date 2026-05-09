// Lock Shelagh Peach customer address to canonical 5360 NB-495 (verbal confirm May 4).
// Was cached as "5380 Route 490, Sainte Marie" — wrong number AND wrong highway.
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

const { data: before } = await sb.from('customers').select('id, full_name, address, city, province')
  .eq('tenant_id', tenant.id).ilike('full_name', '%shelagh%peach%').single();
console.log('BEFORE:', before);

const { data: after, error } = await sb.from('customers').update({
  address: '5360 NB-495',
  city: 'Sainte-Marie-de-Kent',
  province: 'NB'
}).eq('id', before.id).select('id, full_name, address, city, province').single();
if (error) { console.error(error); process.exit(1); }
console.log('AFTER: ', after);
