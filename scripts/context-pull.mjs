// context-pull.mjs — LOAD-side materializer for the cross-machine context spine.
//
// Reads the canonical rows from Supabase (direct REST with the service key, exactly
// like load-scan.mjs — reads are not classifier-blocked) and rebuilds the local
// files Claude auto-loads:
//   - SESSION_CONTEXT.md   <- newest session_entries rows (DERIVED, fork-proof)
//   - ~/.claude/.../memory/<slug>.md  <- context_principles rows (absent-or-newer only)
//   - MEMORY.md            <- regenerated index from the rows
//
// SAFE: never wipes local files when the DB returns empty/errors — it backs up
// before any rewrite, only writes topic files that are absent-or-newer, and fails
// LOUD as [FAIL] context_store so LOAD surfaces a CONNECTOR GAP and keeps the
// existing local/OneDrive copy. Run with the same env as load-scan:
//   node --env-file=.env.local scripts/context-pull.mjs [tenant_slug]

import fs from 'node:fs';
import path from 'node:path';

function clean(v) {
  return String(v || '').replace(/\r/g, '').trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim();
}

const SUPA = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
const KEY = clean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const TENANT = process.argv[2] || 'plus-ultra';

const CANON = 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory';
const SESSION_FILE = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/SESSION_CONTEXT.md';
const SESSION_BACKUP_DIR = 'C:/Users/Owner/OneDrive/Desktop/Plus Ultra/_brain/_archive/session-context';
const MEM_BACKUP_DIR = 'C:/Users/Owner/.claude/projects/C--Users-Owner/memory_backups';
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

  let sessionN = 0, wrote = 0, skipped = 0;

  // ── 1) SESSION_CONTEXT.md from newest session_entries ──
  try {
    const rows = await rest(`session_entries?tenant_id=eq.${tenantId}&select=entry_key,machine,terminal,title,body,created_at&order=created_at.desc&limit=25`);
    if (Array.isArray(rows) && rows.length) {
      const blocks = rows.map((r) => {
        const when = (r.created_at || '').slice(0, 16).replace('T', ' ');
        return `${(r.body || '').trim()}\n\n> saved-from: ${r.machine || '?'}${r.terminal ? '/' + r.terminal : ''} @ ${when} (entry ${r.entry_key})`;
      });
      const rebuilt = `${DERIVED_HEADER}\n\n` + blocks.join('\n\n---\n\n') + '\n';
      // lossless backup of the existing file before overwriting
      if (fs.existsSync(SESSION_FILE)) {
        fs.mkdirSync(SESSION_BACKUP_DIR, { recursive: true });
        fs.copyFileSync(SESSION_FILE, path.join(SESSION_BACKUP_DIR, `SESSION_CONTEXT_pre-pull_${stamp}.md`));
      }
      fs.writeFileSync(SESSION_FILE, rebuilt);
      sessionN = rows.length;
    } else {
      console.warn('[warn] context_store: 0 session_entries rows — keeping local SESSION_CONTEXT.md (not rebuilt). Backfill the table to enable.');
    }
  } catch (e) {
    console.error(`[FAIL] context_store: session_entries — ${e.message} — CONNECTOR GAP (kept local SESSION_CONTEXT.md).`);
  }

  // ── 2) durable principles -> ~/.claude topic files (absent-or-newer) + MEMORY.md ──
  try {
    const rows = await rest(`context_principles?tenant_id=eq.${tenantId}&is_active=eq.true&select=slug,kind,title,body,updated_at&order=updated_at.desc`);
    if (Array.isArray(rows) && rows.length) {
      const indexRows = [];
      let preamble = null;
      for (const r of rows) {
        if (r.kind === 'meta' && r.slug === '_memory_index_preamble') { preamble = r.body; continue; }
        if (!/^[a-z0-9_]+$/i.test(r.slug)) { continue; } // guard: slug is a safe filename
        const fp = path.join(CANON, `${r.slug}.md`);
        const rowMs = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        const localMs = fs.existsSync(fp) ? fs.statSync(fp).mtimeMs : 0;
        // absent-or-newer; a 2s margin avoids churn on equal timestamps
        if (!fs.existsSync(fp) || rowMs > localMs + 2000) {
          fs.writeFileSync(fp, (r.body || '').trimEnd() + '\n');
          wrote++;
        } else {
          skipped++;
        }
        const hook = firstHook(r.body);
        indexRows.push(`- [${r.title || r.slug}](${r.slug}.md) — ${hook}`);
      }
      // regenerate MEMORY.md (preamble row if present, else keep a minimal header). Back up first.
      const memFile = path.join(CANON, 'MEMORY.md');
      if (fs.existsSync(memFile)) {
        fs.mkdirSync(MEM_BACKUP_DIR, { recursive: true });
        fs.copyFileSync(memFile, path.join(MEM_BACKUP_DIR, `MEMORY_pre-pull_${stamp}.md`));
      }
      const header = preamble ? preamble.trimEnd() : '# Memory index\n\n> Durable principles, regenerated from Supabase context_principles at LOAD.';
      fs.writeFileSync(memFile, `${header}\n\n${indexRows.join('\n')}\n`);
    } else {
      console.warn('[warn] context_store: 0 context_principles rows — keeping local memory + MEMORY.md (not rebuilt). Backfill the table to enable.');
    }
  } catch (e) {
    console.error(`[FAIL] context_store: context_principles — ${e.message} — CONNECTOR GAP (kept local memory).`);
  }

  console.log(`context-pull OK — session_entries: ${sessionN} rebuilt; principles: ${wrote} written, ${skipped} up-to-date.`);
}

function firstHook(body) {
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (const l of lines) {
    if (!l) continue;
    if (l.startsWith('---') || l.startsWith('#') || l.startsWith('name:') || l.startsWith('description:')) continue;
    return l.slice(0, 120);
  }
  return '';
}

main();
