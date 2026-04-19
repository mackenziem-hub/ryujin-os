// Upload local photos to Vercel Blob and emit a JSON map of {filename → url}.
//
// Usage:
//   1. Download the Plus Ultra photos you want to use from Drive into scripts/photos-to-upload/
//      Optional subfolders for categorization:
//        scripts/photos-to-upload/cover/...
//        scripts/photos-to-upload/before-after/before-1.jpg   (pairs: before-N.jpg + after-N.jpg)
//        scripts/photos-to-upload/gallery/...
//   2. Set your BLOB_READ_WRITE_TOKEN:
//        export BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxx          (bash)
//        $env:BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_xxxxx"        (PowerShell)
//   3. Run:  node scripts/upload-photos.js
//   4. Copy the emitted JSON into public/proposal-client.html → getProposalData fallback
//      (media.beforeImage, media.afterImage, media.gallery, customer.coverImage)
//
// Files already uploaded are skipped on re-run (we check for an identical pathname).

import { put, list } from '@vercel/blob';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'scripts/photos-to-upload');
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const BLOB_PREFIX = 'plus-ultra/photos';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Set BLOB_READ_WRITE_TOKEN before running. Get it from Vercel → Storage → your Blob store → .env.local tab.');
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (ALLOWED.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function categorize(relPath) {
  const parts = relPath.split(path.sep);
  const first = parts[0] || '';
  const name = path.basename(relPath, path.extname(relPath)).toLowerCase();
  if (first === 'cover') return { bucket: 'cover' };
  if (first === 'before-after') {
    const match = name.match(/^(before|after)[-_]?(\d+)?$/);
    if (match) return { bucket: 'beforeAfter', side: match[1], pair: match[2] || '1' };
    return { bucket: 'beforeAfter', side: 'unknown', pair: name };
  }
  if (first === 'gallery') return { bucket: 'gallery' };
  return { bucket: 'other' };
}

async function existing() {
  const map = new Map();
  let cursor;
  do {
    const res = await list({ prefix: BLOB_PREFIX + '/', cursor });
    for (const b of res.blobs) map.set(b.pathname, b.url);
    cursor = res.cursor;
  } while (cursor);
  return map;
}

async function main() {
  const files = await walk(ROOT);
  if (!files.length) {
    console.error(`No images found in ${ROOT}. Drop .jpg/.png files there first.`);
    process.exit(1);
  }
  const already = await existing();

  const result = { cover: [], beforeAfter: {}, gallery: [], other: [] };

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const key = `${BLOB_PREFIX}/${rel.replace(/\\/g, '/')}`;
    const cat = categorize(rel);

    let url;
    if (already.has(key)) {
      url = already.get(key);
      console.log(`skip (exists) ${rel}`);
    } else {
      const body = await readFile(file);
      const contentType = path.extname(file).toLowerCase() === '.png' ? 'image/png'
        : path.extname(file).toLowerCase() === '.webp' ? 'image/webp'
        : 'image/jpeg';
      const res = await put(key, body, { access: 'public', contentType, addRandomSuffix: false });
      url = res.url;
      const kb = (await stat(file)).size / 1024;
      console.log(`upload ${rel}  (${kb.toFixed(0)}KB) → ${url}`);
    }

    if (cat.bucket === 'cover') result.cover.push(url);
    else if (cat.bucket === 'beforeAfter') {
      result.beforeAfter[cat.pair] = result.beforeAfter[cat.pair] || {};
      result.beforeAfter[cat.pair][cat.side] = url;
    } else if (cat.bucket === 'gallery') result.gallery.push({ img: url, loc: '', desc: path.basename(rel) });
    else result.other.push({ img: url, rel });
  }

  console.log('\n=== PASTE INTO public/proposal-client.html (getProposalData fallback) ===\n');
  const paste = {
    coverImage: result.cover[0] || null,
    beforeImage: (result.beforeAfter['1'] || {}).before || null,
    afterImage:  (result.beforeAfter['1'] || {}).after  || null,
    gallery: result.gallery.length ? result.gallery : null,
    allBeforeAfterPairs: result.beforeAfter,
    otherUploads: result.other
  };
  console.log(JSON.stringify(paste, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
