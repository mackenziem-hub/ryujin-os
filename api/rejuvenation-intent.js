// Ryujin OS — Rejuvenation Intent Endpoint
//
// POST /api/rejuvenation-intent
// Body: { proposal_slug, customer_name, address, customer_email, customer_phone,
//         ghl_contact_id?, all_in_total? }
//
// Effects:
//   1. Emails Mac at NOTIFY_EMAIL with intent details (subject prefixed "REJUVENATION YES")
//   2. If ghl_contact_id provided, adds a note to that GHL contact (best-effort)
//   3. Returns { ok, errors[], notify, ghl } so the client can flip the button to confirm
//
// Public endpoint (no auth). Customer-driven from a public proposal page.

import { gmailSend } from '../lib/google.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || '').trim();
const GHL_VERSION = '2021-07-28';

async function ghlAddNote(contactId, body) {
  if (!GHL_TOKEN || !contactId) return null;
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GHL ${res.status}: ${txt.slice(0, 240)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const {
    proposal_slug = '',
    customer_name = '',
    address = '',
    customer_email = '',
    customer_phone = '',
    ghl_contact_id = '',
    all_in_total = ''
  } = body;

  const timestamp = new Date().toISOString();
  const proposalUrl = proposal_slug
    ? `https://ryujin-os.vercel.app/${proposal_slug.replace(/^\/+/, '')}`
    : '';

  const subject = `REJUVENATION YES · ${customer_name || 'Customer'}${address ? ' · ' + address : ''}`;
  const lines = [
    `${customer_name || 'A customer'} just clicked "Rejuvenate My Roof" on your proposal.`,
    ``,
    `Address:  ${address || '—'}`,
    `Email:    ${customer_email || '—'}`,
    `Phone:    ${customer_phone || '—'}`,
    all_in_total ? `Quoted:   $${all_in_total} all-in` : '',
    proposalUrl ? `Proposal: ${proposalUrl}` : '',
    `Time:     ${timestamp}`,
    ``,
    `Reach out to confirm scheduling.`,
    ``,
    `— Ryujin OS`
  ].filter(Boolean);

  const errors = [];
  let notifySent = false;
  let ghlNoted = false;

  try {
    await gmailSend(NOTIFY_EMAIL, subject, lines.join('\n'));
    notifySent = true;
  } catch (e) {
    errors.push(`email: ${e.message || 'send failed'}`);
  }

  if (ghl_contact_id) {
    try {
      const noteBody = `Rejuvenation YES — clicked "Rejuvenate My Roof" on ${proposalUrl || 'proposal page'} at ${timestamp}. Ready to schedule.`;
      await ghlAddNote(ghl_contact_id, noteBody);
      ghlNoted = true;
    } catch (e) {
      errors.push(`ghl: ${e.message || 'note failed'}`);
    }
  }

  return res.status(200).json({
    ok: errors.length === 0,
    errors,
    notify: { sent: notifySent },
    ghl: ghl_contact_id ? { noted: ghlNoted } : null
  });
}
