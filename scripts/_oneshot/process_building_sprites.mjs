// One-shot: alpha-key the white background out of each individual building
// PNG (downloaded from Higgsfield) and crop tight to the building bbox.
// Outputs are written to public/assets/rpg/sprites/buildings/<id>.png.
// Run: node scripts/_oneshot/process_building_sprites.mjs

import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';

const TMPDIR = path.resolve('./_tmp_buildings');
const OUTDIR = path.resolve('public/assets/rpg/sprites/buildings');
await fs.mkdir(OUTDIR, { recursive: true });

const IDS = ['hq','sales','finance','admin','production','service','customer','marketing'];

async function processOne(id) {
  const src = path.join(TMPDIR, id + '.png');
  const buf = await fs.readFile(src);
  // 1) Alpha-key white pixels
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const j = (y * width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const a = (channels === 4) ? data[i+3] : 255;
      if (r >= 245 && g >= 245 && b >= 245) {
        out[j] = 0; out[j+1] = 0; out[j+2] = 0; out[j+3] = 0;
      } else {
        out[j] = r; out[j+1] = g; out[j+2] = b; out[j+3] = a;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // 2) Tight bbox crop with 12px padding so anti-aliasing at edges survives
  const pad = 12;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.min(width - cropX, (maxX - minX) + pad * 2);
  const cropH = Math.min(height - cropY, (maxY - minY) + pad * 2);
  const baseAlpha = await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
    .png()
    .toBuffer();
  // 3) Resize down to a reasonable web-friendly size (~512px on longest side)
  const final = await sharp(baseAlpha)
    .resize({ width: 512, height: 512, fit: 'inside', kernel: 'nearest' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(path.join(OUTDIR, id + '.png'), final);
  const meta = await sharp(final).metadata();
  console.log(`✓ ${id}.png  (${meta.width}x${meta.height}, ${final.length} bytes)`);
}

for (const id of IDS) await processOne(id);
console.log('Done.');
