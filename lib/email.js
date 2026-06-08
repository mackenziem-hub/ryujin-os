// ═══════════════════════════════════════════════════════════════
// Ryujin OS  Outbound email helper.
//
// Sends via Gmail SMTP using a Google App Password. From-address is
// the authenticated Gmail account (env GMAIL_USER). Reply-To can be
// overridden per call. Returns { ok: true, messageId } on success or
// { ok: false, error } on failure.
//
// Env required:
//   GMAIL_USER          e.g. mackenzie.m@plusultraroofing.com
//   GMAIL_APP_PASSWORD  16-char Google App Password (no spaces)
//
// To generate the app password:
//   1. https://myaccount.google.com  Security  2-Step Verification (must be on)
//   2. Scroll to "App passwords"  generate one named "Ryujin OS"
//   3. Copy the 16-char password, strip spaces, paste into Vercel env
//
// Why Gmail SMTP not Resend/Postmark: lets Mac use his real address as
// the From: header, so replies land in his Gmail inbox naturally and
// there's no domain DNS setup needed.
// ═══════════════════════════════════════════════════════════════

import nodemailer from 'nodemailer';

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const user = (process.env.GMAIL_USER || '').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || '').trim().replace(/\s+/g, '');
  if (!user || !pass) return null;
  _transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass }
  });
  return _transporter;
}

/**
 * Send an email via Gmail SMTP.
 * @param {object} args
 * @param {string|string[]} args.to       Recipient(s). Comma-separated string or array.
 * @param {string} args.subject           Subject line.
 * @param {string} [args.body]            Plain-text body (becomes the text alternative).
 * @param {string} [args.html]            HTML body. If both body and html present, both go out.
 * @param {string} [args.from]            Override From: (must be an alias the Gmail account can send-as). Defaults to GMAIL_USER.
 * @param {string|string[]} [args.cc]
 * @param {string|string[]} [args.bcc]
 * @param {string} [args.replyTo]         Override Reply-To. Defaults to From.
 * @param {number} [args.timeoutMs=15000]
 */
export async function sendEmail({ to, subject, body, html, from, cc, bcc, replyTo, timeoutMs = 15000 } = {}) {
  const transporter = getTransporter();
  if (!transporter) return { ok: false, error: 'Gmail SMTP credentials missing in env (GMAIL_USER + GMAIL_APP_PASSWORD)' };
  if (!to || (Array.isArray(to) && to.length === 0)) return { ok: false, error: 'to required' };
  if (!subject || !String(subject).trim()) return { ok: false, error: 'subject required' };
  if (!body && !html) return { ok: false, error: 'body or html required' };

  const fromAddress = (from || process.env.GMAIL_USER || '').trim();
  const msg = {
    from: fromAddress,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject: String(subject),
    text: body || undefined,
    html: html || undefined,
    cc: cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : undefined,
    replyTo: replyTo || undefined
  };

  try {
    const info = await Promise.race([
      transporter.sendMail(msg),
      new Promise((_, rej) => setTimeout(() => rej(new Error('SMTP timeout')), timeoutMs))
    ]);
    return { ok: true, messageId: info.messageId, response: info.response, accepted: info.accepted, rejected: info.rejected };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
