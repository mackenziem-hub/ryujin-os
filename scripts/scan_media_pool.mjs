#!/usr/bin/env node
// Ryujin OS - Media Pool Scanner
//
// Walks the 4 photo sources and upserts catalog rows into media_pool so the
// weekly Generator agent has something to pick from. Runs LOCALLY against
// the Plus Ultra tenant, the server-side cron cannot reach Mac's local
// Media folder, so this is the periodic refresh tool Mac fires when he
// wants the pool topped up.
//
// Usage:
//   node scripts/scan_media_pool.mjs                # scan all DB sources
//   node scripts/scan_media_pool.mjs --media-folder # also walk local FS
//   node scripts/scan_media_pool.mjs --dry-run      # report counts, no writes
//
// Env required (pulled from .env.local via vercel env pull):
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY        (NOT the anon key, service writes bypass RLS)
//   BLOB_READ_WRITE_TOKEN       (only when --media-folder is on)
//
// Sources:
//   1. project_files          (already in Blob, just catalog the rows)
//   2. companycam_archive_photos (url_source CDN-hosted, archive as-is)
//   3. estimate_photos        (already in Blob)
//   4. Media folder           (local FS at Desktop/Plus Ultra/Media/) - needs
//                              --media-folder flag, uploads to Blob first
//
// Dedup: composite hash sha256("{source_bucket}:{source_id}"). Phase 1
// shortcut: cross-source dupes (e.g. same photo in project_files AND
// CompanyCam) slip through. Generator's last_used_at gate prevents
// double-posting in the 180-day window even if the catalog is double-counted.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { existsSync } from 'node:fs';

const TENANT_SLUG = 'plus-ultra';
const MEDIA_FOLDER_PATH = process.env.MEDIA_FOLDER_PATH
  || 'C:\\Users\\macke\\OneDrive\\Desktop\\Plus Ultra\\Media';
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SCAN_MEDIA_FOLDER = args.has('--media-folder');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').replace(/\\n/g, '').trim();
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Run `vercel env pull` first.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function sha256(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

// 0-10 quality score from cheap signals. Resolution dominates; recency,
// captioned, and category each add a small bump. The Generator picks high
// scores first, so noise here biases the rotation but does not exclude.
function scoreQuality({ width, height, captured_at, has_caption, category, has_gps }) {
  let score = 5.0;
  const pixels = (width || 0) * (height || 0);
  if (pixels >= 4_000_000) score += 2.0;
  else if (pixels >= 2_000_000) score += 1.5;
  else if (pixels >= 1_000_000) score += 1.0;
  else if (pixels > 0) score += 0.5;
  if (captured_at) {
    const ageDays = (Date.now() - new Date(captured_at).getTime()) / 86_400_000;
    if (ageDays < 30) score += 1.0;
    else if (ageDays < 180) score += 0.5;
  }
  if (has_caption) score += 0.5;
  if (has_gps) score += 0.3;
  if (category === 'after') score += 0.7;
  else if (category === 'before') score += 0.5;
  return Math.min(10, Math.round(score * 100) / 100);
}

async function getTenantId() {
  const { data, error } = await supabase
    .from('tenants').select('id').eq('slug', TENANT_SLUG).single();
  if (error) throw new Error(`tenant lookup failed: ${error.message}`);
  return data.id;
}

async function upsertBatch(tenantId, rows) {
  if (!rows.length) return { inserted: 0, skipped: 0 };
  if (DRY_RUN) return { inserted: 0, skipped: rows.length };
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error, count } = await supabase
      .from('media_pool')
      .upsert(chunk, { onConflict: 'tenant_id,content_hash', ignoreDuplicates: true, count: 'exact' });
    if (error) {
      console.error(`  upsert error on chunk ${i}: ${error.message}`);
      skipped += chunk.length;
    } else {
      inserted += count || 0;
      skipped += chunk.length - (count || 0);
    }
  }
  return { inserted, skipped };
}

async function scanProjectFiles(tenantId) {
  console.log('\n[1/4] project_files');
  // PostgREST caps a single SELECT at 1000 rows regardless of .limit(), which
  // silently truncated this showcase source. Page through with .range() ordered
  // by id for a stable window.
  let data = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: pageRows, error } = await supabase
        .from('project_files')
        .select('id, project_id, url, thumbnail_url, filename, mime_type, file_size, category, caption, tags, captured_at, latitude, longitude')
        .eq('tenant_id', tenantId)
        .like('mime_type', 'image/%')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { console.error('  query failed:', error.message); return { inserted: 0, skipped: 0 }; }
      if (!pageRows || !pageRows.length) break;
      data = data.concat(pageRows);
      if (pageRows.length < PAGE) break;
    }
  }

  const projectIds = [...new Set((data || []).map(r => r.project_id).filter(Boolean))];
  const projectsById = new Map();
  if (projectIds.length) {
    const { data: ps } = await supabase
      .from('projects').select('id, name, address, city')
      .in('id', projectIds);
    for (const p of (ps || [])) projectsById.set(p.id, p);
  }

  const rows = (data || []).map(r => {
    const project = projectsById.get(r.project_id);
    return {
      tenant_id: tenantId,
      source_bucket: 'project_files',
      source_id: r.id,
      project_id: r.project_id || null,
      customer_name: project?.name || null,
      address_city: project?.city || null,
      url: r.url,
      thumbnail_url: r.thumbnail_url || null,
      mime_type: r.mime_type,
      size_bytes: r.file_size || null,
      content_hash: sha256(`project_files:${r.id}`),
      pair_role: r.category === 'before' ? 'before' : r.category === 'after' ? 'after' : null,
      tags: r.tags || [],
      captured_at: r.captured_at || null,
      quality_score: scoreQuality({
        captured_at: r.captured_at,
        has_caption: !!r.caption?.trim(),
        category: r.category,
        has_gps: !!(r.latitude && r.longitude),
      }),
    };
  });

  console.log(`  found ${rows.length} image rows`);
  const result = await upsertBatch(tenantId, rows);
  console.log(`  inserted ${result.inserted}, skipped ${result.skipped}`);
  return result;
}

async function scanCompanyCamArchive(tenantId) {
  console.log('\n[2/4] companycam_archive_photos');
  // PostgREST caps a single SELECT at 1000 rows regardless of .limit(), which
  // silently truncated this scan to the first 1000 (the archive has ~13k).
  // Page through with .range() ordered by id for a stable window.
  let data = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: pageRows, error } = await supabase
        .from('companycam_archive_photos')
        .select('id, archive_project_id, url_source, url_archived, filename, bytes, captured_at, caption, tags, lat, lng')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { console.error('  query failed:', error.message); return { inserted: 0, skipped: 0 }; }
      if (!pageRows || !pageRows.length) break;
      data = data.concat(pageRows);
      if (pageRows.length < PAGE) break;
    }
  }

  const archiveProjectIds = [...new Set((data || []).map(r => r.archive_project_id).filter(Boolean))];
  const archiveProjectsById = new Map();
  if (archiveProjectIds.length) {
    const { data: ps } = await supabase
      .from('companycam_archive_projects').select('id, name, address, city')
      .in('id', archiveProjectIds);
    for (const p of (ps || [])) archiveProjectsById.set(p.id, p);
  }

  const rows = (data || []).map(r => {
    const archive = archiveProjectsById.get(r.archive_project_id);
    const tagArr = typeof r.tags === 'string' && r.tags
      ? r.tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    return {
      tenant_id: tenantId,
      source_bucket: 'companycam_archive',
      source_id: r.id,
      project_id: null,
      customer_name: archive?.name || null,
      address_city: archive?.city || null,
      url: r.url_archived || r.url_source,
      thumbnail_url: null,
      mime_type: 'image/jpeg',
      size_bytes: r.bytes || null,
      content_hash: sha256(`companycam_archive:${r.id}`),
      pair_role: null,
      tags: tagArr,
      captured_at: r.captured_at || null,
      quality_score: scoreQuality({
        captured_at: r.captured_at,
        has_caption: !!r.caption?.trim(),
        category: null,
        has_gps: !!(r.lat && r.lng),
      }),
    };
  });

  console.log(`  found ${rows.length} image rows`);
  const result = await upsertBatch(tenantId, rows);
  console.log(`  inserted ${result.inserted}, skipped ${result.skipped}`);
  return result;
}

async function scanEstimatePhotos(tenantId) {
  console.log('\n[3/4] estimate_photos');
  // estimates has no address/city columns; those live on customers. Pull
  // the customer join so we can denormalize city for caption context.
  // PostgREST caps a single SELECT at 1000 rows regardless of .limit(), so
  // page through with .range() ordered by id for a stable window.
  let estimateRows = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: pageRows, error: estErr } = await supabase
        .from('estimates')
        .select('id, customer_id, customer:customers(city)')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (estErr) { console.error('  estimate index failed:', estErr.message); return { inserted: 0, skipped: 0 }; }
      if (!pageRows || !pageRows.length) break;
      estimateRows = estimateRows.concat(pageRows);
      if (pageRows.length < PAGE) break;
    }
  }
  const estById = new Map((estimateRows || []).map(e => [e.id, { ...e, city: e.customer?.city || null }]));
  const estIds = (estimateRows || []).map(e => e.id);
  if (!estIds.length) {
    console.log('  no estimates to scan');
    return { inserted: 0, skipped: 0 };
  }

  let allPhotos = [];
  for (let i = 0; i < estIds.length; i += 200) {
    const chunkIds = estIds.slice(i, i + 200);
    const { data: photos, error } = await supabase
      .from('estimate_photos')
      .select('id, estimate_id, url, filename, mime_type, caption, category, uploaded_at')
      .in('estimate_id', chunkIds);
    if (error) { console.error(`  photos chunk ${i} failed:`, error.message); continue; }
    allPhotos = allPhotos.concat(photos || []);
  }

  const rows = allPhotos
    .filter(p => !p.mime_type || p.mime_type.startsWith('image/'))
    .map(p => {
      const estimate = estById.get(p.estimate_id);
      return {
        tenant_id: tenantId,
        source_bucket: 'estimate_photos',
        source_id: p.id,
        // Repurpose project_id as the logical parent grouping ID across
        // sources. For estimate_photos, the estimate IS the grouping
        // container, putting estimate_id here lets the pair-linking pass
        // group all photos from the same estimate together (codex P2).
        project_id: p.estimate_id,
        customer_name: null,
        address_city: estimate?.city || null,
        url: p.url,
        thumbnail_url: null,
        mime_type: p.mime_type || 'image/jpeg',
        size_bytes: null,
        content_hash: sha256(`estimate_photos:${p.id}`),
        pair_role: p.category === 'before' ? 'before' : p.category === 'after' ? 'after' : null,
        tags: [],
        captured_at: p.uploaded_at || null,
        quality_score: scoreQuality({
          captured_at: p.uploaded_at,
          has_caption: !!p.caption?.trim(),
          category: p.category,
          has_gps: false,
        }),
      };
    });

  console.log(`  found ${rows.length} image rows`);
  const result = await upsertBatch(tenantId, rows);
  console.log(`  inserted ${result.inserted}, skipped ${result.skipped}`);
  return result;
}

// Local FS walk. Only fires when --media-folder is passed because the server
// cron cannot see Mac's Desktop. Walks Media/before-after, Media/drone, etc.
async function scanMediaFolder(tenantId) {
  console.log('\n[4/4] Media folder (local FS)');
  if (!SCAN_MEDIA_FOLDER) {
    console.log('  skipped (pass --media-folder to enable)');
    return { inserted: 0, skipped: 0 };
  }
  if (!existsSync(MEDIA_FOLDER_PATH)) {
    console.log(`  path does not exist: ${MEDIA_FOLDER_PATH}`);
    return { inserted: 0, skipped: 0 };
  }
  const blobToken = (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (!blobToken) {
    console.error('  BLOB_READ_WRITE_TOKEN missing; cannot upload to Vercel Blob.');
    return { inserted: 0, skipped: 0 };
  }
  const { put } = await import('@vercel/blob');

  async function walk(dir, depth = 0) {
    if (depth > 6) return [];
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return []; }
    const out = [];
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        const nested = await walk(full, depth + 1);
        out.push(...nested);
      } else if (ent.isFile() && ALLOWED_IMAGE_EXT.has(extname(ent.name).toLowerCase())) {
        out.push(full);
      }
    }
    return out;
  }

  const files = await walk(MEDIA_FOLDER_PATH);
  console.log(`  found ${files.length} image files`);
  if (DRY_RUN) {
    console.log('  dry-run: skipping upload + insert');
    return { inserted: 0, skipped: files.length };
  }

  let inserted = 0;
  let skipped = 0;
  for (const path of files) {
    try {
      const buf = await readFile(path);
      const hash = sha256(`media_folder:${path}`);
      const { data: existing } = await supabase
        .from('media_pool').select('id')
        .eq('tenant_id', tenantId).eq('content_hash', hash).maybeSingle();
      if (existing) { skipped++; continue; }

      const fileStat = await stat(path);
      const name = basename(path);
      const ext = extname(name).toLowerCase().replace('.', '');
      const blobKey = `${TENANT_SLUG}/media-pool/${Date.now()}-${name.replace(/[^\w.\-]/g, '_').slice(0, 80)}`;
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      const blob = await put(blobKey, buf, { access: 'public', contentType: mimeType, token: blobToken });

      const { error } = await supabase.from('media_pool').insert({
        tenant_id: tenantId,
        source_bucket: 'media_folder',
        source_id: path,
        url: blob.url,
        mime_type: mimeType,
        size_bytes: fileStat.size,
        content_hash: hash,
        captured_at: fileStat.mtime.toISOString(),
        quality_score: scoreQuality({
          captured_at: fileStat.mtime.toISOString(),
          has_caption: false,
          category: null,
          has_gps: false,
        }),
      });
      if (error) { console.error(`  insert failed for ${name}:`, error.message); skipped++; }
      else inserted++;
    } catch (e) {
      console.error(`  walk error on ${path}:`, e.message);
      skipped++;
    }
  }
  console.log(`  inserted ${inserted}, skipped ${skipped}`);
  return { inserted, skipped };
}

// After all sources land, walk project_files and estimate_photos pair_role
// rows and link before/after partners. Pair window is 180 days at the same
// project_id/estimate_id; closest captured_at wins.
async function linkPairs(tenantId) {
  console.log('\n[pairs] linking before/after partners');
  const { data: candidates } = await supabase
    .from('media_pool')
    .select('id, source_bucket, source_id, project_id, pair_role, captured_at, pair_partner_id')
    .eq('tenant_id', tenantId)
    .in('source_bucket', ['project_files', 'estimate_photos'])
    .not('pair_role', 'is', null);

  if (!candidates?.length) { console.log('  no pair-role candidates'); return 0; }

  // Both buckets now carry the parent ID in project_id (project for
  // project_files, estimate for estimate_photos). Group on that uniformly
  // so before/after pairs at the same parent get linked across both
  // buckets (codex P2, previously grouped estimate_photos per-photo).
  const groups = new Map();
  for (const row of candidates) {
    if (!row.project_id) continue;
    const key = `${row.source_bucket}:${row.project_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let linked = 0;
  for (const [, group] of groups) {
    const befores = group.filter(r => r.pair_role === 'before' && !r.pair_partner_id);
    const afters = group.filter(r => r.pair_role === 'after' && !r.pair_partner_id);
    for (const b of befores) {
      const bTime = new Date(b.captured_at || 0).getTime();
      let best = null;
      let bestDelta = Infinity;
      for (const a of afters) {
        if (a.pair_partner_id) continue;
        const aTime = new Date(a.captured_at || 0).getTime();
        const delta = Math.abs(aTime - bTime);
        if (delta < bestDelta) { best = a; bestDelta = delta; }
      }
      if (!best) continue;
      if (DRY_RUN) { linked++; continue; }
      await supabase.from('media_pool').update({ pair_partner_id: best.id }).eq('id', b.id);
      await supabase.from('media_pool').update({ pair_partner_id: b.id }).eq('id', best.id);
      best.pair_partner_id = b.id;
      linked++;
    }
  }
  console.log(`  linked ${linked} pair(s)`);
  return linked;
}

async function main() {
  console.log(`Ryujin OS - Media Pool Scanner${DRY_RUN ? ' (dry-run)' : ''}`);
  console.log(`Tenant: ${TENANT_SLUG}`);
  const tenantId = await getTenantId();
  console.log(`Tenant id: ${tenantId}`);

  const summary = {
    project_files: await scanProjectFiles(tenantId),
    companycam_archive: await scanCompanyCamArchive(tenantId),
    estimate_photos: await scanEstimatePhotos(tenantId),
    media_folder: await scanMediaFolder(tenantId),
  };
  const pairsLinked = await linkPairs(tenantId);

  console.log('\n─ Summary ─');
  let total = 0;
  for (const [bucket, r] of Object.entries(summary)) {
    console.log(`  ${bucket.padEnd(22)} inserted=${r.inserted}  skipped=${r.skipped}`);
    total += r.inserted;
  }
  console.log(`  pairs_linked            ${pairsLinked}`);
  console.log(`  TOTAL_INSERTED          ${total}`);
}

main().catch(e => {
  console.error('Scanner failed:', e);
  process.exit(1);
});
