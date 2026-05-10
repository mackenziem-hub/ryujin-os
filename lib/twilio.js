// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Twilio helpers.
//
// Signature verification + phone-number normalization + customer/
// user lookup by phone. Used by /api/twilio-voice + /api/twilio-recording
// + /api/twilio-status webhooks.
// ═══════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import { supabaseAdmin } from './supabase.js';

const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || '').trim();

// Twilio signs webhooks with HMAC-SHA1(authToken, fullUrl + sortedFormParams).
// See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
export function verifyTwilioSignature(req, fullUrl, formParams) {
  if (!TWILIO_AUTH_TOKEN) return false;
  const sigHeader = req.headers['x-twilio-signature'];
  if (!sigHeader) return false;
  const sortedKeys = Object.keys(formParams || {}).sort();
  let data = fullUrl;
  for (const k of sortedKeys) data += k + (formParams[k] ?? '');
  const expected = crypto.createHmac('sha1', TWILIO_AUTH_TOKEN).update(data, 'utf-8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
  } catch { return false; }
}

// E.164 normalizer — strip spaces / parens / dashes, ensure leading +.
// "(506) 555-1212" → "+15065551212". Plus Ultra is NB CA so default
// country code +1 when none present.
export function normalizePhone(p, defaultCountry = '1') {
  if (!p) return null;
  let digits = String(p).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;       // NA 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

// Reverse-lookup who owns a phone number across users + customers.
// Returns { user_id?, user_name?, customer_id?, customer_name? } or null.
export async function lookupParty(tenantId, phone) {
  const norm = normalizePhone(phone);
  if (!norm) return null;
  // Match users.phone (operator cell) OR users.ryujin_phone_number (their Ryujin number)
  const { data: users } = await supabaseAdmin
    .from('users').select('id, name, phone, ryujin_phone_number')
    .eq('tenant_id', tenantId)
    .or(`phone.eq.${norm},ryujin_phone_number.eq.${norm}`)
    .limit(1);
  if (users?.length) {
    return { user_id: users[0].id, user_name: users[0].name, kind: 'operator' };
  }
  // Customers — store phones in various formats; match either norm or last-7 fallback.
  const { data: customers } = await supabaseAdmin
    .from('customers').select('id, full_name, phone')
    .eq('tenant_id', tenantId)
    .limit(2000);
  if (customers?.length) {
    const exact = customers.find(c => normalizePhone(c.phone) === norm);
    if (exact) return { customer_id: exact.id, customer_name: exact.full_name, kind: 'customer' };
    // last-7-digit fallback for messy legacy data.
    const last7 = norm.slice(-7);
    const fuzzy = customers.find(c => {
      const cp = String(c.phone || '').replace(/[^\d]/g, '');
      return cp.length >= 7 && cp.endsWith(last7);
    });
    if (fuzzy) return { customer_id: fuzzy.id, customer_name: fuzzy.full_name, kind: 'customer_fuzzy' };
  }
  return null;
}

// Find the operator whose ryujin_phone_number matches the dialed number
// — that tells us "this call was for AJ" so we know whose cell to forward to.
export async function operatorByRyujinNumber(tenantId, ryujinNumber) {
  const norm = normalizePhone(ryujinNumber);
  if (!norm) return null;
  const { data } = await supabaseAdmin
    .from('users').select('id, name, phone, ryujin_phone_number, role')
    .eq('tenant_id', tenantId)
    .eq('ryujin_phone_number', norm)
    .maybeSingle();
  return data || null;
}

// Read the request's full URL — Twilio signs against this exactly,
// including query string. Vercel sets req.headers.host + req.url.
export function fullUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  return `${proto}://${req.headers.host}${req.url}`;
}

// Parse application/x-www-form-urlencoded body. Twilio webhooks default to this.
export function parseFormBody(body) {
  if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const out = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decodeURIComponent((eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

export async function readRawBody(req) {
  if (req.body && typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    // Already parsed by Vercel — re-encode for signature check.
    return new URLSearchParams(req.body).toString();
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
