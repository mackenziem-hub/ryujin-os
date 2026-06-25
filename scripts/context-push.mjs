// context-push.mjs — SAVE-side writer for the cross-machine context spine.
//
// Writes ONE record at a time through the app endpoint api/context-store.js using
// RYUJIN_SERVICE_TOKEN + x-tenant-id (the classifier-permitted per-record path;
// direct Supabase inserts are classifier-blocked). Append-only session rows mean
// two machines saving concurrently become two rows, never an OneDrive fork.
//
// Usage (same env as load-scan):
//   node --env-file=.env.local scripts/context-push.mjs session [path-to-entry.md]
//       no path -> posts the first block of SESSION_CONTEXT.md (the entry just authored)
//   node --env-file=.env.local scripts/context-push.mjs principle <slug> [<slug> ...]
//   node --env-file=.env.local scripts/context-push.mjs principle --all   (backfill every genuine-prefix file)
//   node --env-file=.env.local scripts/context-push.mjs memory             (push MEMORY.md verbatim as the _memory_index row)
//
// Exit code is NON-ZERO on a real push failure (missing token / POST / network) so a
// silently-failed SAVE is detectable before the next LOAD rebuilds from rows. Genuine
// no-ops and usage errors exit 0.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function clean(v) {
  return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
}

const SVC = clean(process.env.RYUJIN_SERVICE_TOKEN);
const APP = clean(process.env.RYUJIN_APP_URL) || 'https://ryujin-os.vercel.app';
const TENANT = clean(process.env.RYUJIN_TENANT) || 'plus-ultra';
const MACHINE = os.hostname();
const TERMINAL = clean(process.env.RYUJIN_DESK) || null;

const CANON = 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory';
const SESSION_FILE = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/SESSION_CONTEXT.md';

if (!SVC) {
  console.error('[FAIL] context_store: missing RYUJIN_SERVICE_TOKEN — cannot push (run with --env-file=.env.local). Local files unchanged.');
  process.exit(1);
}

const MEMORY_INDEX_SLUG = '_memory_index';

async function post(qs, payload) {
  const r = await fetch(`${APP}/api/context-store?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SVC}`, 'x-tenant-id': TENANT },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`POST ${qs} -> ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : {};
}

function pad(n) { return String(n).padStart(2, '0'); }
function entryKey() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}-${MACHINE}-${rand}`;
}

// first markdown block of SESSION_CONTEXT.md: skip the DERIVED header comment, take
// everything up to the first '---' separator, and drop any '> saved-from:' footer.
function firstBlock(text) {
  // CRLF-safe: OneDrive sync / a Windows editor / git autocrlf can flip the file to
  // CRLF; without this the '\n---\n' separator never matches and we would post the
  // ENTIRE history as one row every save.
  let t = String(text).replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\s*/, '');
  const sep = t.indexOf('\n---\n');
  if (sep !== -1) t = t.slice(0, sep);
  return t.replace(/\n>\s*saved-from:[^\n]*\n?/g, '\n').trim();
}
function titleFrom(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim().slice(0, 200) : null;
}
function kindFrom(slug) {
  const m = slug.match(/^(feedback|reference|project|user)_/);
  return m ? m[1] : 'reference';
}
function principleTitle(body, slug) {
  const fm = body.match(/^name:\s*(.+)$/m);
  if (fm) return fm[1].trim().slice(0, 200);
  return titleFrom(body) || slug;
}

async function pushSession(arg) {
  let body;
  if (arg && fs.existsSync(arg)) body = fs.readFileSync(arg, 'utf8').replace(/\r\n/g, '\n');
  else if (fs.existsSync(SESSION_FILE)) body = firstBlock(fs.readFileSync(SESSION_FILE, 'utf8'));
  if (!body || !body.trim()) { console.error('[FAIL] context_store: no session entry text found to push.'); process.exit(0); }
  const key = entryKey();
  const out = await post('kind=session', { entry_key: key, machine: MACHINE, terminal: TERMINAL, title: titleFrom(body), body });
  console.log(`context-push session OK — entry ${out.entry_key || key} (machine ${MACHINE}).`);
}

// MEMORY.md is hand-curated (preamble, theme grouping, hooks). It travels verbatim
// as a single kind='meta' row so context-pull restores it byte-for-byte, never
// lossily regenerating it from topic rows.
async function pushMemory() {
  const fp = path.join(CANON, 'MEMORY.md');
  if (!fs.existsSync(fp)) { console.error('[FAIL] context_store: MEMORY.md not found.'); process.exit(1); }
  const body = fs.readFileSync(fp, 'utf8');
  await post('kind=principle', { slug: MEMORY_INDEX_SLUG, kind: 'meta', title: 'MEMORY.md index', body, source_machine: MACHINE });
  console.log(`context-push memory OK — MEMORY.md (${body.length} bytes) carried as the _memory_index row (machine ${MACHINE}).`);
}

async function pushPrinciples(slugs) {
  if (slugs.length === 1 && slugs[0] === '--all') {
    slugs = fs.readdirSync(CANON)
      .filter((n) => /^(feedback|reference|project|user)_.+\.md$/.test(n) && !/\.from-/.test(n))
      .map((n) => n.replace(/\.md$/, ''));
  }
  let ok = 0, fail = 0;
  for (const slug of slugs) {
    const fp = path.join(CANON, `${slug}.md`);
    if (!fs.existsSync(fp)) { console.error(`  [skip] ${slug}: file not found`); fail++; continue; }
    const body = fs.readFileSync(fp, 'utf8');
    try {
      await post('kind=principle', { slug, kind: kindFrom(slug), title: principleTitle(body, slug), body, source_machine: MACHINE });
      ok++;
      if (ok % 50 === 0) console.log(`  …${ok} pushed`);
    } catch (e) { console.error(`  [FAIL] ${slug}: ${e.message}`); fail++; }
  }
  console.log(`context-push principles OK — ${ok} upserted, ${fail} failed (machine ${MACHINE}).`);
  if (fail) process.exitCode = 1; // a partial backfill must be detectable
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'session') await pushSession(rest[0]);
  else if (cmd === 'memory') await pushMemory();
  else if (cmd === 'principle' || cmd === 'principles') {
    if (!rest.length) { console.error('usage: context-push.mjs principle <slug> [<slug> ...] | --all'); process.exit(0); }
    await pushPrinciples(rest);
  } else {
    console.error('usage: context-push.mjs session [file] | principle <slug...|--all> | memory');
    process.exit(0);
  }
}

// non-zero exit on a real push/network failure so a silently-failed SAVE is detectable
main().catch((e) => { console.error(`[FAIL] context_store: ${e.message}`); process.exit(1); });
