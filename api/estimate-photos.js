// Ryujin OS — Estimate Photos (cover + gallery)
// POST   /api/estimate-photos   — multipart upload: file + estimate_id + is_cover + caption
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
