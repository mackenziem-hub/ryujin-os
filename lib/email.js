// ═══════════════════════════════════════════════════════════════
// Ryujin OS  Outbound email helper.
//
// Sends through the Gmail API via lib/google.js (gmailSend), the same
// OAuth transport the daily briefing uses. Keeps the original
// sendEmail({ to, subject, body, html, from, cc, bcc, replyTo }) signature
// and the { ok, error } return contract, so every caller (api/send-email,
// agents/inbox, leadNotify) is unchanged.
//
// Why the Gmail API and not SMTP: the old nodemailer/SMTP path needed
// GMAIL_USER + GMAIL_APP_PASSWORD, which were never set in prod, so every
// email silently failed. The OAuth path (GOOGLE_CLIENT_ID/SECRET/
// REFRESH_TOKEN, already set + proven by the briefing) needs no new secret.
// Migrated 2026-06-23.
//
// Note: gmailSend sends from the authenticated OAuth mailbox
// (mackenzie.m@plusultraroofing.com). A `from` override only takes effect if
// it is a verified send-as alias on that account; otherwise Gmail keeps the
// authenticated address. HTML goes out as a multipart/alternative with a
// plain-text fallback.
// ═══════════════════════════════════════════════════════════════

import { gmailSend } from './google.js';

/**
 * Send an email via the Gmail API.
 * @param {object} args
 * @param {string|string[]} args.to       Recipient(s). Comma-separated string or array.
 * @param {string} args.subject           Subject line.
 * @param {string} [args.body]            Plain-text body (the text part).
 * @param {string} [args.html]            HTML body. Sent as multipart/alternative with the text part as fallback.
 * @param {string} [args.from]            From: override (only honored if a verified Gmail send-as alias).
 * @param {string|string[]} [args.cc]
 * @param {string|string[]} [args.bcc]
 * @param {string} [args.replyTo]         Reply-To override.
 * @param {number} [args.timeoutMs=15000]
 */
export async function sendEmail({ to, subject, body, html, from, cc, bcc, replyTo, timeoutMs = 15000 } = {}) {
  if (!to || (Array.isArray(to) && to.length === 0)) return { ok: false, error: 'to required' };
  if (!subject || !String(subject).trim()) return { ok: false, error: 'subject required' };
  if (!body && !html) return { ok: false, error: 'body or html required' };

  const toAddr = Array.isArray(to) ? to.join(', ') : to;
  const options = {};
  if (cc) options.cc = Array.isArray(cc) ? cc.join(', ') : cc;
  if (bcc) options.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc;
  if (from) options.from = from;
  if (replyTo) options.replyTo = replyTo;
  if (html) options.html = html;

  // gmailSend builds the text part from `body`. When only html was supplied,
  // derive a plain-text fallback so the message still carries a text leg.
  const text = body || htmlToText(html);

  let timer;
  try {
    const res = await Promise.race([
      gmailSend(toAddr, String(subject), text, options),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Gmail send timeout')), timeoutMs); })
    ]);
    // Preserve the old return shape: send-email.js echoes accepted/rejected.
    return { ok: true, messageId: res?.id, threadId: res?.threadId, accepted: Array.isArray(to) ? to : [to], rejected: [] };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Cheap HTML-to-text for the plain-text fallback when a caller sends html only.
// Length-capped, and uses a non-backtracking tag pattern (no `[^>]+`) so a
// malformed body (e.g. a long run of "<" with no ">") cannot cause quadratic
// blowup. Entity decode does &amp; last so &amp;lt; survives correctly.
function htmlToText(html) {
  return String(html || '')
    .slice(0, 50000)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
