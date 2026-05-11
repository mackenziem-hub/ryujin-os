// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Outbound SMS helper.
//
// Sends SMS via Twilio's REST API (`/2010-04-01/Accounts/{Sid}/Messages.json`).
// Returns { ok: true } on success or { ok: false, error } on failure.
// Best-effort: callers should not await this in critical paths; fire
// and forget unless you specifically need the result.
//
// Env required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// ═══════════════════════════════════════════════════════════════

import { normalizePhone } from './twilio.js';

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Send an SMS via Twilio.
 * @param {object} args
 * @param {string} args.from - E.164 sender number (must be a Twilio number on the account)
 * @param {string} args.to - Recipient phone (any format; will be normalized to E.164)
 * @param {string} args.body - Message text (max ~1600 chars; Twilio segments at 160)
 * @param {number} [args.timeoutMs=10000]
 */
export async function sendSMS({ from, to, body, timeoutMs = 10000 }) {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const tok = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !tok) return { ok: false, error: 'Twilio credentials missing in env' };

  const toE164 = normalizePhone(to);
  const fromE164 = normalizePhone(from);
  if (!toE164 || !fromE164) return { ok: false, error: 'Invalid from/to phone' };
  if (!body || !String(body).trim()) return { ok: false, error: 'Empty body' };

  const params = new URLSearchParams();
  params.set('To', toE164);
  params.set('From', fromE164);
  params.set('Body', String(body));

  const auth = Buffer.from(`${sid}:${tok}`).toString('base64');
  try {
    const r = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) {
      let body;
      try { body = await r.json(); } catch { body = { message: await r.text() }; }
      return { ok: false, error: `Twilio ${r.status}: ${body.message || body.code || 'unknown'}` };
    }
    const data = await r.json();
    return { ok: true, sid: data.sid, status: data.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Truncate a body to fit a single SMS-ish preview line.
 * Strips newlines, collapses whitespace, trims to ~120 chars + ellipsis.
 */
export function smsPreview(body, max = 120) {
  if (!body) return '';
  const cleaned = String(body).replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}
