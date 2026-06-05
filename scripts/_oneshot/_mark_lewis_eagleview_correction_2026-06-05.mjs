// Mark Lewis estimate #80 — correct measurements with EagleView 71482609 (6/3/2026).
// Re-run engine, overwrite calculated_packages, upload Mac's 3 photos (Cover + 2 side views).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateMultiOfferQuote } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const eq = line.indexOf('='); if (eq < 0 || line.startsWith('#')) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  v = v.replace(/\\n/g, '').trim();
  if (!process.env[k]) process.env[k] = v;
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const RYUJIN = 'https://ryujin-os.vercel.app';
const TENANT_SLUG = 'plus-ultra';
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const HEADERS = { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_SLUG };
const ESTIMATE_ID = 'f18ba35b-5e7d-4a4b-90f1-7971e648cb94';
const PHOTO_FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/224 NB 530';

// EagleView Premium Report 71482609 - 6/3/2026
// Total Roof Area 4417 sq ft (true slope area). Predominant pitch 4/12. Stories <=1.
// Ridges 54 + Hips 253 = 307 LF. Valleys 79. Rakes 41. Eaves 278. Step 9. Wall 2.
// Estimated attic 4184 sqft = footprint we feed to engine (× 1.054 4/12 mult = ~4410 ≈ 4417).
const measurements = {
  squareFeet: 4184,         // footprint; engine applies pitch mult
  pitch: '4/12',
  complexity: 'medium',     // Mac's call; 14 facets but predominantly hip
  distanceKM: 30,
  extraLayers: 0,
  eavesLF: 278,
  rakesLF: 41,
  ridgesLF: 54,
  hipsLF: 253,
  valleysLF: 79,
  wallsLF: 11,              // 2 wall + 9 step flashing
  pipes: 3,
  vents: 4,
  chimneys: 1,
  chimneySize: 'large',
  stories: 1,
  projectType: 'Local'
};

async function quoteCompare() {
  const r = await fetch(`${RYUJIN}/api/quote?mode=compare&tenant=${TENANT_SLUG}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify({ measurements })
  });
  if (!r.ok) throw new Error(`quote ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r.json();
}

function shapeCalculated(compare) {
  const out = {};
  for (const slug of ['gold', 'platinum', 'diamond']) {
    const o = compare.offers?.[slug]; if (!o) continue;
    const s = o.summary;
    const total = s.sellingPrice;
    const totalWithTax = s.totalWithTax || Math.round(total * 1.15);
    out[slug] = {
      total, totalWithTax,
      tax: totalWithTax - total,
      persq: s.pricePerSQ,
      margin: s.netMargin,
      lineItems: o.lineItems,
      summary: s
    };
  }
  return out;
}

async function uploadPhotoDirect(fname, caption, isCover, category) {
  const fullPath = `${PHOTO_FOLDER}/${fname}`;
  if (!existsSync(fullPath)) { console.log(`  ⚠ skip ${fname} (not found)`); return null; }
  const { put } = await import('@vercel/blob');
  const buf = readFileSync(fullPath);
  const ext = fname.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const blobPath = `tenants/${TENANT_SLUG}/estimates/${ESTIMATE_ID}/${Date.now()}-${fname.replace(/\s+/g, '-')}`;
  const blob = await put(blobPath, buf, { access: 'public', contentType: mime, token: process.env.BLOB_READ_WRITE_TOKEN });
  const { data: row, error } = await sb.from('estimate_photos').insert({
    estimate_id: ESTIMATE_ID,
    url: blob.url,
    filename: fname,
    mime_type: mime,
    caption,
    category,
    is_cover: isCover
  }).select('*').single();
  if (error) throw new Error(`photo ${fname}: ${error.message}`);
  console.log(`  ✓ ${fname} → ${caption}${isCover ? ' (COVER)' : ''}`);
  return row;
}

// ── RUN ─────────────────────────────────────────────────────
console.log('Running engine with EagleView corrected measurements…');
const compare = await quoteCompare();
const cp = shapeCalculated(compare);

console.log('\nNEW Engine SOP prices (4/12 pitch · 44 SQ):');
for (const slug of ['gold','platinum','diamond']) {
  if (!cp[slug]) continue;
  console.log(`  ${slug.padEnd(10)} $${cp[slug].total.toLocaleString()} (incl HST $${cp[slug].totalWithTax.toLocaleString()})  $${cp[slug].persq}/SQ`);
}

console.log('\nUpdating estimate #80…');
const updateBody = {
  roof_area_sqft: measurements.squareFeet,
  roof_pitch: measurements.pitch,
  complexity: measurements.complexity,
  eaves_lf: measurements.eavesLF,
  rakes_lf: measurements.rakesLF,
  ridges_lf: measurements.ridgesLF,
  valleys_lf: measurements.valleysLF,
  hips_lf: measurements.hipsLF,
  walls_lf: measurements.wallsLF,
  pipes: measurements.pipes,
  vents: measurements.vents,
  chimneys: measurements.chimneys,
  chimney_size: measurements.chimneySize,
  stories: measurements.stories,
  distance_km: measurements.distanceKM,
  calculated_packages: cp
};
const { error: updErr } = await sb.from('estimates').update(updateBody).eq('id', ESTIMATE_ID);
if (updErr) throw new Error(`update: ${updErr.message}`);
console.log('  ✓ measurements + calculated_packages updated');

// Correct customer city
const { data: est } = await sb.from('estimates').select('customer_id').eq('id', ESTIMATE_ID).single();
await sb.from('customers').update({
  city: 'Dundas', province: 'NB', postal_code: 'E4R5J7'
}).eq('id', est.customer_id);
console.log('  ✓ customer city corrected to Dundas NB E4R5J7');

console.log('\nUploading Mac\'s 3 photos…');
await uploadPhotoDirect('Cover Photo.png', 'cover', true, 'general');
await uploadPhotoDirect('side view.png', 'side view', false, 'inspection');
await uploadPhotoDirect('side view 2.png', 'side view 2', false, 'inspection');

// Add EagleView tag + note
const { data: cur } = await sb.from('estimates').select('tags, notes').eq('id', ESTIMATE_ID).single();
const newTags = Array.from(new Set([...(cur.tags || []), 'eagleview:71482609-2026-06-03', 'measurements_corrected_jun5']));
const newNotes = [
  ...(cur.notes || []),
  {
    author: 'claude-code',
    timestamp: new Date().toISOString().slice(0, 10),
    note: `EagleView 71482609 (6/3/2026) numbers replaced Mac's hand measurements.
- 4417 sqft TRUE roof area (44 SQ) at 4/12 predominant pitch (was estimated 49 SQ at 5/12)
- 14 facets, predominantly hipped
- Ridges 54 + Hips 253 = 307 LF (matches Mac's "300 LF ridge+cap" call)
- 79 LF valleys / 41 LF rakes / 278 LF eaves / 11 LF wall+step flash
- Mac dropped Cover Photo.png + side view.png + side view 2.png in Jobs folder
- Cover photo set; ready for Higgsfield img2img through proposal-builder.

Address corrected: Dundas NB E4R5J7 (was Grand-Digue placeholder).`
  }
];
await sb.from('estimates').update({ tags: newTags, notes: newNotes }).eq('id', ESTIMATE_ID);
console.log('  ✓ tags + note appended');

console.log(`\n✓ DONE`);
console.log(`Customer URL: ${RYUJIN}/proposal-client.html?share=plus-ultra-80`);
console.log(`Builder URL:  ${RYUJIN}/proposal-builder.html?id=${ESTIMATE_ID}`);
