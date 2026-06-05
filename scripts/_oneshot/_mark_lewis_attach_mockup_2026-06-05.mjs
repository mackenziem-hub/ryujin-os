// Mark Lewis #80 — replace the placeholder "after" with Mac's downloaded mockup.
import { readFileSync } from 'node:fs';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
  let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
  if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const TENANT_SLUG='plus-ultra';
const MOCKUP_PATH='C:/Users/macke/Downloads/224 Mockup.png';

console.log('Reading mockup…');
const buf = readFileSync(MOCKUP_PATH);
console.log(`  ${(buf.length/1024).toFixed(0)} KB`);

console.log('Uploading to Vercel Blob…');
const blobPath = `tenants/${TENANT_SLUG}/estimates/${ID}/mockup-after-${Date.now()}.png`;
const blob = await put(blobPath, buf, {
  access: 'public',
  contentType: 'image/png',
  token: process.env.BLOB_READ_WRITE_TOKEN
});
console.log(`  ✓ ${blob.url}`);

// Swap the existing after row (currently the brand gallery placeholder)
const {data:afterRows}=await sb.from('estimate_photos')
  .select('id,url,caption,category').eq('estimate_id',ID).or('caption.eq.after,category.eq.after');
console.log(`Found ${afterRows.length} after-candidate rows`);

let swapped = 0;
for (const row of afterRows) {
  if (row.url.includes('/brand/plus-ultra/gallery/')) {
    await sb.from('estimate_photos').update({
      url: blob.url,
      filename: '224 Mockup.png',
      mime_type: 'image/png',
      caption: 'after',
      category: 'after'
    }).eq('id', row.id);
    console.log(`  ✓ swapped row ${row.id}`);
    swapped++;
  }
}

if (swapped === 0) {
  console.log('  no placeholder found, inserting fresh after row');
  await sb.from('estimate_photos').insert({
    estimate_id: ID,
    url: blob.url,
    filename: '224 Mockup.png',
    mime_type: 'image/png',
    caption: 'after',
    category: 'after',
    is_cover: false
  });
}

console.log(`\n✓ Done.`);
console.log(`Customer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80`);
console.log(`(hard-refresh)`);
