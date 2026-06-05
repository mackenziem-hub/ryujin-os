// Mark Lewis #80 — generate a real "after" render of his roof using OpenAI gpt-image-1.
// Input: Cover Photo.png from disk. Prompt: charcoal Landmark Pro re-roof, everything else identical.
// Output: upload to Vercel Blob, swap the existing 'after' estimate_photos row to point at it.
import { readFileSync, writeFileSync } from 'node:fs';
import { Blob, File } from 'node:buffer';
import { put } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

// Prefer prod env (fresher OPENAI_API_KEY than the stale local one)
for (const envFile of ['.env.production', '.env.local']) {
  try {
    for (const line of readFileSync(envFile,'utf8').split(/\r?\n/)) {
      const eq=line.indexOf('='); if (eq<0||line.startsWith('#'))continue;
      let v=line.slice(eq+1); if (v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);
      if(!process.env[line.slice(0,eq).trim()])process.env[line.slice(0,eq).trim()]=v.replace(/\\n/g,'').trim();
    }
  } catch {}
}
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);
const ID='f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const TENANT_SLUG='plus-ultra';
const COVER_PATH='C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/224 NB 530/Cover Photo.png';

const PROMPT = `Replace ONLY the roof covering of this home with brand new architectural asphalt shingles in a rich weathered-charcoal colour, crisp straight courses, and a clean ridge cap. Keep EVERYTHING ELSE identical and unchanged: walls, siding, windows, doors, chimney, gutters, soffit, fascia, trees, landscaping, driveway, sky, lighting, and the exact camera angle. Photorealistic, natural daylight, high resolution.`;

console.log('Reading cover photo…');
const buf = readFileSync(COVER_PATH);
console.log(`  ${(buf.length/1024).toFixed(0)} KB`);

console.log('\nCalling OpenAI gpt-image-1 edit…');
const fd = new FormData();
fd.append('model', 'gpt-image-1');
fd.append('image', new File([buf], 'cover.png', { type: 'image/png' }));
fd.append('prompt', PROMPT);
fd.append('size', '1536x1024');
fd.append('n', '1');

const t0 = Date.now();
const r = await fetch('https://api.openai.com/v1/images/edits', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
  body: fd
});
const text = await r.text();
const elapsed = ((Date.now() - t0)/1000).toFixed(1);
if (!r.ok) {
  console.error(`  ✗ ${r.status} after ${elapsed}s`);
  console.error(text.slice(0, 500));
  process.exit(1);
}
const data = JSON.parse(text);
const b64 = data?.data?.[0]?.b64_json;
if (!b64) {
  console.error('  ✗ no b64_json in response. Body:', JSON.stringify(data).slice(0, 400));
  process.exit(1);
}
console.log(`  ✓ generated in ${elapsed}s`);

const renderBuf = Buffer.from(b64, 'base64');
console.log(`  rendered size: ${(renderBuf.length/1024).toFixed(0)} KB`);

console.log('\nUploading to Vercel Blob…');
const blobPath = `tenants/${TENANT_SLUG}/estimates/${ID}/openai-after-${Date.now()}.png`;
const blob = await put(blobPath, renderBuf, {
  access: 'public',
  contentType: 'image/png',
  token: process.env.BLOB_READ_WRITE_TOKEN
});
console.log(`  ✓ ${blob.url}`);

console.log('\nUpdating estimate_photos…');
// Find existing after row (the brand-gallery placeholder) and swap its URL
const {data:afterRows}=await sb.from('estimate_photos')
  .select('id,url,caption').eq('estimate_id',ID).or('caption.eq.after,category.eq.after');
console.log(`  found ${afterRows.length} after-candidate rows`);
for (const row of afterRows) {
  const isPlaceholder = row.url.includes('/brand/plus-ultra/gallery/');
  if (isPlaceholder) {
    await sb.from('estimate_photos').update({
      url: blob.url,
      filename: 'mark-lewis-after-openai.png',
      mime_type: 'image/png'
    }).eq('id', row.id);
    console.log(`  ✓ swapped ${row.id} from placeholder to real render`);
  }
}

console.log(`\n✓ Done.`);
console.log(`Customer URL: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-80`);
console.log(`(hard-refresh)`);
