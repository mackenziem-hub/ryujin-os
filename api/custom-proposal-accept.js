// Ryujin OS · Custom Proposal Acceptance Endpoint
//
// POST /api/custom-proposal-accept
// Body: { slug, accepted_by?, accepted_at? }
//
// For limited-scope custom proposals hosted under /proposals/custom/<slug>.html.
// These live as static HTML and are tracked via public/proposals/custom/index.json,
// not in the estimates table. This endpoint fires an email to NOTIFY_EMAIL when a
// customer clicks Accept on the static proposal.
//
// Flow:
//   1. Validates slug exists in the public manifest (fetched over HTTPS)
//   2. Emails owner with customer, address, total, scope, link to proposal
//   3. Returns 200 { ok: true, message }
//
// Public endpoint (no auth). The proposal's obscure URL is the only path the customer
// reaches the button from. If abuse becomes an issue, add a shared secret + signed URL.

import { gmailSend } from '../lib/google.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const SITE_BASE = (process.env.SITE_BASE || 'https://ryujin-os.vercel.app').trim();

function fmtMoney(n) {
  if (n == null) return '$0';
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadManifest() {
  const r = await fetch(`${SITE_BASE}/proposals/custom/index.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();

  const slug = String(body.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'missing_slug' });

  let manifest;
  try { manifest = await loadManifest(); } catch (e) {
    console.error('[custom-proposal-accept] manifest load failed', e);
    return res.status(500).json({ error: 'manifest_unavailable' });
  }

  const proposal = (manifest.proposals || []).find(p => p.slug === slug);
  if (!proposal) return res.status(404).json({ error: 'proposal_not_found', slug });

  const acceptedBy = String(body.accepted_by || proposal.customer || 'Customer').trim();
  const acceptedAt = body.accepted_at || new Date().toISOString();
  const proposalUrl = `${SITE_BASE}${proposal.url}`;

  const subject = `PROPOSAL ACCEPTED · ${proposal.customer} · ${proposal.quote_id} · ${fmtMoney(proposal.total_incl_hst)}`;
  const lines = [
    `${acceptedBy} just accepted the custom proposal ${proposal.quote_id}.`,
    ``,
    `Customer:  ${proposal.customer}`,
    `Address:   ${proposal.address}`,
    `Phone:     ${proposal.phone || 'n/a'}`,
    `Scope:     ${proposal.scope_summary}`,
    ``,
    `Subtotal:  ${fmtMoney(proposal.subtotal)}`,
    `HST:       ${fmtMoney(proposal.hst)}`,
    `Total:     ${fmtMoney(proposal.total_incl_hst)}`,
    `Deposit:   ${fmtMoney(proposal.deposit)} (30%)`,
    `Balance:   ${fmtMoney(proposal.balance)}`,
    ``,
    `Accepted by: ${acceptedBy}`,
    `Accepted at: ${acceptedAt}`,
    ``,
    `Proposal:    ${proposalUrl}`,
    proposal.ghl_contact_id ? `GHL contact: ${proposal.ghl_contact_id}` : '',
    ``,
    `Next steps:`,
    ` 1. Call or text ${proposal.customer} to confirm and collect the ${fmtMoney(proposal.deposit)} deposit.`,
    ` 2. Schedule the install (subject to weather + crew availability).`,
    ` 3. Create the GHL opportunity if not already on a pipeline.`,
    ``,
    `Ryujin OS`
  ].filter(Boolean);

  try {
    await gmailSend(NOTIFY_EMAIL, subject, lines.join('\n'));
  } catch (e) {
    console.error('[custom-proposal-accept] gmailSend failed', e);
    return res.status(500).json({ error: 'email_send_failed' });
  }

  return res.status(200).json({
    ok: true,
    message: 'Acceptance recorded. Mackenzie will be in touch shortly.',
    customer: proposal.customer,
    quote_id: proposal.quote_id
  });
}
