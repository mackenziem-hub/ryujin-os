#!/usr/bin/env node
// One-shot: convert the new Mack sprite PNGs (front/back/side) into webp.
// Side sprite needs to face LEFT (the CSS uses scaleX(-1) to flip it for
// face-right). White background gets keyed out to transparent so the sprite
// composites cleanly on the dark overworld.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const SRC = 'C:/Users/Owner/Downloads';
const DST = 'C:/Users/Owner/Code/ryujin-os/public/assets/rpg/sprites/crew';

const jobs = [
  { src: 'mack_front_v2.png', dst: 'mack.webp',      flip: false },
  { src: 'mack_back_v2.png',  dst: 'mack-back.webp', flip: false },
  { src: 'mack_side_v2.png',  dst: 'mack-side.webp', flip: true  }, // generated facing right, CSS expects left
];

// White-to-alpha via pixel scan: anything whiter than threshold becomes
// transparent. Threshold 240 catches near-white anti-aliased edges too.
async function whiteToAlpha(srcPath, dstPath, flip) {
  let pipeline = sharp(srcPath).ensureAlpha();
  const raw = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const { data, info } = raw;
  const px = info.width * info.height;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    if (data[o] > 240 && data[o+1] > 240 && data[o+2] > 240) {
      data[o+3] = 0; // alpha = 0
    }
  }
  let img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  img = img.trim();                    // crop transparent edges
  if (flip) img = img.flop();          // mirror horizontally for side sprite
  img = img.resize({ width: 256, height: 256, fit: 'contain', background: { r:0, g:0, b:0, alpha: 0 } });
  await img.webp({ quality: 92 }).toFile(dstPath);
}

for (const { src, dst, flip } of jobs) {
  const srcPath = path.join(SRC, src);
  const dstPath = path.join(DST, dst);
  await whiteToAlpha(srcPath, dstPath, flip);
  console.log(`wrote: ${dst}${flip ? ' (flipped to face left)' : ''}`);
}

console.log('done.');
