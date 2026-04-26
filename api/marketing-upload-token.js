// Ryujin OS — Marketing Upload Token (client-side direct-to-Blob upload)
//
// POST /api/marketing-upload-token
//   Issues a presigned upload token so the browser can stream a video or
//   photo straight to Vercel Blob. This bypasses the 4.5MB Vercel function
//   payload limit that would otherwise reject most selfie videos.
//
// The client uses @vercel/blob/client `upload()` against this endpoint;
// once the upload completes, the client POSTs the resulting blob URL to
// /api/marketing as a JSON body to create the clip row.
import { handleUpload } from '@vercel/blob/client';
import { resolveTenant } from '../lib/tenant.js';

const ALLOWED_CONTENT_TYPES = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
];
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB ceiling — generous for selfie videos

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // We need the tenant slug *before* generateToken so the upload path is
  // correctly namespaced. Resolve once up front; the client may pass it via
  // header (preferred) or via clientPayload.
  const tenant = await resolveTenant(req);

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return res.status(400).json({ error: 'Bad JSON: ' + e.message });
  }
  if (!body) return res.status(400).json({ error: 'Empty body' });

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadStr) => {
        // clientPayload is a string the browser sent via upload(...,{ clientPayload })
        let cp = {};
        try { cp = JSON.parse(clientPayloadStr || '{}'); } catch {}
        const tenantSlug = tenant?.slug || cp.tenant || 'plus-ultra';
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_BYTES,
          // tokenPayload travels with the upload and comes back in
          // onUploadCompleted — keep it small.
          tokenPayload: JSON.stringify({ tenant: tenantSlug }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // No-op: the client follows up with POST /api/marketing using
        // the blob URL to create the clip row. This callback runs even if
        // the client crashes mid-flow, but we don't auto-create a clip
        // here because we still need brand_ids + caption + schedule.
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload token generation failed' });
  }
}

export const config = { api: { bodyParser: false } };
