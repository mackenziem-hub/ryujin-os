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

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const sb = createClient(url, key);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }
const tenantId = tenant.id;

let { data: customer } = await sb.from('customers').select('*')
  .eq('tenant_id', tenantId).eq('full_name', 'Chris Goguen').maybeSingle();
if (!customer) {
  const { data, error } = await sb.from('customers').insert({
    tenant_id: tenantId,
    full_name: 'Chris Goguen',
    email: 'goguen57@gmail.com',
    phone: '(506) 971-5127',
    address: '715 Rt 11',
    city: 'Miramichi',
    province: 'NB'
  }).select('*').single();
  if (error) { console.error('customer insert', error); process.exit(1); }
  customer = data;
  console.log('Created customer', customer.id);
} else {
  console.log('Reusing customer', customer.id);
}

const calculatedPackages = {
  'metal-americana': {
    total: 30075,
    persq: Math.round(30075 / 14),
    summary: { sellingPrice: 30075, pricePerSQ: Math.round(30075 / 14), pricing_method: 'divisor' },
    lineItems: []
  },
  'metal-standing-seam': {
    total: 41025,
    persq: Math.round(41025 / 14),
    summary: { sellingPrice: 41025, pricePerSQ: Math.round(41025 / 14), pricing_method: 'divisor' },
    lineItems: []
  },
  'metal-premium': {
    total: 75400,
    persq: Math.round(75400 / 14),
    summary: { sellingPrice: 75400, pricePerSQ: Math.round(75400 / 14), pricing_method: 'divisor' },
    lineItems: []
  }
};

const SHARE = 'plus-ultra-32';
const { data: existing } = await sb.from('estimates').select('id, share_token, estimate_number')
  .eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();

const payload = {
  tenant_id: tenantId,
  customer_id: customer.id,
  proposal_mode: 'Metal',
  pricing_model: 'Local',
  roof_area_sqft: 1400,
  roof_pitch: '4/12',
  complexity: 'medium',
  eaves_lf: 90,
  ridges_lf: 47,
  chimneys: 1,
  chimney_size: 'small',
  distance_km: 173,
  calculated_packages: calculatedPackages,
  selected_package: 'metal-standing-seam',
  status: 'proposal_sent',
  proposal_status: 'Published',
  tags: ['sales_owner:darcy'],
  share_token: SHARE
};

if (existing) {
  console.log('Updating existing estimate', existing.id);
  await sb.from('estimates').update({ locked_at: null }).eq('id', existing.id);
  const { data, error } = await sb.from('estimates').update(payload).eq('id', existing.id).select('*').single();
  if (error) { console.error(error); process.exit(1); }
  console.log('Updated estimate', data.id, 'share_token=', data.share_token);
} else {
  const { data, error } = await sb.from('estimates').insert(payload).select('*').single();
  if (error) { console.error(error); process.exit(1); }
  console.log('Created estimate', data.id, 'share_token=', data.share_token, 'estimate_number=', data.estimate_number);
}

console.log('\nShare URL: https://ryujin-os.vercel.app/proposal-client.html?share=' + SHARE);
