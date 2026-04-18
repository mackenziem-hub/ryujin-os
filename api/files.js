// Ryujin OS — Project Files (Photos/Videos/Docs)
// GET    /api/files?project_id=X    — List files for a project
// POST   /api/files                 — Upload file(s) to a project
// PUT    /api/files                 — Update file metadata (caption, tags, annotations, visibility)
// DELETE /api/files?id=X            — Delete a file
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { put } from '@vercel/blob';
import Busboy from 'busboy';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB (video support)
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf'
]);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: 10, fileSize: MAX_FILE_SIZE } });

    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({ buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename, truncated });
      });
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { project_id, category, client_visible } = req.query;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    let query = supabaseAdmin
      .from('project_files')
      .select('*, uploaded_by_user:users!project_files_uploaded_by_fkey(name)')
      .eq('tenant_id', tenantId)
      .eq('project_id', project_id)
      .order('sort_order', { ascending: true })
      .order('uploaded_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (client_visible === 'true') query = query.eq('client_visible', true);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ files: data });
  }

  // ── POST (Upload) ──
  if (req.method === 'POST') {
    const { files, fields } = await parseMultipart(req);
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });

    const projectId = fields.project_id;
    if (!projectId) return res.status(400).json({ error: 'project_id required in form data' });

    // Verify project belongs to tenant
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .single();

    if (!project) return res.status(404).json({ error: 'Project not found' });

    const results = [];
    const ts = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      if (f.truncated) {
        results.push({ fileName: f.fileName, error: 'File exceeds 50MB limit' });
        continue;
      }
      if (!ALLOWED_TYPES.has(f.mimeType)) {
        results.push({ fileName: f.fileName, error: `Unsupported type: ${f.mimeType}` });
        continue;
      }

      const clean = f.fileName.replace(/[^\w.\-]/g, '_').substring(0, 80);
      const blobPath = `${req.tenant.slug}/projects/${projectId}/${ts}-${i}-${clean}`;

      const blob = await put(blobPath, f.buffer, {
        access: 'public',
        contentType: f.mimeType
      });

      // Insert file record
      const { data: fileRecord, error: fErr } = await supabaseAdmin
        .from('project_files')
        .insert({
          project_id: projectId,
          tenant_id: tenantId,
          uploaded_by: fields.uploaded_by || null,
          url: blob.url,
          filename: f.fileName,
          mime_type: f.mimeType,
          file_size: f.buffer.length,
          category: fields.category || 'general',
          caption: fields.caption || null,
          client_visible: fields.client_visible === 'true'
        })
        .select('*')
        .single();

      if (fErr) {
        results.push({ fileName: f.fileName, error: fErr.message });
      } else {
        results.push(fileRecord);
      }
    }

    return res.json({ files: results });
  }

  // ── PUT (Update metadata) ──
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Only allow safe fields to be updated
    const allowed = ['caption', 'category', 'tags', 'annotations', 'annotated_url', 'client_visible', 'is_cover', 'sort_order'];
    const safeUpdates = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) safeUpdates[key] = updates[key];
    }

    const { data, error } = await supabaseAdmin
      .from('project_files')
      .update(safeUpdates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { error } = await supabaseAdmin
      .from('project_files')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);

export const config = { api: { bodyParser: false } };
