// context-pull.mjs — LOAD-side materializer for the cross-machine context spine.
//
// Reads the canonical rows from Supabase (direct REST with the service key, exactly
// like load-scan.mjs — reads are not classifier-blocked) and rebuilds the local
// files Claude auto-loads:
//   - SESSION_CONTEXT.md   <- newest session_entries rows (DERIVED, fork-proof)
//   - ~/.claude/.../memory/<slug>.md  <- context_principles rows (absent-or-newer only)
//   - MEMORY.md            <- the verbatim curated index, carried as a kind='meta'
//                             slug='_memory_index' row (NOT lossily regenerated)
//
// SAFE: never wipes a local file when the DB returns empty/errors; backs up before
// every overwrite; writes atomically (tmp + rename); skips empty/whitespace rows;
// will NOT clobber SESSION_CONTEXT.md if the local newest block was never pushed
// (unpushed divergence -> sidecar + LOUD warn); never rewrites MEMORY.md unless a
// real _memory_index row exists. Fails LOUD as [FAIL] context_store so LOAD surfaces
// a CONNECTOR GAP and keeps the existing local/OneDrive copy. Run like load-scan:
//   node --env-file=.env.local scripts/context-pull.mjs [tenant_slug]

import fs from 'node:fs';
import path from 'node:path';

function clean(v) {
  return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
}

const SUPA = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const TENANT = process.argv[2] || 'plus-ultra';

// Portable paths: derive from two env vars (set per machine in .env.local),
// falling back to the original Owner/Plus-Ultra paths so existing machines stay
// byte-for-byte unchanged. A new machine (e.g. Cat's) sets RYUJIN_MEMORY_DIR +
// RYUJIN_BRAIN_DIR and the spine materializes there. See docs/MACHINE_SETUP.md.
function dir(v, fallback) {
  return (clean(v) || fallback).replace(/\\/g, '/').replace(/\/+$/, '');
}
const MEMORY_DIR = dir(process.env.RYUJIN_MEMORY_DIR, 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory');
const BRAIN_DIR = dir(process.env.RYUJIN_BRAIN_DIR, 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain');
const CANON = MEMORY_DIR;
const SESSION_FILE = `${BRAIN_DIR}/SESSION_CONTEXT.md`;
const SESSION_SIDECAR = `${BRAIN_DIR}/SESSION_CONTEXT.pulled.md`;
const SESSION_BACKUP_DIR = `${BRAIN_DIR}/_archive/session-context`;
const MEM_BACKUP_ROOT = path.join(MEMORY_DIR, '..', 'memory_backups');
const MEMORY_INDEX_SLUG = '_memory_index';
const DERIVED_HEADER = '<!-- DERIVED — rebuilt from Supabase (context-pull) at LOAD. Do not hand-edit; author via SAVE/context-push so changes land as rows and propagate cross-machine. -->';

if (!SUPA || !KEY) {
  console.error('[FAIL] context_store: missing SUPABASE_URL or SUPABASE_SERVICE_KEY — CONNECTOR GAP (kept local copy). Run: node --env-file=.env.local scripts/context-pull.mjs');
  process.exit(0);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(p) {
  const r = await fetch(`${SUPA}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return r.json();
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

// atomic write: never leaves a half-written/truncated file if the process dies mid-write
function atomicWrite(fp, content) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const tmp = `${fp}.tmp-${stamp}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, fp);
}

// the just-authored top block of a SESSION_CONTEXT-style file: CRLF-safe, drops the
// DERIVED header comment, slices at the first '---' separator, strips saved-from footer
function firstBlock(text) {
  let t = String(text).replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\s*/, '');
  const sep = t.indexOf('\n---\n');
  if (sep !== -1) t = t.slice(0, sep);
  return t.replace(/\n>\s*saved-from:[^\n]*\n?/g, '\n').trim();
}

async function main() {
  // resolve tenant
  let tenantId;
  try {
    const t = await rest(`tenants?slug=eq.${encodeURIComponent(TENANT)}&select=id&limit=1`);
    tenantId = Array.isArray(t) && t[0] ? t[0].id : null;
    if (!tenantId) throw new Error(`tenant "${TENANT}" not found`);
  } catch (e) {
    console.error(`[FAIL] context_store: tenant resolve — ${e.message} — CONNECTOR GAP (kept local copy).`);
    process.exit(0);
  }

  let sessionN = 0, wrote = 0, skipped = 0, memWritten = false;

  // ── 1) SESSION_CONTEXT.md from newest session_entries ──
  try {
    const rows = await rest(`session_entries?tenant_id=eq.${tenantId}&select=entry_key,machine,terminal,title,body,created_at&order=created_at.desc&limit=25`);
    if (Array.isArray(rows) && rows.length) {
      const blocks = rows.map((r) => {
        const when = (r.created_at || '').slice(0, 16).replace('T', ' ');
        return `${(r.body || '').trim()}\n\n> saved-from: ${r.machine || '?'}${r.terminal ? '/' + r.terminal : ''} @ ${when} (entry ${r.entry_key})`;
      });
      const rebuilt = `${DERIVED_HEADER}\n\n` + blocks.join('\n\n---\n\n') + '\n';

      // unpushed-divergence guard: if the local newest block is NOT among the fetched
      // rows, a SAVE push must have failed silently — do NOT clobber the local work.
      let diverged = false;
      if (fs.existsSync(SESSION_FILE)) {
        const localFirst = firstBlock(fs.readFileSync(SESSION_FILE, 'utf8'));
        if (localFirst && !rows.some((r) => firstBlock(r.body) === localFirst)) diverged = true;
      }

      if (diverged) {
        atomicWrite(SESSION_SIDECAR, rebuilt);
        console.error('[FAIL] context_store: local SESSION_CONTEXT.md has an UNPUSHED newest session (a SAVE push likely failed) — CONNECTOR GAP. Wrote the DB version to SESSION_CONTEXT.pulled.md and KEPT your local file. Merge + re-push before trusting the rebuild.');
      } else {
        if (fs.existsSync(SESSION_FILE)) {
          fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
          fs.copyFileSync(SESSION_FILE, path.join(SESSION_BACKUP_DIR, `SESSION_CONTEXT_pre-pull_${stamp}.md`));
        }
        atomicWrite(SESSION_FILE, rebuilt);
        sessionN = rows.length;
      }
    } else {
      console.warn('[warn] context_store: 0 session_entries rows — keeping local SESSION_CONTEXT.md (not rebuilt). Backfill the table to enable.');
    }
  } catch (e) {
    console.error(`[FAIL] context_store: session_entries — ${e.message} — CONNECTOR GAP (kept local SESSION_CONTEXT.md).`);
  }

  // ── 2) durable principles -> ~/.claude topic files (absent-or-newer) + MEMORY.md (verbatim row) ──
  try {
    const rows = await rest(`context_principles?tenant_id=eq.${tenantId}&is_active=eq.true&select=slug,kind,title,body,updated_at&order=updated_at.desc`);
    if (Array.isArray(rows) && rows.length) {
      const backupDir = path.join(MEM_BACKUP_ROOT, `pull_${stamp}`);
      let backupReady = false;
      const backupBeforeOverwrite = (fp) => {
        if (!fs.existsSync(fp)) return;
        if (!backupReady) { fs.mkdirSync(backupDir, { recursive: true }); backupReady = true; }
        fs.copyFileSync(fp, path.join(backupDir, path.basename(fp)));
      };

      for (const r of rows) {
        // MEMORY.md travels verbatim as a meta row — never lossily regenerated
        if (r.kind === 'meta' && r.slug === MEMORY_INDEX_SLUG) {
          if (!r.body || !r.body.trim()) continue;
          const memFile = path.join(CANON, 'MEMORY.md');
          backupBeforeOverwrite(memFile);
          atomicWrite(memFile, r.body.endsWith('\n') ? r.body : r.body + '\n');
          memWritten = true;
          continue;
        }
        if (r.kind === 'meta') continue; // other meta rows are not topic files
        if (!/^[a-z0-9_]+$/i.test(r.slug)) continue; // slug must be a safe bare filename (no path traversal)
        if (!r.body || !r.body.trim()) { // empty/whitespace row would blank a real file
          console.warn(`[warn] context_store: skipping ${r.slug} — empty/whitespace body row, kept local file.`);
          skipped++;
          continue;
        }
        const fp = path.join(CANON, `${r.slug}.md`);
        const rowMs = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        const localMs = fs.existsSync(fp) ? fs.statSync(fp).mtimeMs : 0;
        if (!fs.existsSync(fp) || rowMs > localMs + 2000) { // absent-or-newer; 2s margin avoids churn
          backupBeforeOverwrite(fp);
          atomicWrite(fp, r.body.trimEnd() + '\n');
          wrote++;
        } else {
          skipped++;
        }
      }
    } else {
      console.warn('[warn] context_store: 0 context_principles rows — keeping local memory + MEMORY.md (not rebuilt). Backfill the table to enable.');
    }
  } catch (e) {
    console.error(`[FAIL] context_store: context_principles — ${e.message} — CONNECTOR GAP (kept local memory).`);
  }

  console.log(`context-pull OK — session_entries: ${sessionN} rebuilt; principles: ${wrote} written, ${skipped} up-to-date/skipped; MEMORY.md: ${memWritten ? 'updated from row' : 'left local (no _memory_index row yet)'}.`);
}

main();
