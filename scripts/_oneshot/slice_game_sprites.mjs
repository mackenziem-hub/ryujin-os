// One-shot: slice the Higgsfield building sheet + player sheet into
// individual PNGs with the white background removed (alpha-keyed).
//
// Source images came from Higgsfield on 2026-05-24 for the game.html
// classic-FF overworld pivot. The sheets are 2048x1536 (buildings)
// and 2048x2048 (player). Building sheet has 8 distinct exteriors in
// a ~3x3 layout (one cell empty). Player sheet has ~11 walk-cycle
// frames in a 4x3 layout (one cell empty).
//
// Run: node scripts/_oneshot/slice_game_sprites.mjs

import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';

const REPO = path.resolve('.');
const SPRITES = path.join(REPO, 'public/assets/rpg/sprites');

// Building cells — eyeball coords from the 2048x1536 sheet.
// Each entry: { id, left, top, width, height }
const BUILDINGS = [
  { id: 'HQ',         left: 100,  top: 50,   width: 600, height: 510 }, // gold throne hall
  { id: 'SALES',      left: 720,  top: 30,   width: 340, height: 540 }, // magenta messenger post
  { id: 'FINANCE',    left: 1060, top: 40,   width: 400, height: 530 }, // cyan vault
  { id: 'ADMIN',      left: 1470, top: 20,   width: 560, height: 1060 }, // violet wizard tower (tall)
  { id: 'PRODUCTION', left: 90,   top: 590,  width: 600, height: 510 }, // red forge with anvils
  { id: 'SERVICE',    left: 720,  top: 600,  width: 660, height: 500 }, // green hunter hut
  { id: 'CUSTOMER',   left: 100,  top: 1110, width: 600, height: 420 }, // red cottage
  { id: 'MARKETING',  left: 720,  top: 1170, width: 670, height: 360 }, // orange bell house
];

// Player walk-cycle cells — eyeball coords from the 2048x2048 sheet.
// 3 rows x 4 cols (one cell empty in row 1, several variant poses below).
// We'll just save 3 useful poses: facing-side, facing-back, mid-step.
const PLAYER_CELLS = [
  { id: 'side',    left: 60,   top: 30,   width: 460, height: 600 }, // leftmost side view
  { id: 'side2',   left: 540,  top: 30,   width: 460, height: 600 }, // next side pose
  { id: 'side3',   left: 1020, top: 30,   width: 460, height: 600 }, // 3/4 view with tool belt
  { id: 'back',    left: 1500, top: 30,   width: 460, height: 600 }, // back view (cap visible)
];

async function alphaKeyWhite(buf) {
  // Strip near-white pixels to transparent. Threshold high enough to keep
  // light gray shading on buildings, low enough to nuke the white bg.
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += channels, j += 4) {
    const r = data[i], g = data[i+1], b = data[i+2];
    const a = (channels === 4) ? data[i+3] : 255;
    // Pure-white-ish: all three channels >= 245 -> transparent
    if (r >= 245 && g >= 245 && b >= 245) {
      out[j] = 0; out[j+1] = 0; out[j+2] = 0; out[j+3] = 0;
    } else {
      out[j] = r; out[j+1] = g; out[j+2] = b; out[j+3] = a;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function sliceSheet(srcRel, cells, outSubdir) {
  const src = path.join(REPO, 'public/assets/rpg/sprites', srcRel);
  const buf = await fs.readFile(src);
  const outDir = path.join(SPRITES, outSubdir);
  await fs.mkdir(outDir, { recursive: true });
  for (const c of cells) {
    const cropped = await sharp(buf)
      .extract({ left: c.left, top: c.top, width: c.width, height: c.height })
      .png()
      .toBuffer();
    const keyed = await alphaKeyWhite(cropped);
    const outPath = path.join(outDir, c.id.toLowerCase() + '.png');
    await fs.writeFile(outPath, keyed);
    console.log(`✓ ${outSubdir}/${c.id.toLowerCase()}.png  (${c.width}x${c.height})`);
  }
}

console.log('Slicing buildings sheet…');
await sliceSheet('buildings-sheet.png', BUILDINGS, 'buildings');
console.log('Slicing player sheet…');
await sliceSheet('player-walk.png', PLAYER_CELLS, 'player');
console.log('Done.');
