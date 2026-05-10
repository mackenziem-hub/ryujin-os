// ═══════════════════════════════════════════════════════════════
// /api/voice-memo — voice memo CRUD + transcription kickoff.
//
//   POST /api/voice-memo
//     body: { blob_url, mime_type, duration_sec?, size_bytes?,
//             ref_message_id?, ref_customer_id?, ref_estimate_id?,
//             ref_service_ticket? }
//     → creates voice_memos row, kicks off Whisper transcription
//       (synchronous for memos < 90s, async otherwise — both update
//       transcription column when ready). Returns the row.
//
//   GET /api/voice-memo?id=<uuid>
//     → returns one row (used for polling transcription status).
//
//   GET /api/voice-memo?ref_message_id=<uuid>
//     → returns the memo attached to a message bubble.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const SYNC_DURATION_THRESHOLD_SEC = 90;     // < 90s → wait for transcription before responding

async function transcribe(blobUrl, mimeType) {
  if (!OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY not configured' };
  try {
    // Pull the audio bytes from Vercel Blob.
    const audioRes = await fetch(blobUrl);
    if (!audioRes.ok) return { ok: false, error: `blob fetch ${audioRes.status}` };
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());

    // Whisper API expects multipart/form-data with file, model.
    const form = new FormData();
    const ext = (mimeType || 'audio/webm').split('/')[1].split(';')[0] || 'webm';
    form.append('file', new Blob([audioBuf], { type: mimeType || 'audio/webm' }), `memo.${ext}`);
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'verbose_json');

    const r = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `whisper ${r.status}: ${txt.slice(0, 200)}` };
    }
    const j = await r.json();
    return { ok: true, text: j.text, language: j.language, duration: j.duration };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function resolveSessionUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token'] || req.query?.token || (req.body?.token);
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('sessions').select('user_id, expires_at').eq('token', token).maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const { data: user } = await supabaseAdmin
    .from('users').select('id, name, email, role').eq('id', session.user_id).maybeSingle();
  return user || null;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const me = await resolveSessionUser(req);

  if (req.method === 'GET') {
    const id = req.query.id;
    const refMessageId = req.query.ref_message_id;
    let q = supabaseAdmin.from('voice_memos').select('*').eq('tenant_id', tenantId);
    if (id) q = q.eq('id', id);
    else if (refMessageId) q = q.eq('ref_message_id', refMessageId);
    else return res.status(400).json({ error: 'id or ref_message_id required' });
    const { data, error } = await q.maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not found' });
    return res.status(200).json({ memo: data });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.blob_url) return res.status(400).json({ error: 'blob_url required' });

    // Insert pending row.
    const insert = {
      tenant_id: tenantId,
      uploader_user_id: me?.id || null,
      blob_url: body.blob_url,
      mime_type: body.mime_type || 'audio/webm',
      duration_sec: body.duration_sec || null,
      size_bytes: body.size_bytes || null,
      transcription_status: 'transcribing',
      ref_message_id: body.ref_message_id || null,
      ref_customer_id: body.ref_customer_id || null,
      ref_estimate_id: body.ref_estimate_id || null,
      ref_service_ticket: body.ref_service_ticket || null,
      metadata: body.metadata || {},
    };
    const { data: row, error: insErr } = await supabaseAdmin
      .from('voice_memos').insert(insert).select('*').single();
    if (insErr) return res.status(500).json({ error: insErr.message });

    // Run Whisper synchronously for short memos so the client gets the
    // transcription in the POST response. Longer memos respond immediately
    // with status=transcribing; client polls GET /api/voice-memo?id=X.
    const dur = parseFloat(body.duration_sec || 0);
    const runSync = dur > 0 && dur <= SYNC_DURATION_THRESHOLD_SEC;
    if (runSync) {
      const t = await transcribe(row.blob_url, row.mime_type);
      const update = t.ok
        ? { transcription: t.text, transcription_lang: t.language || null, transcription_status: 'complete', transcribed_at: new Date().toISOString(), duration_sec: t.duration || row.duration_sec }
        : { transcription_status: 'failed', metadata: { ...row.metadata, transcription_error: t.error } };
      const { data: updated } = await supabaseAdmin
        .from('voice_memos').update(update).eq('id', row.id).select('*').single();
      return res.status(201).json({ memo: updated || row });
    }

    // Async path: kick off transcription without awaiting (best-effort).
    transcribe(row.blob_url, row.mime_type).then(async (t) => {
      const update = t.ok
        ? { transcription: t.text, transcription_lang: t.language || null, transcription_status: 'complete', transcribed_at: new Date().toISOString() }
        : { transcription_status: 'failed', metadata: { ...row.metadata, transcription_error: t.error } };
      await supabaseAdmin.from('voice_memos').update(update).eq('id', row.id);
    }).catch(() => {});

    return res.status(201).json({ memo: row });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

export default requireTenant(handler);
