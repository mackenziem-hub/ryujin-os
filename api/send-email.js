// Ryujin OS  POST /api/send-email
//
// Outbound transactional email. Sends via Gmail SMTP using the From: address
// configured in env (GMAIL_USER). Auth-gated by requireCronOrOwner: only the
// Vercel cron secret or an owner/admin session can call this.
//
// Body:
//   {
//     to:        string | string[]   required
//     subject:   string               required
//     body:      string?              plain-text (becomes text alternative)
//     html:      string?              HTML alternative
//     cc:        string | string[]?
//     bcc:       string | string[]?
//     replyTo:   string?
//     from:      string?              must be a send-as alias on the Gmail account
//   }
//
// Returns:
//   200 { ok: true, messageId, accepted: [...], rejected: [...] }
//   400 { error: 'validation message' }
//   401 { error: 'auth message' }
//   500 { error: 'smtp error' }

import { sendEmail } from '../lib/email.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const { to, subject, body, html, cc, bcc, replyTo, from } = req.body || {};

  if (!to) return res.status(400).json({ error: 'to required' });
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'subject required' });
  if (!body && !html) return res.status(400).json({ error: 'body or html required' });

  const result = await sendEmail({ to, subject, body, html, cc, bcc, replyTo, from });

  if (!result.ok) {
    console.error(`[send-email] failed via=${auth.via} to=${Array.isArray(to)?to.join(','):to} error="${result.error}"`);
    return res.status(500).json({ error: result.error });
  }

  console.log(`[send-email] sent via=${auth.via} to=${Array.isArray(to)?to.join(','):to} subject="${subject}" messageId=${result.messageId}`);
  return res.json({
    ok: true,
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected
  });
}
