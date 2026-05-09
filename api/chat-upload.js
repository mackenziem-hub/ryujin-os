// Ryujin OS — Chat upload staging endpoint
// POST /api/chat-upload — multipart: files (up to 5)
//   Stages files in Vercel Blob, returns [{url, fileName, mimeType, size}].
//   No DB row — these are ephemeral chat attachments. The chat client passes
//   the URLs to /api/chat which fetches + base64s them into Claude content blocks.
//   If the chat ends up calling create_ryujin_proposal, the URLs can be chained
//   into estimate_photos via the tool's before_photo_url / after_photo_url / cover_photo_url args.
import { requireTenant } from '../lib/tenant.js';
import { put } from '@vercel/blob';
import Busboy from 'busboy';

const MAX_FILE_SIZE = 60 * 1024 * 1024; // 60MB — covers short cover-video renders; chat side ignores non-image/pdf
const MAX_FILES = 5;
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'        // .xlsx
]);

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const files = [];
    const fields = {};
    const busboy = Busboy({ headers: req.headers, limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE } });
    busboy.on('field', (n, v) => { fields[n] = v; });
    busboy.on('file', (n, stream, info) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => files.push({
        buffer: Buffer.concat(chunks),
        mimeType: info.mimeType,
        fileName: info.filename || 'upload'
      }));
    });
    busboy.on('close', () => resolve({ files, fields }));
    busboy.on('error', reject);
    req.pipe(busboy);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { files } = await parseMultipart(req);
    if (!files.length) return res.status(400).json({ error: 'No files provided' });

    const results = [];
    for (const f of files) {
      if (!ALLOWED.has(f.mimeType)) {
        results.push({ fileName: f.fileName, error: `Unsupported type: ${f.mimeType}` });
        continue;
      }
      const safeName = f.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blobPath = `tenants/${req.tenant.slug}/chat-uploads/${Date.now()}-${safeName}`;
      const blob = await put(blobPath, f.buffer, { access: 'public', contentType: f.mimeType });
      results.push({
        url: blob.url,
        fileName: f.fileName,
        mimeType: f.mimeType,
        size: f.buffer.length
      });
    }
    return res.status(201).json({ files: results });
  } catch (e) {
    return res.status(500).json({ error: `Upload failed: ${e.message}` });
  }
}

export default requireTenant(handler);
