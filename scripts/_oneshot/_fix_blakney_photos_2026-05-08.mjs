// Replace #50's photos with the actual labeled before/after now in the job folder.
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { del } from '@vercel/blob';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const EST_ID = 'af97b4bf-68ec-4400-a0fb-3ef9c37466c1';
const FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/2152 NB-885';

// 1. Delete all existing photos + blobs
const { data: existing } = await sb.from('estimate_photos').select('id, url, filename, caption').eq('estimate_id', EST_ID);
for (const p of (existing || [])) {
  try { await del(p.url); } catch {}
  await sb.from('estimate_photos').delete().eq('id', p.id);
  console.log(`  ✗ deleted: ${p.caption} / ${p.filename}`);
}

// 2. Upload labeled files in their proper slots
async function uploadOne(filePath, caption, isCover) {
  const buf = readFileSync(filePath);
  const fname = basename(filePath);
  const fd = new FormData();
  fd.append('estimate_id', EST_ID);
  fd.append('caption', caption);
  fd.append('is_cover', isCover ? 'true' : 'false');
  fd.append('file', new Blob([buf], { type: 'image/png' }), fname);
  const r = await fetch(`${RYUJIN}/api/estimate-photos`, {
    method: 'POST', headers: { 'x-tenant-id': TENANT_SLUG }, body: fd
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`upload ${caption}: ${r.status} ${t.slice(0,200)}`);
  console.log(`  ✓ ${caption}: ${basename(filePath)}`);
  return JSON.parse(t).photos?.[0];
}

await uploadOne(`${FOLDER}/cover photo.png`,  'cover',  true);
await uploadOne(`${FOLDER}/before photo.png`, 'before', false);
await uploadOne(`${FOLDER}/after.png`,         'after',  false);

console.log('\nFinal photos on #50:');
const { data: final } = await sb.from('estimate_photos').select('caption, is_cover, filename').eq('estimate_id', EST_ID);
for (const p of final) console.log(`  ${(p.caption||'—').padEnd(8)} ${p.is_cover?'(cover)':'       '}  ${p.filename}`);
