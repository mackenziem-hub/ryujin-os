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

// 1. PU-78 estimate
const { data: est } = await sb.from('estimates').select('id, estimate_number, customer_id, share_token').eq('id', '179cacdc-a4cd-48c5-91ba-b65930c7fd32').single();
console.log('PU-78 estimate:');
console.log('  id:', est?.id, 'number:', est?.estimate_number);
console.log('  customer_id:', est?.customer_id);
console.log('  share_token:', est?.share_token);

// 2. Mary's project
const { data: proj } = await sb.from('projects').select('id, name, customer_id, estimate_id, address').eq('id', 'e080e448-8f03-4487-b149-34f69cca0da4').single();
console.log('\nProject:');
console.log('  id:', proj?.id);
console.log('  name:', proj?.name);
console.log('  customer_id:', proj?.customer_id);
console.log('  estimate_id:', proj?.estimate_id);
console.log('  address:', proj?.address);

// 3. Both Mary customer rows
const { data: marys } = await sb.from('customers').select('id, full_name, email, ghl_contact_id, address').or('email.eq.marybrien99@gmail.com,id.eq.' + est?.customer_id).order('created_at', { ascending: true });
console.log('\nMary customer rows:');
(marys || []).forEach(c => console.log(`  ${c.id} | ${c.full_name} | ${c.email} | ghl=${c.ghl_contact_id} | ${c.address}`));

// 4. Diagnosis
console.log('\n=== DIAGNOSIS ===');
const match = est?.customer_id === proj?.customer_id;
console.log('estimate.customer_id === project.customer_id?', match);
if (!match) {
  console.log('=> MISMATCH. job.html filters estimates by project.customer.id, so PU-78 will not appear when opening job.html for this project.');
  console.log('=> Upload button will not render (it needs an estimate).');
  console.log('=> FIX: update projects.customer_id = ' + est?.customer_id + ' AND set projects.estimate_id = ' + est?.id);
}
