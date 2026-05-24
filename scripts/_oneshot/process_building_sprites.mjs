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
  // 1) Chroma-key: sample the 4 corners, find the dominant background
  //    color, then alpha-key any pixel within COLOR_TOL of it. This
  //    handles Higgsfield outputs that ignored the "white background"
  //    prompt and gave us grey, beige, or pastel backgrounds instead.
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // Sample the four corners — most likely all background
  const samplePix = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i+1], data[i+2]];
  };
  const corners = [
    samplePix(2, 2),
    samplePix(width - 3, 2),
    samplePix(2, height - 3),
    samplePix(width - 3, height - 3),
  ];
  // Average the corner colors as the background key
  const bg = [0, 0, 0];
  corners.forEach(c => { bg[0] += c[0]; bg[1] += c[1]; bg[2] += c[2]; });
  bg[0] = Math.round(bg[0] / 4); bg[1] = Math.round(bg[1] / 4); bg[2] = Math.round(bg[2] / 4);
  const COLOR_TOL = 22;  // Manhattan-ish distance; building shadows survive
  console.log(`  [${id}] bg key = rgb(${bg[0]},${bg[1]},${bg[2]})`);
  const out = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const j = (y * width + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const a = (channels === 4) ? data[i+3] : 255;
      const dr = Math.abs(r - bg[0]), dg = Math.abs(g - bg[1]), db = Math.abs(b - bg[2]);
      // Also catch pure white (>=245) explicitly in case the corner sample
      // happened to land on a building edge for some weird crop.
      const isBg = (dr < COLOR_TOL && dg < COLOR_TOL && db < COLOR_TOL) ||
                   (r >= 245 && g >= 245 && b >= 245);
      if (isBg) {
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
