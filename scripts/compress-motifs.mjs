// One-shot motif compression. Reads PNGs from public/assets/motifs/,
// writes optimized WebP siblings, leaves PNGs in place as source masters.
// Run via: npx -y -p sharp node scripts/compress-motifs.mjs

import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const motifs = resolve(__dirname, '..', 'public', 'assets', 'motifs');

const targets = [
  { in: 'birchbark-tile.png',     out: 'birchbark-tile.webp',     width: 600,  quality: 80 },
  { in: 'double-curve-sheet.png', out: 'double-curve-sheet.webp', width: 1024, quality: 85 },
  { in: 'beadwork-divider.png',   out: 'beadwork-divider.webp',   width: 1920, quality: 80 },
  { in: 'hero-banner.png',        out: 'hero-banner.webp',        width: 1920, quality: 78 },
  { in: 'corner-ornaments.png',   out: 'corner-ornaments.webp',   width: 1024, quality: 85 }
];

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

let totalIn = 0;
let totalOut = 0;

for (const t of targets) {
  const inPath = resolve(motifs, t.in);
  const outPath = resolve(motifs, t.out);

  const inBuf = await readFile(inPath);
  const inSize = inBuf.byteLength;
  totalIn += inSize;

  const outBuf = await sharp(inBuf)
    .resize({ width: t.width, withoutEnlargement: true })
    .webp({ quality: t.quality, effort: 6 })
    .toBuffer();

  await writeFile(outPath, outBuf);
  const outSize = outBuf.byteLength;
  totalOut += outSize;

  const ratio = ((1 - outSize / inSize) * 100).toFixed(1);
  console.log(`${t.in.padEnd(28)} ${fmt(inSize).padStart(9)} -> ${fmt(outSize).padStart(8)}  (${ratio}% smaller)`);
}

console.log('-'.repeat(70));
console.log(`${'TOTAL'.padEnd(28)} ${fmt(totalIn).padStart(9)} -> ${fmt(totalOut).padStart(8)}  (${((1 - totalOut / totalIn) * 100).toFixed(1)}% smaller)`);
