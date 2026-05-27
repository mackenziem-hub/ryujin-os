// Ryujin OS — Job log photo upload
// POST multipart/form-data with a "file" field → returns { url } for inclusion
// in the job_log_entries.photos array.
//
// Also bridges sub-portal uploads into the estimate_photos gallery so they
// surface in job.html alongside Mac-side uploads. The bridge is gated on
// a valid sub-portal token in the FormData AND the workorder belonging to
// that sub. Without auth the upload still succeeds (preserves any owner-side
// callers) but skips the gallery insert.

import { put } from '@vercel/blob';
import { requireTenant } from '../lib/tenant.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { verifySubToken } from '../lib/sub-auth.js';
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

  let parsed;
  try {
    parsed = await parse(req);
  } catch (e) {
    console.error('[job-log-photo] busboy parse failed', e?.message || e);
    return res.status(400).json({ error: 'Could not read upload. Try again.', detail: String(e?.message || e).slice(0, 200) });
  }
  const { files, fields } = parsed;
  if (!files.length) return res.status(400).json({ error: 'No file' });
  const f = files[0];
  if (!OK.has(f.mimeType)) return res.status(400).json({ error: 'Unsupported type: ' + f.mimeType });
  if (!f.buffer || f.buffer.length === 0) return res.status(400).json({ error: 'Empty file' });

  // Sanitize the workorder_id segment so an unexpected value can't produce a
  // blob key with chars Vercel Blob's URL constructor rejects (Safari then
  // surfaces the underlying TypeError as "The string did not match the
  // expected pattern" with no actionable detail).
  const woRaw = fields.workorder_id || 'misc';
  const wo = String(woRaw).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'misc';
  const safe = (f.fileName || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'photo';
  const key = `job-log/${req.tenant.slug}/${wo}/${Date.now()}-${safe}`;

  let blob;
  try {
    blob = await put(key, f.buffer, { access: 'public', contentType: f.mimeType });
  } catch (e) {
    console.error('[job-log-photo] blob put failed', { key, mime: f.mimeType, size: f.buffer.length, err: e?.message || e });
    return res.status(502).json({
      error: 'Storage upload failed. Try again or text Mac.',
      detail: String(e?.message || e).slice(0, 200)
    });
  }

  // Bridge to estimate_photos so the upload shows in job.html PHOTOS section.
  // Auth: caller must present a valid sub-portal magic-link token AND the
  // workorder must be assigned to that sub. Anything weaker would let any
  // caller who can hit the endpoint inject images into Mac's gallery
  // (codex P1, 2026-05-26). Failure to authenticate just skips the bridge
  // — the blob upload still succeeds so the owner-side flow (if any) is
  // unaffected. job_log_entries is the audit trail of record either way.
  let estimate_photo_id = null;
  if (wo && wo !== 'misc' && f.mimeType?.startsWith('image/')) {
    try {
      const token = (fields.token || '').trim();
      const sub = token ? await verifySubToken(req.tenant.id, token) : null;
      if (sub) {
        const { data: woRow } = await supabaseAdmin
          .from('workorders')
          .select('linked_estimate_id')
          .eq('id', wo)
          .eq('tenant_id', req.tenant.id)
          .eq('subcontractor_id', sub.id)
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
      }
    } catch (e) {
      console.warn('[job-log-photo] gallery bridge failed', e.message);
    }
  }

  return res.json({ url: blob.url, estimate_photo_id });
}

export default requireTenant(handler);

export const config = { api: { bodyParser: false } };
