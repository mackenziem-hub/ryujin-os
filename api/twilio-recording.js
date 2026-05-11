// ═══════════════════════════════════════════════════════════════
// /api/twilio-recording — webhook fired when a call recording is ready.
//
// Twilio POSTs: { RecordingSid, RecordingUrl, RecordingDuration,
//                  CallSid, AccountSid, RecordingStatus, ... }
//
// Flow:
//   1. Verify signature
//   2. Download the recording mp3 from Twilio (auth-protected URL)
//   3. Upload to Vercel Blob for durable storage
//   4. Create a voice_memos row with the blob URL + transcribe via Whisper
//   5. Update phone_calls row by twilio_call_sid → set voice_memo_id +
//      duration + status='completed'
//   6. Create a messages row in the customer's thread (or to the
//      operator's inbox if no customer match) so the recording shows
//      up in /messages.html alongside async memos
//   7. Activity_log entry on the customer record
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { put } from '@vercel/blob';
import { verifyTwilioSignature, fullUrl, parseFormBody, readRawBody } from '../lib/twilio.js';
import { attachNoteToEntity } from '../lib/agentNote.js';

const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

async function transcribe(audioBuf, mimeType) {
  if (!OPENAI_API_KEY) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([audioBuf], { type: mimeType }), 'call.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    const r = await fetch(WHISPER_URL, {
      method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  if (!TWILIO_AUTH_TOKEN || !TWILIO_ACCOUNT_SID) {
    return res.status(503).send('Twilio auth not configured.');
  }

  const raw = await readRawBody(req);
  const params = parseFormBody(raw);
  const url = fullUrl(req);
  // Bypass header only honored when ALLOW_TWILIO_BYPASS=1 in env (dev-only opt-in).
  const bypassAllowed = process.env.ALLOW_TWILIO_BYPASS === '1' && req.headers['x-skip-twilio-verify'];
  if (!bypassAllowed && !verifyTwilioSignature(req, url, params)) {
    return res.status(401).send('signature failed');
  }

  if (params.RecordingStatus !== 'completed') {
    return res.status(200).send('ignored (status=' + params.RecordingStatus + ')');
  }

  const callSid = params.CallSid;
  const recordingSid = params.RecordingSid;
  const recordingUrl = params.RecordingUrl;            // .json by default; append .mp3
  const durationSec = parseInt(params.RecordingDuration, 10) || 0;

  // Find the call row.
  const { data: call } = await supabaseAdmin
    .from('phone_calls').select('id, tenant_id, customer_id, from_user_id, to_user_id, from_phone, to_phone')
    .eq('twilio_call_sid', callSid).maybeSingle();
  if (!call) {
    // Webhook fired before /api/twilio-voice persisted (race). Stamp a fresh row.
    return res.status(202).send('call row not found yet — Twilio will retry');
  }

  // Download the recording. Twilio recording URLs need basic auth.
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const audioRes = await fetch(recordingUrl + '.mp3', { headers: { Authorization: `Basic ${auth}` } });
  if (!audioRes.ok) {
    await supabaseAdmin.from('phone_calls').update({ status: 'completed', recording_url: recordingUrl, metadata: { recording_download_failed: audioRes.status } }).eq('id', call.id);
    return res.status(502).send(`download failed ${audioRes.status}`);
  }
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());

  // Upload to Vercel Blob for durable storage.
  let blobUrl = null;
  try {
    const blobResult = await put(`calls/${call.tenant_id}/${recordingSid}.mp3`, audioBuf, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: false });
    blobUrl = blobResult.url;
  } catch (e) {
    await supabaseAdmin.from('phone_calls').update({ status: 'completed', recording_url: recordingUrl, metadata: { blob_upload_failed: e.message } }).eq('id', call.id);
    return res.status(500).send('blob upload failed');
  }

  // Transcribe.
  const transcription = await transcribe(audioBuf, 'audio/mpeg');
  const transcript = transcription?.text || null;

  // Create voice_memos row.
  const { data: memo } = await supabaseAdmin.from('voice_memos').insert({
    tenant_id: call.tenant_id,
    uploader_user_id: call.from_user_id || call.to_user_id || null,
    blob_url: blobUrl,
    mime_type: 'audio/mpeg',
    duration_sec: durationSec,
    size_bytes: audioBuf.length,
    transcription: transcript,
    transcription_status: transcript ? 'complete' : 'failed',
    transcription_lang: transcription?.language || null,
    transcribed_at: transcript ? new Date().toISOString() : null,
    ref_customer_id: call.customer_id || null,
    metadata: { source: 'twilio_call', call_sid: callSid, recording_sid: recordingSid },
  }).select('id').single();

  // Create a carrier message — to the operator's inbox; if customer was on the
  // line, ref_customer_id is set so it shows on the customer record.
  const toUser = call.to_user_id || call.from_user_id;
  let messageId = null;
  if (toUser) {
    const callerLabel = call.from_phone || 'unknown caller';
    const { data: msg } = await supabaseAdmin.from('messages').insert({
      tenant_id: call.tenant_id,
      from_user_id: null,
      from_label: 'phone call',
      to_user_id: toUser,
      subject: `📞 Call recording from ${callerLabel}`,
      body: transcript ? `📞 ${transcript}` : '📞 Phone call recording (transcription failed)',
      ref_customer_id: call.customer_id || null,
      metadata: {
        voice_memo_id: memo?.id,
        voice_memo_url: blobUrl,
        voice_memo_duration: durationSec,
        voice_memo_status: transcript ? 'complete' : 'failed',
        voice_memo_transcription: transcript,
        phone_call_sid: callSid,
        source: 'twilio_call',
      },
    }).select('id').single();
    messageId = msg?.id || null;
  }

  // Update phone_calls row.
  await supabaseAdmin.from('phone_calls').update({
    twilio_recording_sid: recordingSid,
    voice_memo_id: memo?.id || null,
    recording_url: recordingUrl,
    duration_sec: durationSec,
    status: 'completed',
    ended_at: new Date().toISOString(),
    ref_message_id: messageId,
  }).eq('id', call.id);

  // Activity log on customer record.
  if (call.customer_id) {
    await attachNoteToEntity({
      tenantId: call.tenant_id,
      userId: call.from_user_id || call.to_user_id,
      entityType: 'customer',
      entityId: call.customer_id,
      action: 'phone_call_recording',
      details: { call_sid: callSid, duration_sec: durationSec, transcript: transcript?.slice(0, 800), recording_url: blobUrl },
    });
  }

  return res.status(200).send('ok');
}
