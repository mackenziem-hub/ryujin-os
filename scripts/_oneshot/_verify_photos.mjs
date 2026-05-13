import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Get Kyle Graham estimate id
const { data: kyleEst } = await supa.from('estimates').select('id, share_token, customer_id').eq('share_token', 'plus-ultra-30').single();
console.log('Kyle estimate id:', kyleEst?.id);
console.log('Kyle customer id:', kyleEst?.customer_id);

// Pull ALL photos
const { data: allPhotos, error: err1, count: cnt } = await supa
  .from('estimate_photos')
  .select('*', { count: 'exact' })
  .order('created_at', { ascending: false })
  .limit(20);
console.log(`\nTotal estimate_photos rows (last 20): ${cnt || 'n/a'}, returned: ${allPhotos?.length}`);
if (err1) console.log('Error:', err1);
for (const p of allPhotos || []) {
  console.log(`Photo ${p.id} | est=${p.estimate_id} | cover=${p.is_cover} | caption=${p.caption} | created=${p.created_at}`);
}

// Direct lookup
console.log('\nDirect lookup by estimate_id:');
const { data: kylePhotos, error: err2 } = await supa
  .from('estimate_photos')
  .select('*')
  .eq('estimate_id', kyleEst?.id);
console.log('count:', kylePhotos?.length, 'error:', err2);
console.log(JSON.stringify(kylePhotos, null, 2));

// Check api/proposal.js photo lookup logic
console.log('\nMimic api/proposal.js lookup:');
const { data: photos, error: err3 } = await supa
  .from('estimate_photos')
  .select('id, url, caption, is_cover, created_at')
  .eq('estimate_id', kyleEst?.id)
  .order('created_at', { ascending: true });
console.log('count:', photos?.length, 'error:', err3);
console.log(JSON.stringify(photos, null, 2));
