// One-shot: remove neon-green chroma key from sprite PNGs and write
// transparent versions in the same folder with -t suffix. Uses sharp's
// raw pixel access to test each pixel against a green-dominance rule
// (G high, R+B low) so we don't accidentally erase greens inside the
// character (eye highlights, AJ's green-trim outfit, etc).
//
// Usage:
//   node scripts/chroma-key-sprites.mjs public/assets/rpg/sprites/crew

import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/chroma-key-sprites.mjs <dir>'); process.exit(1); }

// Tight rule: pixel is "chroma" only if G is dominant AND much larger
// than R and B (the chroma background was prompted as pure #00FF00).
// Anything with significant red or blue is preserved.
function isChroma(r, g, b) {
  return g > 180 && r < 110 && b < 110 && (g - r) > 60 && (g - b) > 60;
}

const files = (await readdir(dir)).filter(f => f.endsWith('.png') && !f.endsWith('-t.png'));
for (const f of files) {
  const src = join(dir, f);
  const dst = join(dir, basename(f, extname(f)) + '-t.png');
  const img = sharp(src).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  let killed = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (isChroma(out[i], out[i+1], out[i+2])) { out[i+3] = 0; killed++; }
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(dst);
  console.log(`${f} -> ${basename(dst)} (${killed} pixels keyed)`);
}
console.log('done');
