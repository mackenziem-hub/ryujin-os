import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Look at activity_log + notes for #56/#57
for (const tok of ['plus-ultra-56', 'plus-ultra-57']) {
  const { data } = await supa
    .from('estimates')
    .select('id, share_token, estimate_number, created_at, updated_at, custom_prices, notes, status, calculated_packages, selected_package')
    .eq('share_token', tok).single();
  console.log(`\n========== ${tok} ==========`);
  console.log('Created:', data.created_at);
  console.log('Updated:', data.updated_at);
  console.log('Status:', data.status);
  console.log('Selected package:', data.selected_package);
  console.log('Custom prices keys:', Object.keys(data.custom_prices || {}));
  console.log('Custom prices values:', JSON.stringify(data.custom_prices));
  if (Array.isArray(data.notes)) {
    console.log('\nNotes:');
    data.notes.forEach((n, i) => {
      console.log(`[${i}] ${typeof n === 'object' ? JSON.stringify(n).slice(0, 800) : String(n).slice(0, 800)}`);
    });
  }
}

// Check audit log if it exists
console.log('\n========== price_audit + activity_log lookups ==========');
const { data: casey56 } = await supa.from('estimates').select('id').eq('share_token', 'plus-ultra-56').single();
const { data: casey57 } = await supa.from('estimates').select('id').eq('share_token', 'plus-ultra-57').single();
if (casey56) {
  // price_audit table from migration 004 if it tracks estimates
  const { data: audit56, error: ae56 } = await supa
    .from('price_audit')
    .select('*')
    .eq('estimate_id', casey56.id)
    .order('created_at', { ascending: false });
  console.log('price_audit for #56:', audit56?.length || 0, 'rows', ae56?.message || '');
}

// Look at activity table for these estimate ids
console.log('\n========== activity surface ==========');
try {
  const { data: act, error: ae } = await supa
    .from('activity_log')
    .select('*')
    .or(`entity_id.eq.${casey56.id},entity_id.eq.${casey57.id}`)
    .order('created_at', { ascending: false })
    .limit(20);
  console.log('activity_log rows:', act?.length, ae?.message || '');
  for (const a of act || []) {
    console.log(`  [${a.created_at}] ${a.action} ${a.entity_type}:${a.entity_id} ${JSON.stringify(a.payload || {}).slice(0, 200)}`);
  }
} catch (e) { console.log('activity lookup failed:', e.message); }
