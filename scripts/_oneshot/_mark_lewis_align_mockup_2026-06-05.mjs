// Resize 224 Mockup.png to match Cover Photo.png exact dimensions so the
// before/after slider lines up. Uses sharp with fit:cover (center-crops if
// aspect differs). Re-uploads to Blob + swaps the after row's URL.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
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
const COVER='C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/224 NB 530/Cover Photo.png';
const MOCKUP='C:/Users/macke/Downloads/224 Mockup.png';

const coverBuf = readFileSync(COVER);
const mockBuf = readFileSync(MOCKUP);
const coverMeta = await sharp(coverBuf).metadata();
const mockMeta = await sharp(mockBuf).metadata();
console.log(`Cover : ${coverMeta.width} × ${coverMeta.height}  (ar ${(coverMeta.width/coverMeta.height).toFixed(3)})`);
console.log(`Mockup: ${mockMeta.width} × ${mockMeta.height}  (ar ${(mockMeta.width/mockMeta.height).toFixed(3)})`);

const targetW = coverMeta.width;
const targetH = coverMeta.height;
console.log(`\nResizing mockup to ${targetW} × ${targetH} (center-crop if aspect differs)…`);
const alignedBuf = await sharp(mockBuf)
  .resize(targetW, targetH, { fit: 'cover', position: 'center' })
  .png({ quality: 92 })
  .toBuffer();
console.log(`  aligned size: ${(alignedBuf.length/1024).toFixed(0)} KB`);

console.log('Uploading to Vercel Blob…');
const blobPath = `tenants/${TENANT_SLUG}/estimates/${ID}/mockup-aligned-${Date.now()}.png`;
const blob = await put(blobPath, alignedBuf, {
  access: 'public', contentType: 'image/png',
  token: process.env.BLOB_READ_WRITE_TOKEN
});
console.log(`  ✓ ${blob.url}`);

// Swap the after row to the aligned version
const {data:afterRows}=await sb.from('estimate_photos')
  .select('id,url,filename').eq('estimate_id',ID)
  .or('caption.eq.after,category.eq.after');
for (const row of afterRows) {
  if (row.url.includes('mockup-after-') || row.url.includes('/brand/plus-ultra/gallery/')) {
    await sb.from('estimate_photos').update({
      url: blob.url,
      filename: '224 Mockup (aligned).png',
      mime_type: 'image/png'
    }).eq('id', row.id);
    console.log(`  ✓ swapped row ${row.id}`);
  }
}

console.log(`\n✓ Aligned. Both images now ${targetW} × ${targetH}.`);
console.log(`Customer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80`);
console.log(`(hard-refresh)`);
