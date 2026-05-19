// Ryujin OS — Estimate Photos (cover + gallery)
// GET    /api/estimate-photos?wo_id=X : Union of estimate_photos + project_files (image/video) for the workorder's customer
// POST   /api/estimate-photos          : multipart upload: file + estimate_id + is_cover + caption
// DELETE /api/estimate-photos?id=X
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { put, del } from '@vercel/blob';
import Busboy from 'busboy';

const MAX_FILE_SIZE = 60 * 1024 * 1024; // bumped to 60MB to cover short cover-video renders
const ALLOWED_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif']);
const ALLOWED_VIDEO = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: 5, fileSize: MAX_FILE_SIZE } });
    busboy.on('field', (n, v) => { fields[n] = v; });
    busboy.on('file', (n, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({ buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename }));
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  // GET ?wo_id=X. Return unified media list for the workorder. Walks
  // workorder -> customer -> estimates + projects, then unions
  // estimate_photos (legacy gallery) with image/video project_files (crew
  // captures via /api/files). Used by job.html ?wo= folder view.
  if (req.method === 'GET' && req.query?.wo_id) {
    const woId = req.query.wo_id;
    const { data: wo, error: woErr } = await supabaseAdmin
      .from('workorders')
      .select('id, tenant_id, customer_id, linked_estimate_id')
      .eq('id', woId)
      .eq('tenant_id', tenantId)
      .single();
    if (woErr || !wo) return res.status(404).json({ error: 'Workorder not found for this tenant' });

    // Resolve customer_id either directly or via linked estimate
    let customerId = wo.customer_id;
    if (!customerId && wo.linked_estimate_id) {
      const { data: est } = await supabaseAdmin
        .from('estimates').select('customer_id').eq('id', wo.linked_estimate_id).eq('tenant_id', tenantId).single();
      customerId = est?.customer_id || null;
    }

    // Estimate gallery: every estimate row for this customer
    let estimatePhotos = [];
    if (customerId) {
      const { data: estIds } = await supabaseAdmin
        .from('estimates').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId);
      const ids = (estIds || []).map(e => e.id);
      if (ids.length) {
        const { data: rows } = await supabaseAdmin
          .from('estimate_photos')
          .select('id, url, filename, mime_type, caption, is_cover, uploaded_at, estimate_id')
          .in('estimate_id', ids)
          .order('uploaded_at', { ascending: false });
        estimatePhotos = (rows || []).map(r => ({ ...r, source: 'estimate_photos' }));
      }
    }

    // Project files: crew captures keyed by project belonging to this customer.
    // project_files has its own tenant_id column, so apply a direct tenant
    // predicate as defense-in-depth (belt-and-suspenders alongside the
    // project_id IN filter resolved through tenant-scoped projects).
    let projectFiles = [];
    if (customerId) {
      const { data: projs } = await supabaseAdmin
        .from('projects').select('id').eq('tenant_id', tenantId).eq('customer_id', customerId);
      const pids = (projs || []).map(p => p.id);
      if (pids.length) {
        const { data: rows } = await supabaseAdmin
          .from('project_files')
          .select('id, url, thumbnail_url, filename, mime_type, category, caption, captured_at, uploaded_at, sort_order, is_cover, project_id')
          .eq('tenant_id', tenantId)
          .in('project_id', pids)
          .order('uploaded_at', { ascending: false });
        projectFiles = (rows || [])
          .filter(r => typeof r.mime_type === 'string' && (r.mime_type.startsWith('image/') || r.mime_type.startsWith('video/')))
          .map(r => ({ ...r, source: 'project_files' }));
      }
    }

    // Union, newest first. Same shape so client renders uniformly.
    const photos = [...estimatePhotos, ...projectFiles].sort((a, b) => {
      const da = new Date(a.captured_at || a.uploaded_at || 0).getTime();
      const db = new Date(b.captured_at || b.uploaded_at || 0).getTime();
      return db - da;
    });
    return res.json({ photos, counts: { estimate_photos: estimatePhotos.length, project_files: projectFiles.length } });
  }

  if (req.method === 'POST') {
    const { files, fields } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const estimateId = fields.estimate_id;
    if (!estimateId) return res.status(400).json({ error: 'estimate_id required' });

    const { data: est } = await supabaseAdmin
      .from('estimates').select('id').eq('id', estimateId).eq('tenant_id', tenantId).single();
    if (!est) return res.status(404).json({ error: 'Estimate not found for this tenant' });

    const isCover = fields.is_cover === 'true' || fields.is_cover === '1';
    const caption = fields.caption || null;
    const results = [];

    if (isCover) {
      await supabaseAdmin.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
    }

    for (const f of files) {
      const isVideo = ALLOWED_VIDEO.has(f.mimeType);
      if (!ALLOWED_IMAGE.has(f.mimeType) && !isVideo) {
        results.push({ filename: f.fileName, error: `Unsupported type: ${f.mimeType}` });
        continue;
      }
      // Videos are always treated as cover_video — swap any previous cover video
      if (isVideo && caption !== 'cover_video') {
        // Let the caption override if explicitly set, otherwise enforce it
      }
      if (isVideo) {
        await supabaseAdmin.from('estimate_photos').delete()
          .eq('estimate_id', estimateId).eq('caption', 'cover_video');
      }
      const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobPath = `tenants/${req.tenant.slug}/estimates/${estimateId}/${Date.now()}-${safeName}`;
      const blob = await put(blobPath, f.buffer, { access: 'public', contentType: f.mimeType });
      const { data: row, error } = await supabaseAdmin
        .from('estimate_photos')
        .insert({ estimate_id: estimateId, url: blob.url, filename: f.fileName, mime_type: f.mimeType, is_cover: isCover, caption })
        .select('*')
        .single();
      if (error) { results.push({ filename: f.fileName, error: error.message }); continue; }
      results.push(row);
    }

    return res.status(201).json({ photos: results });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { data: photo } = await supabaseAdmin
      .from('estimate_photos')
      .select('url, estimate:estimates!inner(tenant_id)')
      .eq('id', id)
      .single();
    if (!photo || photo.estimate.tenant_id !== tenantId) return res.status(404).json({ error: 'Photo not found' });
    try { await del(photo.url); } catch (e) { /* blob gone or unreachable — ok */ }
    await supabaseAdmin.from('estimate_photos').delete().eq('id', id);
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
