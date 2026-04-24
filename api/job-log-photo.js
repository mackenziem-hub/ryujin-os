// Ryujin OS — Job log photo upload
// POST multipart/form-data with a "file" field → returns { url } for inclusion
// in the job_log_entries.photos array. No DB row; the URL itself is the record.

import { put } from '@vercel/blob';
import { requireTenant } from '../lib/tenant.js';
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
  return res.json({ url: blob.url });
}

export default requireTenant(handler);

export const config = { api: { bodyParser: false } };
