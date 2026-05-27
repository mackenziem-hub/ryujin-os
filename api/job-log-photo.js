// Ryujin OS — Job log photo upload
// POST multipart/form-data with a "file" field → returns { url } for inclusion
// in the job_log_entries.photos array.
//
// Also bridges sub-portal uploads into the estimate_photos gallery so they
// surface in job.html alongside Mac-side uploads. Looks up the workorder's
// linked_estimate_id and inserts a row with category='site' and a caption
// derived from the upload's stage label. If the lookup or insert fails the
// upload still succeeds (job_log row still writes); the bridge is best-effort.

import { put } from '@vercel/blob';
import { requireTenant } from '../lib/tenant.js';
import { supabaseAdmin } from '../lib/supabase.js';
import Busboy from 'busboy';

const MAX = 15 * 1024 * 1024; // 15MB — receipts/photos
const OK = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);

function parse(req){
  return new Promise((resolve, reject) => {
    const files = []; const fields = {};
    const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX }});
    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (_, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({ buffer: Buffer.concat(chunks), mimeType: info.mimeType, fileName: info.filename }));
    });
    bb.on('close', () => resolve({ files, fields }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { files, fields } = await parse(req);
  if (!files.length) return res.status(400).json({ error: 'No file' });
  const f = files[0];
  if (!OK.has(f.mimeType)) return res.status(400).json({ error: 'Unsupported type: ' + f.mimeType });

  const wo = fields.workorder_id || 'misc';
  const safe = (f.fileName || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `job-log/${req.tenant.slug}/${wo}/${Date.now()}-${safe}`;

  const blob = await put(key, f.buffer, { access: 'public', contentType: f.mimeType });

  // Bridge to estimate_photos so the upload shows in job.html PHOTOS section.
  // Failure here must not break the upload — we still return the URL so the
  // sub-portal can write its job_log_entries row. Skipped when the upload
  // isn't tied to a workorder (workorder_id='misc' fallback above).
  let estimate_photo_id = null;
  if (wo && wo !== 'misc' && f.mimeType?.startsWith('image/')) {
    try {
      const { data: woRow } = await supabaseAdmin
        .from('workorders')
        .select('linked_estimate_id, tenant_id')
        .eq('id', wo)
        .eq('tenant_id', req.tenant.id)
        .maybeSingle();
      if (woRow?.linked_estimate_id) {
        const stage = (fields.stage_label || '').trim();
        const userCaption = (fields.caption || '').trim();
        const caption = stage && userCaption
          ? `[${stage}] ${userCaption}`
          : (stage ? `[${stage}]` : (userCaption || null));
        const { data: photoRow, error: insErr } = await supabaseAdmin
          .from('estimate_photos')
          .insert({
            estimate_id: woRow.linked_estimate_id,
            url: blob.url,
            filename: safe,
            mime_type: f.mimeType,
            category: 'site',
            caption,
            is_cover: false,
          })
          .select('id')
          .single();
        if (insErr) console.warn('[job-log-photo] estimate_photos insert failed', insErr.message);
        else estimate_photo_id = photoRow?.id || null;
      }
    } catch (e) {
      console.warn('[job-log-photo] gallery bridge failed', e.message);
    }
  }

  return res.json({ url: blob.url, estimate_photo_id });
}

export default requireTenant(handler);

export const config = { api: { bodyParser: false } };
