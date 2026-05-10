// ═══════════════════════════════════════════════════════════════
// /api/twilio-status — call lifecycle webhook.
//
// Configure in Twilio dashboard:
//   Status callback URL: POST https://ryujin-os.vercel.app/api/twilio-status
//   Status callback events: initiated, ringing, answered, completed
//
// Updates phone_calls.status / answered_at / ended_at / duration_sec
// as the call progresses. Recording handling lives in /api/twilio-recording.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { verifyTwilioSignature, fullUrl, parseFormBody, readRawBody } from '../lib/twilio.js';

const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  if (!TWILIO_AUTH_TOKEN) return res.status(503).send('not configured');

  const raw = await readRawBody(req);
  const params = parseFormBody(raw);
  const url = fullUrl(req);
  if (!req.headers['x-skip-twilio-verify'] && !verifyTwilioSignature(req, url, params)) {
    return res.status(401).send('signature failed');
  }

  const callSid = params.CallSid;
  const status = params.CallStatus;                  // initiated | ringing | in-progress | completed | busy | no-answer | failed | canceled
  const duration = parseInt(params.CallDuration, 10) || null;
  if (!callSid) return res.status(400).send('CallSid required');

  const update = { status };
  if (status === 'in-progress' && !update.answered_at) update.answered_at = new Date().toISOString();
  if (status === 'completed' || status === 'busy' || status === 'no-answer' || status === 'failed' || status === 'canceled') {
    update.ended_at = new Date().toISOString();
    if (duration) update.duration_sec = duration;
  }

  const { error } = await supabaseAdmin
    .from('phone_calls').update(update).eq('twilio_call_sid', callSid);
  if (error) return res.status(500).send(error.message);
  return res.status(200).send('ok');
}
