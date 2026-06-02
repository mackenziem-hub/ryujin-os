// Ryujin OS - File Annotation Save
// POST /api/file-annotate  (multipart)
//   fields: file_id (uuid, required), annotation_state (JSON string, optional)
//   file:   `image` (PNG, required, the flattened canvas)
//
// Uploads the flattened PNG to Vercel Blob, writes the URL to
// project_files.annotated_url, persists the editable layer state to
// project_files.annotations. Best-effort deletes the previous annotated
// blob so re-saves do not orphan.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { put, del } from '@vercel/blob';
import Busboy from 'busboy';

const MAX_PNG_SIZE = 20 * 1024 * 1024;
const MAX_STATE_SIZE = 512 * 1024;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_PNG_SIZE } });
    busboy.on('field', (name, val) => { fields[name] = val; });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', c => chunks.push(c));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({
          fieldName: name,
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
          fileName: info.filename,
          truncated
        });
      });
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = req.tenant.id;

  let parsed;
  try { parsed = await parseMultipart(req); }
  catch (e) { return res.status(400).json({ error: 'Multipart parse failed' }); }

  const { files, fields } = parsed;
  if (!files.length) return res.status(400).json({ error: 'PNG required as `image` file field' });

  const png = files[0];
  if (png.truncated) return res.status(413).json({ error: 'PNG exceeds 20MB limit' });
  if (!png.mimeType || !png.mimeType.toLowerCase().startsWith('image/png')) {
    return res.status(400).json({ error: 'Expected image/png, got ' + png.mimeType });
  }

  const fileId = fields.file_id;
  if (!fileId) return res.status(400).json({ error: 'file_id required' });

  let annotationState = null;
  if (fields.annotation_state) {
    if (fields.annotation_state.length > MAX_STATE_SIZE) {
      return res.status(413).json({ error: 'annotation_state exceeds 512KB' });
    }
    try { annotationState = JSON.parse(fields.annotation_state); }
    catch (e) { return res.status(400).json({ error: 'annotation_state must be valid JSON' }); }
  }

  const { data: fileRow, error: lookupErr } = await supabaseAdmin
    .from('project_files')
    .select('id, project_id, annotated_url')
    .eq('id', fileId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!fileRow) return res.status(404).json({ error: 'File not found' });

  const ts = Date.now();
  const blobPath = `${req.tenant.slug}/projects/${fileRow.project_id}/annotated/${ts}-${fileId}.png`;

  let blob;
  try {
    blob = await put(blobPath, png.buffer, { access: 'public', contentType: 'image/png' });
  } catch (e) {
    return res.status(500).json({ error: 'Blob upload failed: ' + (e?.message || 'unknown') });
  }

  if (fileRow.annotated_url) {
    try { await del(fileRow.annotated_url); } catch (e) { /* orphan tolerated */ }
  }

  const { data, error } = await supabaseAdmin
    .from('project_files')
    .update({
      annotated_url: blob.url,
      annotations: annotationState
    })
    .eq('id', fileId)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}

export default requireTenant(handler);
export const config = { api: { bodyParser: false } };
