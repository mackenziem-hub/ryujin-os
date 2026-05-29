// Build the calendar icon set: source-of-truth JSON + an SVG <symbol> sprite.
//
// The icons were designed + adversarially verified by the calendar-asset-kit
// workflow. This tool turns that output into committed assets the calendar
// pages consume, and can rebuild the sprite from the JSON any time.
//
// First run (seed JSON from a workflow output file, then build sprite):
//   node scripts/build-calendar-iconset.mjs <workflow-output.json>
// Rebuild sprite from the committed JSON (no arg):
//   node scripts/build-calendar-iconset.mjs
//
// Writes:
//   public/assets/icons/calendar-icons.json  (source of truth: { name: "<svg>...</svg>" })
//   public/assets/icons/calendar-icons.svg   (hidden <symbol> sprite, ids "cal-<name>")

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const ICON_DIR = 'public/assets/icons';
const JSON_PATH = `${ICON_DIR}/calendar-icons.json`;
const SPRITE_PATH = `${ICON_DIR}/calendar-icons.svg`;

mkdirSync(ICON_DIR, { recursive: true });

const srcArg = process.argv[2];
let iconMap;

if (srcArg) {
  // Seed the JSON from a workflow output file.
  const raw = JSON.parse(readFileSync(srcArg, 'utf8'));
  const groups = raw.result?.icons || raw.icons || [];
  iconMap = {};
  for (const g of groups) for (const ic of (g.icons || [])) iconMap[ic.name] = ic.svg;
  writeFileSync(JSON_PATH, JSON.stringify(iconMap, null, 2) + '\n');
  console.log(`Seeded ${Object.keys(iconMap).length} icons -> ${JSON_PATH}`);
} else {
  iconMap = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
}

// Convert each standalone <svg ...>INNER</svg> into a <symbol id="cal-NAME">.
function innerOf(svg) {
  return String(svg).replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
}

const symbols = Object.entries(iconMap).map(([name, svg]) =>
  `  <symbol id="cal-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${innerOf(svg)}</symbol>`
).join('\n');

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true" data-iconset="ryujin-calendar">\n${symbols}\n</svg>\n`;
writeFileSync(SPRITE_PATH, sprite);
console.log(`Wrote sprite (${Object.keys(iconMap).length} symbols) -> ${SPRITE_PATH}`);
