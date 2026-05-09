// Replace Kataria #45's after photo with the freshly regenerated version
// (Mac noticed the AI render had drifted on the building so he made a new one).
// Deletes the old after row + blob, uploads the new file.
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
const ESTIMATE_ID = 'f2b65c43-37c5-4ebd-adda-e56cbb988cd9';
const FILE = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/147 Evergreen Dr/after photo.png';

// 1. Find existing after row
const { data: existing } = await sb.from('estimate_photos')
  .select('id, url, filename')
  .eq('estimate_id', ESTIMATE_ID).eq('caption', 'after');

if (existing && existing.length > 0) {
  for (const row of existing) {
    try { await del(row.url); } catch (e) { /* blob may already be gone */ }
    await sb.from('estimate_photos').delete().eq('id', row.id);
    console.log(`✓ deleted old after: ${row.filename} (${row.id})`);
  }
}

// 2. Upload new after via the public endpoint
const buf = readFileSync(FILE);
const fname = basename(FILE);
const fd = new FormData();
fd.append('estimate_id', ESTIMATE_ID);
fd.append('caption', 'after');
fd.append('is_cover', 'false');
fd.append('file', new Blob([buf], { type: 'image/png' }), fname);

const r = await fetch(`${RYUJIN}/api/estimate-photos`, {
  method: 'POST', headers: { 'x-tenant-id': TENANT_SLUG }, body: fd
});
const t = await r.text();
if (!r.ok) { console.error('upload failed:', r.status, t.slice(0, 300)); process.exit(1); }
const j = JSON.parse(t);
console.log(`✓ new after uploaded: ${j.photos?.[0]?.url?.slice(0, 80)}`);

// 3. Final state
const { data: final } = await sb.from('estimate_photos')
  .select('caption,is_cover,filename').eq('estimate_id', ESTIMATE_ID);
console.log('\nFinal photos on #45:');
for (const p of final) console.log(`  ${(p.caption || '—').padEnd(10)} ${p.is_cover ? '(cover)' : '       '} ${p.filename}`);
