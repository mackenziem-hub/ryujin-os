// Ryujin OS · Custom Proposal Acceptance Endpoint
//
// POST /api/custom-proposal-accept
// Body: { slug, accepted_by?, accepted_at? }
//
// Flow:
//   1. Looks up the proposal in the custom_proposals table by slug
//      (falls back to /proposals/custom/index.json manifest for the
//      pre-migration 330 Cameron URL until everything is migrated)
//   2. Updates status='signed', accepted_by, accepted_at on the row (DB path only)
//   3. Emails owner with customer, address, total, scope, link to proposal
//   4. Returns 200 { ok: true, message }
//
// Public endpoint (no auth). The proposal's obscure URL is the only path the customer
// reaches the button from. If abuse becomes an issue, add a shared secret + signed URL.

import { supabaseAdmin } from '../lib/supabase.js';
import { gmailSend } from '../lib/google.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const SITE_BASE = (process.env.SITE_BASE || 'https://ryujin-os.vercel.app').trim();

function fmtMoney(n) {
  if (n == null) return '$0';
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function lookupFromDb(slug) {
  const { data, error } = await supabaseAdmin
    .from('custom_proposals')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    // Table missing or other DB error: fall through to manifest fallback
    console.warn('[custom-proposal-accept] db lookup error', error.message);
    return null;
  }
  return data;
}

async function lookupFromManifest(slug) {
  try {
    const r = await fetch(`${SITE_BASE}/proposals/custom/index.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    const manifest = await r.json();
    return (manifest.proposals || []).find(p => p.slug === slug) || null;
  } catch {
    return null;
  }
}

function normalizeFromDb(row) {
  return {
    slug: row.slug,
    quote_id: row.quote_id,
    customer: row.customer_name,
    address: row.address,
    phone: row.customer_phone,
    email: row.customer_email,
    scope_summary: (row.scope_long || row.scope_title || '').slice(0, 200),
    subtotal: Number(row.subtotal),
    hst: Number(row.hst_amount),
    total_incl_hst: Number(row.total_incl_hst),
    deposit: Number(row.deposit),
    deposit_pct: Number(row.deposit_pct || 30),
    balance: Number(row.balance),
    ghl_contact_id: row.ghl_contact_id,
    url: `/proposals/custom/${row.slug}`,
    _source: 'db',
    _row_id: row.id,
    _tenant_id: row.tenant_id
  };
}

function normalizeFromManifest(entry) {
  return {
    slug: entry.slug,
    quote_id: entry.quote_id,
    customer: entry.customer,
    address: entry.address,
    phone: entry.phone,
    email: null,
    scope_summary: entry.scope_summary,
    subtotal: entry.subtotal,
    hst: entry.hst,
    total_incl_hst: entry.total_incl_hst,
    deposit: entry.deposit,
    deposit_pct: 30,
    balance: entry.balance,
    ghl_contact_id: entry.ghl_contact_id,
    url: entry.url,
    _source: 'manifest'
  };
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

  // Prefer DB; fall back to static manifest for any not-yet-migrated slug
  const dbRow = await lookupFromDb(slug);
  let proposal;
  if (dbRow) proposal = normalizeFromDb(dbRow);
  else {
    const m = await lookupFromManifest(slug);
    if (!m) return res.status(404).json({ error: 'proposal_not_found', slug });
    proposal = normalizeFromManifest(m);
  }

  const acceptedBy = String(body.accepted_by || proposal.customer || 'Customer').trim();
  const acceptedAt = body.accepted_at || new Date().toISOString();
  const proposalUrl = `${SITE_BASE}${proposal.url}`;

  // If row is in DB, mark it signed (idempotent, won't double-fire because the
  // status flip is the gate). If it was already signed previously, skip the
  // email send so the owner doesn't get hammered by refreshes.
  let alreadySigned = false;
  if (proposal._source === 'db') {
    if (dbRow.status === 'signed') {
      alreadySigned = true;
    } else {
      const { error: updErr } = await supabaseAdmin
        .from('custom_proposals')
        .update({
          status: 'signed',
          accepted_by: acceptedBy,
          accepted_at: acceptedAt,
          accepted_payload: body
        })
        .eq('id', proposal._row_id)
        .eq('status', 'draft'); // race-safe: only flip if still draft
      if (updErr) console.warn('[custom-proposal-accept] status update failed', updErr.message);
    }
  }

  if (alreadySigned) {
    return res.status(200).json({
      ok: true,
      message: 'Already accepted. No duplicate email sent.',
      customer: proposal.customer,
      quote_id: proposal.quote_id,
      already_accepted: true
    });
  }

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
    `Deposit:   ${fmtMoney(proposal.deposit)} (${proposal.deposit_pct}%)`,
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
    quote_id: proposal.quote_id,
    source: proposal._source
  });
}
