// ═══════════════════════════════════════════════════════════════
// /api/twilio-voice — Twilio webhook for inbound + outbound voice routing.
//
// Configure in Twilio dashboard for each Ryujin number:
//   Voice URL: POST https://ryujin-os.vercel.app/api/twilio-voice
//   HTTP Method: POST
//
// Inbound flow (customer dials Ryujin number):
//   Twilio → POST /api/twilio-voice with { To, From, CallSid, ... }
//   We look up which operator owns that Ryujin number → respond with
//   TwiML <Dial><Number>{operator's cell}</Number></Dial> and a
//   <Record> directive so both legs are captured. Recording-complete
//   webhook lives at /api/twilio-recording.
//
// Outbound flow (operator clicks "call customer" in UI):
//   Server-side Twilio API call (NOT this webhook) places the call;
//   Twilio rings operator's cell first, then the customer when they
//   pick up. Same recording webhook.
//
// Mac forwards his cell to his Ryujin number → external calls
// arrive here → forwarded to his actual cell + recorded.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant } from '../lib/tenant.js';
import { verifyTwilioSignature, fullUrl, parseFormBody, readRawBody, normalizePhone, operatorByRyujinNumber, lookupParty } from '../lib/twilio.js';

const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

function twimlReject(reason) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number isn't currently routed. ${reason || ''}</Say><Hangup/></Response>`;
}

function twimlForwardWithRecord(toNumber, callerId, callSid) {
  // <Dial> places a leg to operator's cell. record="record-from-answer-dual"
  // captures both sides as separate channels. recordingStatusCallback fires
  // when Twilio finishes the recording so we can pull + transcribe.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting your call. This call may be recorded for quality and training.</Say>
  <Dial answerOnBridge="true" callerId="${callerId}"
        record="record-from-answer-dual"
        recordingStatusCallback="${APP_BASE}/api/twilio-recording"
        recordingStatusCallbackMethod="POST"
        recordingStatusCallbackEvent="completed"
        timeout="25">
    <Number>${toNumber}</Number>
  </Dial>
</Response>`;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('POST only');
  if (!TWILIO_AUTH_TOKEN) {
    return res.status(503).type('text/xml').send(twimlReject('Twilio auth not configured.'));
  }

  const raw = await readRawBody(req);
  const params = parseFormBody(raw);

  // Verify signature (skip in dev when bypass header is set).
  const url = fullUrl(req);
  if (!req.headers['x-skip-twilio-verify'] && !verifyTwilioSignature(req, url, params)) {
    return res.status(401).type('text/xml').send(twimlReject('Signature failed.'));
  }

  const callSid = params.CallSid;
  const fromPhone = normalizePhone(params.From);
  const toPhone = normalizePhone(params.To);
  if (!callSid || !toPhone) return res.status(400).type('text/xml').send(twimlReject());

  // Resolve tenant — for now Plus Ultra is the only tenant on Twilio.
  // When other tenants come online, look up tenant by ryujin_phone_number
  // owning the To number (since each tenant has its own pool).
  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id, slug').eq('slug', 'plus-ultra').maybeSingle();
  if (!tenant) return res.status(503).type('text/xml').send(twimlReject('Tenant not found.'));

  // Who owns this Ryujin number?
  const operator = await operatorByRyujinNumber(tenant.id, toPhone);
  if (!operator || !operator.phone) {
    // Log the orphan call for admin review.
    await supabaseAdmin.from('phone_calls').insert({
      tenant_id: tenant.id,
      twilio_call_sid: callSid,
      direction: 'inbound',
      from_phone: fromPhone,
      to_phone: toPhone,
      ryujin_phone: toPhone,
      status: 'failed',
      metadata: { reason: 'orphan_ryujin_number' },
    }).then(() => {}, () => {});
    return res.status(200).type('text/xml').send(twimlReject('No operator assigned to this line.'));
  }

  // Reverse-lookup the caller (customer? operator? unknown?).
  const party = await lookupParty(tenant.id, fromPhone);

  // Log the call (insert; later webhooks UPDATE by twilio_call_sid).
  await supabaseAdmin.from('phone_calls').insert({
    tenant_id: tenant.id,
    twilio_call_sid: callSid,
    direction: 'inbound',
    from_phone: fromPhone,
    to_phone: toPhone,
    ryujin_phone: toPhone,
    to_user_id: operator.id,
    customer_id: party?.customer_id || null,
    from_user_id: party?.kind === 'operator' ? party.user_id : null,
    status: 'ringing',
    metadata: { caller_party: party },
  }).then(() => {}, () => {});

  // TwiML: forward to operator's cell, record both legs.
  const callerId = toPhone;  // mask caller as the Ryujin number so operator's cell screen shows the right context
  const xml = twimlForwardWithRecord(operator.phone, callerId, callSid);
  return res.status(200).type('text/xml').send(xml);
}
