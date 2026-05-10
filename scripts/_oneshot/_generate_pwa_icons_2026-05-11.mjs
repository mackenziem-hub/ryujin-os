// One-shot: render the Ryujin "R" mark to square PNGs at the sizes
// PWA install + iOS apple-touch-icon need. Run once; commit the
// generated files.
//
//   - public/apple-touch-icon.png        (180×180, iOS home screen)
//   - public/assets/logo/icon.png        (512×512, manifest reference)
//   - public/assets/logo/icon-192.png    (192×192, manifest fallback)
//
// Mark design: dark navy rounded-square outer + radial purple inner
// + cyan→purple gradient "R" wordmark. Matches the inline-SVG icons
// already in /public/manifest.json so the home-screen icon and the
// in-tab favicon read as the same brand.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SVG = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="35%" cy="30%">
      <stop offset="0%" stop-color="#dcc8ff"/>
      <stop offset="40%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#0a0519"/>
    </radialGradient>
    <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e0f4ff"/>
      <stop offset="55%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="#060a14"/>
  <rect x="60" y="60" width="392" height="392" rx="90" fill="url(#bg)" opacity="0.92"/>
  <text x="256" y="358" text-anchor="middle"
        font-family="Arial Black, Helvetica, sans-serif"
        font-weight="900" font-size="280"
        fill="url(#rg)">R</text>
</svg>`;

const ROOT = path.resolve('.');
const TARGETS = [
  { out: 'public/apple-touch-icon.png', size: 180 },
  { out: 'public/assets/logo/icon.png', size: 512 },
  { out: 'public/assets/logo/icon-192.png', size: 192 },
];

for (const t of TARGETS) {
  const dest = path.join(ROOT, t.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(Buffer.from(SVG(t.size)))
    .resize(t.size, t.size)
    .png({ compressionLevel: 9 })
    .toFile(dest);
  const bytes = fs.statSync(dest).size;
  console.log(`✓ ${t.out.padEnd(40)} ${t.size}×${t.size}  ${bytes.toLocaleString()} bytes`);
}

console.log('\nDone. Commit the three PNGs + the manifest/portal updates.');
