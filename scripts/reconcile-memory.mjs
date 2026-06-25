// reconcile-memory.mjs — one-way, filtered, newer-wins merge of durable memory
// from the OneDrive-synced (but harness-IGNORED) `_brain/claude-memory` store
// into the local canonical store that THIS machine's Claude actually auto-loads.
//
// Why: the canonical read store (~/.claude/projects/C--Users-Owner/memory) is
// machine-local and syncs nowhere; fresh durable principles land in the synced
// `_brain/claude-memory` folder that the harness never reads. This bridges them
// so each machine's auto-loaded memory stops drifting. It is the ship-today
// quick win and the same filter/newer-wins logic context-pull.mjs reuses.
//
// SAFE BY DESIGN:
//   - backs up the ENTIRE canonical dir first (lossless, recoverable) before any write
//   - only ever copies GENUINE-PREFIX principle files (feedback_/reference_/project_/user_)
//   - excludes fork/index/parked files (MEMORY*, *-HAL*, *-Mind-Palace*, *-DESKTOP*, _v2, "(N)", _DEPRECATED*, *.from-*)
//   - a locally-newer file is NEVER overwritten
//   - a genuine same-slug conflict (differs, source NOT newer) is PARKED as
//     <slug>.from-claude-memory.md, never clobbered
//
// Usage (from C:/Users/Owner/Code/ryujin-os):
//   node scripts/reconcile-memory.mjs           # dry-run: prints what it WOULD do
//   node scripts/reconcile-memory.mjs --apply    # performs the backup + merge

import fs from 'node:fs';
import path from 'node:path';

const CANON = 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory';
const SRC = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/claude-memory';
const BACKUP_ROOT = 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory_backups';
const APPLY = process.argv.includes('--apply');

// --- filters -----------------------------------------------------------------
const GENUINE_PREFIX = /^(feedback|reference|project|user)_/;
// fork / index / parked / deprecated artifacts we must never pull
const EXCLUDE = [
  /^MEMORY/i,                 // index files (MEMORY.md, MEMORY-HAL.md, ...)
  /-HAL(\b|[-.])/i,           // OneDrive machine forks
  /-Mind-Palace/i,
  /-DESKTOP/i,
  /_v2(\b|[-.])/i,
  /\(\d+\)/,                  // "name (1).md" OneDrive copies
  /^_?DEPRECATED/i,
  /\.from-/i,                 // already-parked conflict siblings
];

function eligible(name) {
  if (!name.endsWith('.md')) return false;
  if (!GENUINE_PREFIX.test(name)) return false;
  if (EXCLUDE.some((re) => re.test(name))) return false;
  return true;
}

function readDirFiles(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { console.error(`[FATAL] cannot read ${dir}: ${e.message}`); process.exit(1); }
  return ents.filter((e) => e.isFile()).map((e) => e.name);
}

// --- gather ------------------------------------------------------------------
const srcFiles = readDirFiles(SRC).filter(eligible);
const canonFiles = new Set(readDirFiles(CANON));

const plan = { new: [], updated: [], identical: [], localNewer: [], parked: [] };

for (const name of srcFiles) {
  const sp = path.join(SRC, name);
  const cp = path.join(CANON, name);
  if (!canonFiles.has(name)) { plan.new.push(name); continue; }

  // present in both — compare content, then mtime
  let sBuf, cBuf;
  try { sBuf = fs.readFileSync(sp); cBuf = fs.readFileSync(cp); }
  catch { plan.parked.push(name); continue; }
  if (sBuf.equals(cBuf)) { plan.identical.push(name); continue; }

  const sM = fs.statSync(sp).mtimeMs;
  const cM = fs.statSync(cp).mtimeMs;
  // 2s margin so OneDrive sync-touch jitter doesn't flip ordering
  if (sM > cM + 2000) plan.updated.push(name);     // source strictly newer -> overwrite (backup protects)
  else if (cM > sM + 2000) plan.localNewer.push(name); // local strictly newer -> keep local, skip
  else plan.parked.push(name);                      // ambiguous -> park the incoming, never clobber
}

// --- report ------------------------------------------------------------------
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
console.log(`# reconcile-memory ${APPLY ? '(APPLY)' : '(dry-run)'} — ${stamp}`);
console.log(`source : ${SRC}`);
console.log(`canon  : ${CANON}\n`);
console.log(`eligible source files : ${srcFiles.length}`);
console.log(`  new (absent->copy)        : ${plan.new.length}`);
console.log(`  updated (src newer->copy) : ${plan.updated.length}`);
console.log(`  identical (skip)          : ${plan.identical.length}`);
console.log(`  local-newer (keep local)  : ${plan.localNewer.length}`);
console.log(`  parked (conflict sibling) : ${plan.parked.length}\n`);

if (!APPLY) {
  const sample = (arr) => arr.slice(0, 8).join(', ') + (arr.length > 8 ? ` … (+${arr.length - 8})` : '');
  if (plan.new.length) console.log(`NEW sample      : ${sample(plan.new)}`);
  if (plan.updated.length) console.log(`UPDATED sample  : ${sample(plan.updated)}`);
  if (plan.localNewer.length) console.log(`LOCAL-NEWER     : ${sample(plan.localNewer)}`);
  if (plan.parked.length) console.log(`PARKED sample   : ${sample(plan.parked)}`);
  console.log(`\nDry-run only. Re-run with --apply to back up + merge.`);
  process.exit(0);
}

// --- apply: backup first (lossless) ------------------------------------------
const backupDir = path.join(BACKUP_ROOT, `memory_${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
let backedUp = 0;
for (const name of readDirFiles(CANON)) {
  fs.copyFileSync(path.join(CANON, name), path.join(backupDir, name));
  backedUp++;
}
console.log(`backed up ${backedUp} canonical files -> ${backupDir}`);

// --- apply: copy / park ------------------------------------------------------
let copied = 0, parked = 0;
for (const name of [...plan.new, ...plan.updated]) {
  fs.copyFileSync(path.join(SRC, name), path.join(CANON, name));
  copied++;
}
for (const name of plan.parked) {
  const parkedName = name.replace(/\.md$/, '.from-claude-memory.md');
  fs.copyFileSync(path.join(SRC, name), path.join(CANON, parkedName));
  parked++;
}
console.log(`copied ${copied} files into canonical (${plan.new.length} new + ${plan.updated.length} updated)`);
console.log(`parked ${parked} conflict siblings (review the .from-claude-memory.md files)`);
console.log(`kept local on ${plan.localNewer.length} locally-newer files (never overwritten)`);
console.log(`\nDONE. Backup is fully reversible: copy ${backupDir}/* back over ${CANON} to undo.`);
