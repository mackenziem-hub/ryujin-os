// Soul Cast returns a 3-panel composition (front body / back body / bust
// close-up) at 2048×1152. We want just the right-panel bust as a square
// avatar for the mobile portal AI Assistant strip.
//
// Each panel is roughly 683×1152. Extract the right panel, then resize
// with fit:cover to 1024×1024 (the slight scale-up + center-crop keeps
// the face filling the avatar circle cleanly).
//
// Also resizes the dragon mark to a clean 512×512 logo asset.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('public/assets/archetypes');

const PORTRAITS = [
  { input: '_raw_portrait_a.png', output: 'sage-bust.png',      label: 'Sage / HQ — female marble bust' },
  { input: '_raw_portrait_b.png', output: 'sovereign-bust.png', label: 'Sovereign / Hero — male marble bust' },
  { input: '_raw_portrait_c.png', output: 'caregiver-bust.png', label: 'Caregiver / Service — female marble bust' },
];

const PANEL_X_START = 1365;
const PANEL_WIDTH   = 683;
const PANEL_HEIGHT  = 1152;
const OUT_SIZE      = 1024;

for (const p of PORTRAITS) {
  const inputPath = path.join(ROOT, p.input);
  const outputPath = path.join(ROOT, p.output);
  await sharp(inputPath)
    .extract({ left: PANEL_X_START, top: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT })
    .resize(OUT_SIZE, OUT_SIZE, { fit: 'cover', position: sharp.position.center })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  const { size } = fs.statSync(outputPath);
  console.log(`✓ ${p.output.padEnd(28)} ${OUT_SIZE}×${OUT_SIZE}  ${(size/1024).toFixed(0)} KB  (${p.label})`);
}

// Dragon mark — already 1:1 but huge (6.9MB at 2048×2048). Shrink for fast loads.
const dragonOut = path.join(ROOT, 'ryujin-dragon.png');
await sharp(path.join(ROOT, '_raw_dragon.png'))
  .resize(512, 512, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toFile(dragonOut);
console.log(`✓ ryujin-dragon.png             512×512  ${(fs.statSync(dragonOut).size/1024).toFixed(0)} KB`);
