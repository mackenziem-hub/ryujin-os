// One-shot verifier for Session 14 review
import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function inspectEstimate(shareToken) {
  const { data, error } = await supa
    .from('estimates')
    .select('*, customer:customers(full_name, address, city)')
    .eq('share_token', shareToken)
    .single();
  if (error) { console.error(`ERR ${shareToken}:`, error); return; }
  console.log(`\n========== ${shareToken} (#${data.estimate_number}) ==========`);
  console.log('Customer:', data.customer?.full_name || 'n/a', '|', data.customer?.address || '', data.customer?.city || '');
  console.log('Status:', data.status);
  console.log('Created:', data.created_at);
  console.log('Updated:', data.updated_at);
  console.log('Proposal sent:', data.proposal_sent_at);
  console.log('Accepted:', data.accepted_at);
  console.log('Contract signed:', data.contract_signed_at);
  console.log('Final accepted total:', data.final_accepted_total);
  console.log('Selected package:', data.selected_package);
  console.log('Locked at:', data.locked_at);
  console.log('Tags:', JSON.stringify(data.tags));
  console.log('Notes (count):', Array.isArray(data.notes) ? data.notes.length : 'n/a');
  if (Array.isArray(data.notes)) {
    data.notes.forEach((n, i) => console.log(`  Note[${i}]:`, JSON.stringify(n).slice(0, 200)));
  }
  console.log('Activity log (count):', Array.isArray(data.activity_log) ? data.activity_log.length : 'n/a');
  if (Array.isArray(data.activity_log)) {
    data.activity_log.forEach((a, i) => console.log(`  Activity[${i}]:`, JSON.stringify(a).slice(0, 200)));
  }
  console.log('Custom prices keys:', Object.keys(data.custom_prices || {}));
  console.log('Custom prices FULL:', JSON.stringify(data.custom_prices, null, 2));
  console.log('Calculated packages keys:', Object.keys(data.calculated_packages || {}));
  // Show top-level total per package only
  if (data.calculated_packages) {
    for (const k of Object.keys(data.calculated_packages)) {
      const pkg = data.calculated_packages[k];
      console.log(`  pkg ${k}:`, JSON.stringify({
        total: pkg?.total,
        recommended_total: pkg?.recommended_total,
        finalPrice: pkg?.finalPrice,
        sellingPrice: pkg?.sellingPrice,
        retail: pkg?.retail,
        marginPercent: pkg?.marginPercent
      }).slice(0, 300));
    }
  }
  return data;
}

const tokens = ['plus-ultra-30', 'plus-ultra-56', 'plus-ultra-57'];
for (const t of tokens) {
  await inspectEstimate(t);
}

// Also: photo rows for #30 — direct lookup by estimate id
console.log('\n========== Kyle Graham #30 photos ==========');
const { data: kyleEst } = await supa.from('estimates').select('id').eq('share_token', 'plus-ultra-30').single();
if (kyleEst?.id) {
  const { data: photos } = await supa
    .from('estimate_photos')
    .select('id, estimate_id, url, filename, is_cover, caption, created_at')
    .eq('estimate_id', kyleEst.id)
    .order('created_at', { ascending: true });
  console.log(`Photo count: ${photos?.length || 0}`);
  for (const p of photos || []) {
    console.log(`Photo ${p.id} | cover=${p.is_cover} | caption=${p.caption} | created=${p.created_at}`);
    console.log(`  url: ${p.url}`);
  }
}
