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
const sb = createClient((process.env.SUPABASE_URL||'').trim(), (process.env.SUPABASE_SERVICE_KEY||'').trim());
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

const SHARE = 'plus-ultra-test-metal';
const { data: existing } = await sb.from('estimates').select('id').eq('tenant_id', tenant.id).eq('share_token', SHARE).maybeSingle();
if (existing) await sb.from('estimates').delete().eq('id', existing.id);

let { data: customer } = await sb.from('customers').select('id').eq('tenant_id', tenant.id).eq('full_name', 'Test Metal Customer').maybeSingle();
if (!customer) {
  const r = await sb.from('customers').insert({
    tenant_id: tenant.id, full_name: 'Test Metal Customer', email: 'test@example.com', phone: '(506) 555-0100',
    address: '123 Test Lane', city: 'Moncton', province: 'NB'
  }).select('id').single();
  customer = r.data;
}

const calc = {
  'metal-americana':    { total: 28000, persq: 2000, summary: { sellingPrice: 28000, pricePerSQ: 2000, pricing_method: 'divisor' }, lineItems: [] },
  'metal-standing-seam':{ total: 38500, persq: 2750, summary: { sellingPrice: 38500, pricePerSQ: 2750, pricing_method: 'divisor' }, lineItems: [] },
  'metal-premium':      { total: 64200, persq: 4585, summary: { sellingPrice: 64200, pricePerSQ: 4585, pricing_method: 'divisor' }, lineItems: [] }
};

const { data, error } = await sb.from('estimates').insert({
  tenant_id: tenant.id, customer_id: customer.id, proposal_mode: 'Metal', pricing_model: 'Local',
  roof_area_sqft: 1400, roof_pitch: '6/12', complexity: 'medium',
  eaves_lf: 80, ridges_lf: 40, chimneys: 0, distance_km: 5,
  calculated_packages: calc, selected_package: 'metal-standing-seam',
  status: 'proposal_sent', proposal_status: 'Published',
  tags: ['sales_owner:mackenzie'], share_token: SHARE
}).select('*').single();

if (error) { console.error(error); process.exit(1); }
console.log('Test metal estimate:', data.id);
console.log('https://ryujin-os.vercel.app/proposal-client.html?share=' + SHARE);
