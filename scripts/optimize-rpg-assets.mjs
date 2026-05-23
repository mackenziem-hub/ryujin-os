// Recursively converts public/assets/rpg/**/*.{png,jpg,jpeg} to .webp siblings.
// Resize max 1920x1080 (fit:inside, no enlargement), quality 80, effort 6.
// Idempotent: skips when .webp is newer than source.
//
// Flags:
//   --rewrite-html       patch public/game.html refs .png/.jpeg -> .webp
//   --delete-originals   unlink source files after successful convert
//   --dry-run            report only, no writes
//
// Usage:
//   node scripts/optimize-rpg-assets.mjs
//   node scripts/optimize-rpg-assets.mjs --rewrite-html --delete-originals

import sharp from 'sharp';
import { readFile, writeFile, stat, unlink, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const rpgRoot = resolve(repoRoot, 'public', 'assets', 'rpg');
const gameHtmlPath = resolve(repoRoot, 'public', 'game.html');

const args = new Set(process.argv.slice(2));
const REWRITE_HTML = args.has('--rewrite-html');
const DELETE_ORIGINALS = args.has('--delete-originals');
const DRY_RUN = args.has('--dry-run');

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const QUALITY = 80;
const EFFORT = 6;
const SOURCE_EXTS = new Set(['.png', '.jpg', '.jpeg']);

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else if (entry.isFile() && SOURCE_EXTS.has(extname(entry.name).toLowerCase())) out.push(p);
  }
  return out;
}

async function newerThan(a, b) {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    return sa.mtimeMs > sb.mtimeMs;
  } catch {
    return false;
  }
}

const sources = await walk(rpgRoot);
sources.sort();

let totalIn = 0;
let totalOut = 0;
let converted = 0;
let skipped = 0;
const deletions = [];

for (const src of sources) {
  const rel = relative(rpgRoot, src);
  const webp = src.slice(0, -extname(src).length) + '.webp';
  const srcStat = await stat(src);
  const srcSize = srcStat.size;

  const upToDate = await newerThan(webp, src);
  if (upToDate && !DRY_RUN) {
    const outSize = (await stat(webp)).size;
    totalIn += srcSize;
    totalOut += outSize;
    skipped++;
    console.log(`${rel.padEnd(52)} ${fmt(srcSize).padStart(9)} -> ${fmt(outSize).padStart(8)}  (cached)`);
    if (DELETE_ORIGINALS) deletions.push(src);
    continue;
  }

  let outSize;
  if (DRY_RUN) {
    outSize = 0;
  } else {
    const inBuf = await readFile(src);
    const outBuf = await sharp(inBuf)
      .rotate()
      .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: EFFORT })
      .toBuffer();
    await writeFile(webp, outBuf);
    outSize = outBuf.byteLength;
    if (DELETE_ORIGINALS) deletions.push(src);
  }

  totalIn += srcSize;
  totalOut += outSize;
  converted++;
  const ratio = outSize ? `${((1 - outSize / srcSize) * 100).toFixed(1)}% smaller` : 'dry-run';
  console.log(`${rel.padEnd(52)} ${fmt(srcSize).padStart(9)} -> ${fmt(outSize).padStart(8)}  (${ratio})`);
}

console.log('-'.repeat(90));
console.log(
  `${'TOTAL'.padEnd(52)} ${fmt(totalIn).padStart(9)} -> ${fmt(totalOut).padStart(8)}  ` +
  `(${totalIn ? ((1 - totalOut / totalIn) * 100).toFixed(1) : '0'}% smaller, ${converted} converted, ${skipped} cached)`
);

if (REWRITE_HTML) {
  const html = await readFile(gameHtmlPath, 'utf8');
  const refRe = /(\/assets\/rpg\/[^'"`\s]+?)\.(png|jpe?g)\b/gi;
  const changes = (html.match(refRe) || []).length;
  const patched = html.replace(refRe, '$1.webp');
  if (DRY_RUN) {
    console.log(`\n[dry-run] would rewrite ${changes} refs in public/game.html`);
  } else if (patched !== html) {
    await writeFile(gameHtmlPath, patched);
    console.log(`\nRewrote ${changes} asset refs in public/game.html`);
  } else {
    console.log(`\nNo asset refs needed rewriting in public/game.html`);
  }
}

if (DELETE_ORIGINALS && deletions.length) {
  if (DRY_RUN) {
    console.log(`\n[dry-run] would delete ${deletions.length} source files`);
  } else {
    for (const f of deletions) await unlink(f);
    console.log(`\nDeleted ${deletions.length} source files`);
  }
}
