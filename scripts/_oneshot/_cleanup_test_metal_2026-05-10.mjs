// One-shot cleanup: removes the seeded "Test Metal Customer" + matching estimate
// from the live tenant. Manus audit (2026-05-10) flagged the seeded record
// surfacing in /customer-list.html.
//
// Mirrors the structure of scripts/seed_test_metal.mjs (which created the row).
// Run from repo root: node scripts/_oneshot/_cleanup_test_metal_2026-05-10.mjs

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
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }

const SHARE = 'plus-ultra-test-metal';

// 1. Delete the estimate by share token
const { data: est, error: estFetchErr } = await sb
  .from('estimates').select('id').eq('tenant_id', tenant.id).eq('share_token', SHARE).maybeSingle();
if (estFetchErr) console.error('estimate fetch:', estFetchErr);
if (est) {
  const { error } = await sb.from('estimates').delete().eq('id', est.id);
  if (error) { console.error('estimate delete:', error); } else { console.log('deleted estimate', est.id); }
} else {
  console.log('no test estimate to delete');
}

// 2. Delete the customer row by exact name + email match
const { data: customer } = await sb
  .from('customers').select('id, full_name')
  .eq('tenant_id', tenant.id)
  .eq('full_name', 'Test Metal Customer')
  .eq('email', 'test@example.com')
  .maybeSingle();
if (customer) {
  // Sanity-check: refuse to delete if there are other estimates pointing at this customer
  const { data: others } = await sb.from('estimates').select('id').eq('tenant_id', tenant.id).eq('customer_id', customer.id);
  if (others && others.length > 0) {
    console.error(`customer ${customer.id} still has ${others.length} estimate(s) — bailing out`);
    process.exit(1);
  }
  const { error } = await sb.from('customers').delete().eq('id', customer.id);
  if (error) { console.error('customer delete:', error); } else { console.log('deleted customer', customer.id); }
} else {
  console.log('no Test Metal Customer to delete');
}

console.log('done.');
