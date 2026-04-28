#!/usr/bin/env node
// Apr 28 2026 — One-shot historical archive of all presented proposals.
//
// For every Plus Ultra estimate that's been presented to a client (locked
// or otherwise eligible), this script:
//   1. Hits the live /api/proposal-pdf endpoint to render a PDF
//   2. Uploads the PDF to Vercel Blob at proposals/{share_token}/{date}_{slug}_proposal.pdf
//   3. Saves a local copy to the matching Plus Ultra/Jobs/{address}/ folder
//      (or _PDF_Archive/ if no matching folder exists)
//   4. Inserts a row in proposal_pdf_archive
//
// Failures are logged and the loop continues — no estimate breaks the run.
//
// Usage:
//   node scripts/_oneshot/archive-presented-proposals.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { put } from '@vercel/blob';

// ─── Load env ──────────────────────────────────────────────────
function loadEnv(file) {
  try {
    const env = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
      }
    }
  } catch {}
}
loadEnv('.env.local');
loadEnv('.env.production');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const BLOB_TOKEN = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
const RYUJIN_BASE = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env.local');
  process.exit(1);
}
if (!BLOB_TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN required in .env.production (run vercel env pull)');
  process.exit(1);
}

// Config
const JOBS_DIR = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs';
const FALLBACK_DIR = join(JOBS_DIR, '_PDF_Archive');
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// ─── Supabase REST helpers ─────────────────────────────────────
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) {
    throw new Error(`Supabase ${path} → ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

// ─── Address slug helpers ──────────────────────────────────────
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'unknown';
}

function findJobFolder(address) {
  if (!address) return null;
  if (!existsSync(JOBS_DIR)) return null;
  const target = String(address).toLowerCase().trim();
  // Take the leading "house number + first word" of the address as the match key
  // ("212 Tobias Avenue" → "212 tobias")
  const targetParts = target.split(/\s+/).slice(0, 2).join(' ');

  let folders;
  try { folders = readdirSync(JOBS_DIR); } catch { return null; }
  for (const folder of folders) {
    const full = join(JOBS_DIR, folder);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const folderLower = folder.toLowerCase();
    // Case-insensitive match: the folder name starts with the targetParts,
    // OR the targetParts is contained in the folder name.
    if (folderLower.startsWith(targetParts) || folderLower.includes(targetParts)) {
      return full;
    }
    // Also try: any token from address present
    const firstToken = target.split(/\s+/)[0];
    if (firstToken && folderLower.startsWith(firstToken + ' ')) {
      return full;
    }
  }
  return null;
}

// ─── Main loop ─────────────────────────────────────────────────
async function main() {
  console.log('═══ Archive Presented Proposals — Apr 28 2026 ═══\n');

  // Pull tenant id
  const tenants = await sb(`/tenants?slug=eq.plus-ultra&select=id`);
  if (!tenants?.length) {
    console.error('plus-ultra tenant not found');
    process.exit(1);
  }
  const tenantId = tenants[0].id;

  // Iterate: every estimate with share_token, not cancelled, and either
  // locked (clear "presented" signal) OR has any client-facing activity.
  // We're being inclusive on the archive side — better to have an extra
  // PDF than miss one.
  const estimates = await sb(
    `/estimates?tenant_id=eq.${tenantId}` +
    `&share_token=not.is.null` +
    `&status=neq.cancelled` +
    `&select=id,estimate_number,share_token,status,locked_at,accepted_at,proposal_status,customer:customers(full_name,address)` +
    `&order=estimate_number.desc`
  );

  console.log(`Found ${estimates.length} candidate estimates with share_token + not cancelled.\n`);

  // Pull proposal_event activity to know which un-locked ones still got viewed
  const activity = await sb(
    `/activity_log?tenant_id=eq.${tenantId}` +
    `&entity_type=eq.proposal_event` +
    `&action=in.(proposal_opened,tier_selected,pdf_rendered,pdf_downloaded,video_played)` +
    `&select=entity_id`
  );
  const presentedIds = new Set((activity || []).map(a => a.entity_id));

  // Already-archived rows (avoid dup uploads on re-run)
  const archived = await sb(
    `/proposal_pdf_archive?tenant_id=eq.${tenantId}&select=estimate_id,share_token`
  );
  const archivedShareTokens = new Set((archived || []).map(a => a.share_token));

  const stats = {
    total: 0,
    archived: 0,
    skipped_already: 0,
    failed: [],
    blob_urls: [],
    local_paths: [],
    total_bytes: 0
  };

  for (const e of estimates) {
    // Decide if this counts as "presented"
    const isPresented = !!(
      e.locked_at ||
      e.accepted_at ||
      e.proposal_status === 'Published' ||
      presentedIds.has(e.id) ||
      ['proposal_sent','viewed','accepted','scheduled','in_progress','complete'].includes(e.status)
    );
    if (!isPresented) {
      console.log(`  [skip] #${e.estimate_number} ${e.customer?.full_name || '?'} — no presented signal`);
      continue;
    }

    stats.total++;
    const label = `#${e.estimate_number} ${e.customer?.full_name || '?'} (${e.share_token})`;

    if (archivedShareTokens.has(e.share_token)) {
      console.log(`  [dup]  ${label} — already archived, skipping`);
      stats.skipped_already++;
      continue;
    }

    if (!e.share_token) {
      console.log(`  [fail] ${label} — share_token missing`);
      stats.failed.push({ estimate: label, reason: 'share_token missing' });
      continue;
    }

    // 1) Render PDF
    const pdfUrl = `${RYUJIN_BASE}/api/proposal-pdf?share=${encodeURIComponent(e.share_token)}`;
    let pdfBuf;
    try {
      console.log(`  [pdf]  ${label} — rendering...`);
      const r = await fetch(pdfUrl, {
        headers: { Accept: 'application/pdf' }
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`render endpoint ${r.status}: ${txt.slice(0, 200)}`);
      }
      pdfBuf = Buffer.from(await r.arrayBuffer());
      if (pdfBuf.length < 1000) {
        throw new Error(`PDF buffer suspiciously small: ${pdfBuf.length} bytes`);
      }
    } catch (err) {
      console.log(`  [fail] ${label} — PDF render failed: ${err.message}`);
      stats.failed.push({ estimate: label, reason: 'pdf_render_failed', detail: err.message });
      continue;
    }

    const customerSlug = slugify(e.customer?.full_name);
    const blobPath = `proposals/${e.share_token}/${TODAY}_${customerSlug}_proposal.pdf`;
    let blobUrl = null;

    // 2) Upload to Vercel Blob
    try {
      const blob = await put(blobPath, pdfBuf, {
        access: 'public',
        contentType: 'application/pdf',
        token: BLOB_TOKEN
      });
      blobUrl = blob.url;
      stats.blob_urls.push({ token: e.share_token, url: blobUrl });
      console.log(`  [blob] ${label} → ${blobUrl}`);
    } catch (err) {
      console.log(`  [warn] ${label} — Blob upload failed: ${err.message}`);
      // continue — still try local + still log archive row with local_path only
    }

    // 3) Save local copy
    let localPath = null;
    try {
      const matchedFolder = findJobFolder(e.customer?.address);
      if (matchedFolder) {
        localPath = join(matchedFolder, `Proposal_${TODAY}_share-${e.share_token}.pdf`);
      } else {
        if (!existsSync(FALLBACK_DIR)) {
          mkdirSync(FALLBACK_DIR, { recursive: true });
        }
        localPath = join(FALLBACK_DIR, `${e.share_token}_${customerSlug}.pdf`);
      }
      writeFileSync(localPath, pdfBuf);
      stats.local_paths.push({ token: e.share_token, path: localPath, matched_folder: !!matchedFolder });
      console.log(`  [disk] ${label} → ${localPath}`);
    } catch (err) {
      console.log(`  [warn] ${label} — local save failed: ${err.message}`);
    }

    // 4) Insert archive row
    try {
      await sb('/proposal_pdf_archive', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: tenantId,
          estimate_id: e.id,
          share_token: e.share_token,
          blob_url: blobUrl,
          local_path: localPath,
          archived_for: 'historical_snapshot',
          size_bytes: pdfBuf.length,
          customer_name: e.customer?.full_name || null,
          customer_address: e.customer?.address || null
        })
      });
      stats.archived++;
      stats.total_bytes += pdfBuf.length;
    } catch (err) {
      console.log(`  [warn] ${label} — archive row insert failed: ${err.message}`);
      stats.failed.push({ estimate: label, reason: 'archive_row_insert_failed', detail: err.message });
    }
  }

  // ─── Summary ────────────────────────────────────────────────
  console.log('\n═══ Summary ═══');
  console.log(`Eligible (presented):   ${stats.total}`);
  console.log(`Archived this run:      ${stats.archived}`);
  console.log(`Skipped (already done): ${stats.skipped_already}`);
  console.log(`Failed:                 ${stats.failed.length}`);
  console.log(`Total bytes archived:   ${(stats.total_bytes / 1024).toFixed(1)} KB`);

  if (stats.blob_urls.length) {
    console.log('\nSample Blob URLs (first 5):');
    for (const { token, url } of stats.blob_urls.slice(0, 5)) {
      console.log(`  ${token}: ${url}`);
    }
  }
  if (stats.local_paths.length) {
    console.log('\nSample local paths (first 5):');
    for (const { token, path, matched_folder } of stats.local_paths.slice(0, 5)) {
      console.log(`  ${token}: ${path} ${matched_folder ? '(matched job folder)' : '(fallback)'}`);
    }
  }
  if (stats.failed.length) {
    console.log('\nFailures:');
    for (const f of stats.failed) {
      console.log(`  ${f.estimate}: ${f.reason}${f.detail ? ' — ' + f.detail : ''}`);
    }
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
