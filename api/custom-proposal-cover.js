// Ryujin OS · Custom Proposal Cover Upload
//
// POST /api/custom-proposal-cover  (multipart/form-data, field name: "cover")
// Body: a single image file. Up to 10 MB.
//
// Stores under Vercel Blob at custom-proposals/<random>/<filename>.
// Returns { url } that the form puts into the custom_proposals row.
//
// Admin-only via requireTenant. Used by /custom-proposal-new.html before
// it POSTs to /api/custom-proposals.

import { put } from '@vercel/blob';
import Busboy from 'busboy';
import { resolveTenant } from '../lib/tenant.js';

export const config = { api: { bodyParser: false } };

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const out = { file: null, fields: {} };
    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_FILE_SIZE } });
    busboy.on('field', (name, val) => { out.fields[name] = val; });
    busboy.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', c => chunks.push(c));
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        out.file = {
          buffer: Buffer.concat(chunks),
          mimeType: info.mimeType,
          fileName: info.filename || 'cover',
          truncated
        };
      });
    });
    busboy.on('close', () => resolve(out));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

function randSlug(n = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  let parsed;
  try { parsed = await parseMultipart(req); }
  catch (e) { return res.status(400).json({ error: 'parse_failed', detail: e.message }); }

  const file = parsed.file;
  if (!file || !file.buffer.length) return res.status(400).json({ error: 'no_file' });
  if (file.truncated) return res.status(413).json({ error: 'file_too_large', max_bytes: MAX_FILE_SIZE });
  if (!ALLOWED.has(file.mimeType)) {
    return res.status(415).json({ error: 'unsupported_type', mime: file.mimeType });
  }

  const slugHint = (parsed.fields.slug || 'cover').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 40);
  const ext = (file.fileName.match(/\.[a-zA-Z0-9]+$/) || ['.png'])[0].toLowerCase();
  const key = `custom-proposals/${slugHint || 'cover'}-${randSlug()}/cover${ext}`;

  let blob;
  try {
    blob = await put(key, file.buffer, {
      access: 'public',
      contentType: file.mimeType,
      addRandomSuffix: false
    });
  } catch (e) {
    return res.status(500).json({ error: 'blob_upload_failed', detail: e.message });
  }

  return res.status(200).json({ ok: true, url: blob.url, key });
}
