// Upload Kataria #45 photos from the job folder. Cover photo serves double duty
// as before per Mac's pattern (cover_photo.png = same image used as before_photo).
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const ESTIMATE_ID = 'f2b65c43-37c5-4ebd-adda-e56cbb988cd9';
const FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/147 Evergreen Dr';

async function uploadOne(filePath, caption, isCover) {
  const buf = readFileSync(filePath);
  const fname = basename(filePath);
  const fd = new FormData();
  fd.append('estimate_id', ESTIMATE_ID);
  fd.append('caption', caption);
  fd.append('is_cover', isCover ? 'true' : 'false');
  fd.append('file', new Blob([buf], { type: 'image/png' }), fname);
  const r = await fetch(`${RYUJIN}/api/estimate-photos`, {
    method: 'POST',
    headers: { 'x-tenant-id': TENANT_SLUG },
    body: fd
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`upload ${caption} failed (${r.status}): ${t.slice(0, 300)}`);
  const j = JSON.parse(t);
  return j.photos?.[0];
}

// 1. Upload cover photo as cover (also is_cover=true on row)
const cover = await uploadOne(`${FOLDER}/cover photo.png`, 'cover', true);
console.log(`✓ cover uploaded: ${cover?.url?.slice(0, 80)}`);

// 2. Insert a SECOND estimate_photos row pointing at the same blob with caption='before'
//    (avoids re-uploading the same file). Mac's pattern: cover image doubles as before.
const { data: beforeRow, error: berr } = await sb.from('estimate_photos').insert({
  estimate_id: ESTIMATE_ID,
  url: cover.url,
  filename: cover.filename,
  mime_type: cover.mime_type,
  is_cover: false,
  caption: 'before'
}).select('*').single();
if (berr) console.error('before row err:', berr.message);
else console.log(`✓ before row created (same blob): ${beforeRow.id}`);

// 3. Upload after photo
const after = await uploadOne(`${FOLDER}/after photo.png`, 'after', false);
console.log(`✓ after uploaded: ${after?.url?.slice(0, 80)}`);

console.log('\nDone. Verify at:');
console.log(`  Share: ${RYUJIN}/proposal-client.html?share=plus-ultra-45`);
console.log(`  Admin: ${RYUJIN}/sales-proposal.html?id=${ESTIMATE_ID}`);
