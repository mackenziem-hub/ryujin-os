// Compress + re-upload Letain envelope images.
// PNGs from Mac's renders are 1-2 MB each — too slow to load reliably on
// mobile. Convert to WebP at ~80% quality and 1600px max width.
// Manus Round 2: blob images had complete:false / naturalWidth:0 after 12s.
// This solves the "Loading preview..." stuck state.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { put } from '@vercel/blob';
import sharp from 'sharp';

const envPath = resolve(process.cwd(), '.env.production');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch (e) { console.error('No .env.production'); process.exit(1); }

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN?.trim();
if (!BLOB_TOKEN) { console.error('No BLOB_READ_WRITE_TOKEN'); process.exit(1); }

const TENANT_SLUG = 'plus-ultra';
const ESTIMATE_ID = 'c7240b24-fb20-49c1-80c5-4babe1dc9d4c';
const FOLDER = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/28 Russell St- Peticodiac';

const FILES = [
  { src: 'cover photo.png',                        key: 'cover',            maxWidth: 1600, quality: 82 },
  { src: 'after photo.png',                        key: 'after_shingle',    maxWidth: 1600, quality: 80 },
  { src: 'metal roof.png',                         key: 'after_metal',      maxWidth: 1600, quality: 80 },
  { src: 'gutters.png',                            key: 'after_gutters',    maxWidth: 1600, quality: 80 },
  { src: 'siding.png',                             key: 'siding_closeup',   maxWidth: 1600, quality: 80 },
  { src: 'Overview diagram.png',                   key: 'envelope_diagram', maxWidth: 1800, quality: 85 },
  { src: 'complete exterior system.png',           key: 'complete_system',  maxWidth: 1800, quality: 85 },
  { src: 'Certainteed Cedar Imitation Siding.png', key: 'cedar_shake',      maxWidth: 1800, quality: 85 }
];

const uploaded = {};
let totalBefore = 0, totalAfter = 0;
for (const f of FILES) {
  const path = resolve(FOLDER, f.src);
  try { statSync(path); } catch { console.log(`  SKIP ${f.src} (not found)`); continue; }
  const before = statSync(path).size;
  totalBefore += before;
  const buf = await sharp(path)
    .resize({ width: f.maxWidth, withoutEnlargement: true })
    .webp({ quality: f.quality })
    .toBuffer();
  totalAfter += buf.length;
  const blobPath = `tenants/${TENANT_SLUG}/estimates/${ESTIMATE_ID}/envelope-v2/${Date.now()}-${f.key}.webp`;
  console.log(`  ${f.src.padEnd(40)} ${(before/1024).toFixed(0).padStart(5)}KB → ${(buf.length/1024).toFixed(0).padStart(4)}KB (${Math.round(100-buf.length/before*100)}% smaller)`);
  const blob = await put(blobPath, buf, { access: 'public', contentType: 'image/webp', token: BLOB_TOKEN });
  uploaded[f.key] = blob.url;
}

console.log(`\nTotal: ${(totalBefore/1024/1024).toFixed(1)} MB → ${(totalAfter/1024/1024).toFixed(2)} MB (${Math.round(100-totalAfter/totalBefore*100)}% reduction)\n`);
console.log('Uploaded URLs:\n', JSON.stringify(uploaded, null, 2));
