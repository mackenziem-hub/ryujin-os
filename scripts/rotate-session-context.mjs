// rotate-session-context.mjs — bound SESSION_CONTEXT.md growth (audit P1: unbounded append).
// Keeps the most-recent entries up to a byte budget at the top (newest-first is preserved),
// moves older entries into a rolling archive, and writes a full pre-rotation backup so the
// operation is 100% reversible. No data is ever dropped: kept + archived == original entries.
//
// Usage:  node scripts/rotate-session-context.mjs [keepBytes]   (default 75000)
// Safe to re-run: if the file is already under budget it no-ops.

import fs from 'fs';
import path from 'path';

const SC = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/SESSION_CONTEXT.md';
const ARCH_DIR = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/_archive/session-context';
const ARCHIVE = path.join(ARCH_DIR, 'SESSION_CONTEXT_archive.md');
const KEEP_BYTES = Number(process.argv[2] || 75000);
const STAMP = process.argv[3] || 'unstamped'; // pass a date stamp in (no Date.now in restricted envs)

const raw = fs.readFileSync(SC, 'utf8');
const origBytes = Buffer.byteLength(raw);

// Split into entries on each "# Session Context" header (newest first in the file).
const parts = raw.split(/(?=^# Session Context)/m);
const preamble = parts[0] && !parts[0].startsWith('# Session Context') ? parts[0] : '';
const entries = parts.filter(p => p.startsWith('# Session Context'));
const origCount = entries.length;

if (origBytes <= KEEP_BYTES) {
  console.log(`No rotation needed: ${origBytes} bytes <= budget ${KEEP_BYTES}. ${origCount} entries.`);
  process.exit(0);
}

// Accumulate newest entries until the budget; the rest are archived.
const kept = [], archived = [];
let size = Buffer.byteLength(preamble), cut = false;
for (const e of entries) {
  const b = Buffer.byteLength(e);
  if (!cut && size + b <= KEEP_BYTES) { kept.push(e); size += b; }
  else { cut = true; archived.push(e); }
}
// Always keep at least the newest entry.
if (kept.length === 0 && entries.length) { kept.push(entries[0]); archived.shift(); }

if (!archived.length) {
  console.log(`No rotation: newest entry alone exceeds budget. ${origCount} entries, ${origBytes} bytes.`);
  process.exit(0);
}

fs.mkdirSync(ARCH_DIR, { recursive: true });

// 1) Full pre-rotation backup (belt and suspenders).
const backup = path.join(ARCH_DIR, `SESSION_CONTEXT_pre-rotation_${STAMP}.md`);
fs.writeFileSync(backup, raw, 'utf8');

// 2) Prepend newly-archived entries to the rolling archive (preserve newest-first).
const prevArchive = fs.existsSync(ARCHIVE) ? fs.readFileSync(ARCHIVE, 'utf8') : `# SESSION_CONTEXT archive (rotated older sessions, newest first)\n\n`;
const archiveHeader = `# SESSION_CONTEXT archive (rotated older sessions, newest first)\n\n`;
const prevBody = prevArchive.startsWith(archiveHeader) ? prevArchive.slice(archiveHeader.length) : prevArchive;
fs.writeFileSync(ARCHIVE, archiveHeader + archived.join('') + prevBody, 'utf8');

// 3) Rewrite SESSION_CONTEXT with the kept window + a footer pointer.
const footer = `\n---\n\n_Older sessions (${archived.length}) rotated to \`_archive/session-context/SESSION_CONTEXT_archive.md\` on ${STAMP} to bound this file. Full pre-rotation backup alongside it. Rotate again with \`scripts/rotate-session-context.mjs\`._\n`;
fs.writeFileSync(SC, preamble + kept.join('') + footer, 'utf8');

const newBytes = Buffer.byteLength(fs.readFileSync(SC, 'utf8'));
console.log(`Rotated SESSION_CONTEXT.md`);
console.log(`  entries: ${origCount} total -> kept ${kept.length}, archived ${archived.length}  (sum ${kept.length + archived.length} == ${origCount}: ${kept.length + archived.length === origCount})`);
console.log(`  bytes:   ${origBytes} -> ${newBytes}  (archive +${Buffer.byteLength(archived.join(''))})`);
console.log(`  backup:  ${backup}`);
console.log(`  archive: ${ARCHIVE}`);
