// ═══════════════════════════════════════════════════════════════
// /api/voice-memo-upload-token — direct-to-Blob upload for voice memos.
//
// Mirrors api/marketing-upload-token.js but with audio mime types and
// a smaller max size (voice memos rarely exceed a few MB).
// Client flow: browser MediaRecorder → blob → upload(...) against
// this endpoint → resulting public URL POSTed to /api/voice-memo.
// ═══════════════════════════════════════════════════════════════

import { handleUpload } from '@vercel/blob/client';
import { resolveTenant } from '../lib/tenant.js';

const ALLOWED = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB ceiling — ~5 min of audio at typical bitrate

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenant = await resolveTenant(req);
  let body;
  try { body = await readJson(req); } catch (e) { return res.status(400).json({ error: 'Bad JSON: ' + e.message }); }
  if (!body) return res.status(400).json({ error: 'Empty body' });

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayloadStr) => {
        let cp = {};
        try { cp = JSON.parse(clientPayloadStr || '{}'); } catch {}
        const tenantSlug = tenant?.slug || cp.tenant || 'plus-ultra';
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          tokenPayload: JSON.stringify({ tenant: tenantSlug }),
        };
      },
      onUploadCompleted: async () => { /* client follows up with POST /api/voice-memo */ },
    });
    return res.status(200).json(jsonResponse);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload token failed' });
  }
}

export const config = { api: { bodyParser: false } };
