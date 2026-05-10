// ═══════════════════════════════════════════════════════════════
// /api/calls — list endpoint for the call-log UI.
//
//   GET /api/calls?since_days=14&limit=200&user_id=<uuid>
//     returns: { calls: [...] }
//
// owner+admin can pass any user_id; sales/crew get filtered to themselves.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, effectiveUserId } from '../lib/portalAuth.js';

const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();
const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

// POST /api/calls — operator clicks "call customer" in UI.
// Body: { to_phone (E.164), customer_id?, ref_message_id? }
// Twilio rings operator's cell first; when they pick up it dials the
// customer and records both legs. Same recording webhook as inbound.
async function placeOutboundCall(req, res, session) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return res.status(503).json({ error: 'Twilio not configured', code: 'TWILIO_NOT_CONFIGURED' });
  }
  const body = req.body || {};
  const toPhone = body.to_phone;
  if (!toPhone) return res.status(400).json({ error: 'to_phone required' });

  // Look up the operator's phone + Ryujin number.
  const { data: op } = await supabaseAdmin
    .from('users').select('id, name, phone, ryujin_phone_number').eq('id', session.user_id).maybeSingle();
  if (!op?.phone || !op?.ryujin_phone_number) {
    return res.status(400).json({ error: 'Operator missing phone or ryujin_phone_number — admin must set these in users table.' });
  }

  // Build inline TwiML: ring operator's cell, when answered Dial the customer with recording.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call. This call may be recorded.</Say>
  <Dial answerOnBridge="true" record="record-from-answer-dual"
        recordingStatusCallback="${APP_BASE}/api/twilio-recording"
        recordingStatusCallbackMethod="POST"
        recordingStatusCallbackEvent="completed"
        timeout="30">
    <Number>${toPhone}</Number>
  </Dial>
</Response>`;

  // Call Twilio REST API to place the call. Form-encoded body.
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const formBody = new URLSearchParams({
    From: op.ryujin_phone_number,
    To: op.phone,                                   // ring operator first
    Twiml: twiml,
    StatusCallback: `${APP_BASE}/api/twilio-status`,
    StatusCallbackMethod: 'POST',
    StatusCallbackEvent: 'initiated ringing answered completed',
  });
  // StatusCallbackEvent must be repeated as multiple form fields, not one space-separated value.
  // Workaround: build manually.
  const formStr = `From=${encodeURIComponent(op.ryujin_phone_number)}&To=${encodeURIComponent(op.phone)}&Twiml=${encodeURIComponent(twiml)}&StatusCallback=${encodeURIComponent(APP_BASE + '/api/twilio-status')}&StatusCallbackMethod=POST&StatusCallbackEvent=initiated&StatusCallbackEvent=ringing&StatusCallbackEvent=answered&StatusCallbackEvent=completed`;

  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formStr,
  });
  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: data?.message || 'Twilio create-call failed', detail: data });

  // Insert phone_calls log row so the recording webhook can join later.
  await supabaseAdmin.from('phone_calls').insert({
    tenant_id: req.tenant.id,
    twilio_call_sid: data.sid,
    direction: 'outbound',
    from_phone: op.ryujin_phone_number,
    to_phone: toPhone,
    ryujin_phone: op.ryujin_phone_number,
    from_user_id: op.id,
    customer_id: body.customer_id || null,
    ref_message_id: body.ref_message_id || null,
    status: 'initiated',
    metadata: { initiated_by: op.id },
  }).then(() => {}, () => {});

  return res.status(201).json({ ok: true, call_sid: data.sid, call_status: data.status });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const session = await resolveSession(req);

  if (req.method === 'POST') {
    if (!session) return res.status(401).json({ error: 'sign in to place calls' });
    return placeOutboundCall(req, res, session);
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET or POST only' });

  const sinceDays = Math.min(parseInt(req.query.since_days, 10) || 14, 90);
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const userId = effectiveUserId(session, req.query.user_id);

  let q = supabaseAdmin
    .from('phone_calls')
    .select(`
      id, twilio_call_sid, direction, status,
      from_phone, to_phone, ryujin_phone,
      started_at, answered_at, ended_at, duration_sec,
      voice_memo_id, recording_url,
      customer:customers(id, full_name),
      from_user:users!phone_calls_from_user_id_fkey(id, name),
      to_user:users!phone_calls_to_user_id_fkey(id, name),
      memo:voice_memos(id, blob_url, transcription, transcription_status),
      metadata
    `)
    .eq('tenant_id', tenantId)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (userId) q = q.or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ calls: data || [], since_days: sinceDays });
}

export default requireTenant(handler);
