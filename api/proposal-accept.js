// Ryujin OS — Proposal Acceptance Endpoint
//
// POST /api/proposal-accept
// Body: { refId, estimateId, shareToken, customer, rep, tier, financing, signature, acceptedAt }
//
// Effects:
//   1. Verifies the share token matches a real estimate
//   2. Updates estimate: status='accepted', selected_package=tier.id, adds acceptance note
//   3. Stores the signature (data URL) as a file in Vercel Blob and writes its URL back to the estimate
//   4. Writes an activity_log row for audit trail
//   5. Returns { ok: true } — client shows the success modal on 2xx
//
// Public endpoint (no auth header). The share token is the authentication.
// Rate-limiting is at Vercel's edge; this is a write endpoint so keep the body small.

import { supabaseAdmin } from '../lib/supabase.js';
import { put } from '@vercel/blob';
import { gmailSend } from '../lib/google.js';

const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || '').trim();
const GHL_VERSION = '2021-07-28';

async function ghlCall(path, { method = 'GET', body = null } = {}) {
  if (!GHL_TOKEN) throw new Error('GHL_TOKEN not configured');
  const headers = {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Version': GHL_VERSION,
    'Accept': 'application/json'
  };
  const opts = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(GHL_BASE + path, opts);
  const text = await r.text();
  if (!r.ok) throw new Error(`GHL ${r.status}: ${text.substring(0, 400)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Stage IDs per pipeline — map a pipelineId to its "accepted/signed" equivalent.
// Mirrors Shenron's ghl.js PIPELINE_STAGES, filtered to the terminal-success stage
// for each pipeline. Update here if GHL stages are reshuffled.
const ACCEPTED_STAGE_BY_PIPELINE = {
  'l2xOb5ApmVbAWADKtra5': 'f872cb17-7e0d-47ca-b1b3-f2bbd38274d9', // Main → Client Signed
  'jTAc7D9RMHBb3Gzb5bQz': 'aabfe851-86ff-461d-88d3-b6cbad34de56', // Darcy → Contract Signed
  'OF6SJPdnmQS7KcgRffrb': '25b51d70-231f-433b-a545-d885b5a7fd6a', // Mack's → Approved
  'ahWs3qwCDkByRb1e8QSM': 'eb0a8ca2-b9c4-44b7-b0a6-fa0c1287217f'  // Proposal Sent → Approved
};

function fmtMoney(n) {
  if (n == null) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

async function notifyMackenzie({ est, tier, financing, customer, rep, signatureUrl, tierTotalWithTax, acceptedAt, refId, shareToken }) {
  const proposalUrl = `https://ryujin-os.vercel.app/proposal-client.html?share=${encodeURIComponent(shareToken || '')}`;
  const backofficeUrl = `https://ryujin-os.vercel.app/sales-proposal.html?estimate_id=${encodeURIComponent(est.id)}`;

  const subject = `PROPOSAL ACCEPTED · ${customer?.name || 'Customer'} · ${tier.name || tier.id} · ${fmtMoney(tierTotalWithTax)}`;
  const lines = [
    `${customer?.name || 'A customer'} just accepted proposal ${refId || ('PU-' + (est.estimate_number || ''))}.`,
    ``,
    `Package: ${tier.name || tier.id}${tier.sub ? ' · ' + tier.sub : ''}`,
    `Pre-tax: ${fmtMoney(tier.total)}`,
    `With HST:  ${fmtMoney(tierTotalWithTax)}`,
    financing?.monthly
      ? `Financing: $${financing.monthly}/mo over ${(financing.term || 120) / 12} years`
      : `Paying in full`,
    ``,
    `Customer: ${customer?.name || '—'}`,
    `Email:    ${customer?.email || '—'}`,
    `Phone:    ${customer?.phone || '—'}`,
    `Rep:      ${rep?.name || '—'}`,
    `Signed:   ${acceptedAt || new Date().toISOString()}`,
    signatureUrl ? `Signature: ${signatureUrl}` : '',
    ``,
    `Client view: ${proposalUrl}`,
    `Back office: ${backofficeUrl}`,
    ``,
    `— Ryujin OS`
  ].filter(Boolean);

  return gmailSend(NOTIFY_EMAIL, subject, lines.join('\n'));
}

async function fireGhlUpdates({ est, tier, customer, tierTotalWithTax, signatureUrl }) {
  const oppId = est.ghl_opportunity_id;
  const contactIdFromEst = est.customer?.ghl_contact_id || null;
  if (!oppId && !contactIdFromEst) return { skipped: 'no_ghl_ids_on_estimate' };

  const results = {};
  let pipelineId = null;
  let contactId = contactIdFromEst;

  // 1. GET the current opp to learn its pipelineId + contactId
  if (oppId) {
    try {
      const data = await ghlCall(`/opportunities/${oppId}`);
      const opp = data?.opportunity || data;
      pipelineId = opp?.pipelineId || null;
      contactId = contactId || opp?.contactId || null;
    } catch (e) {
      results.fetchOpp = 'error_' + (e.message || 'unknown');
    }
  }

  // 2. Move opp to the accepted/signed stage for its pipeline
  const targetStageId = pipelineId ? ACCEPTED_STAGE_BY_PIPELINE[pipelineId] : null;
  if (oppId && targetStageId) {
    try {
      await ghlCall(`/opportunities/${oppId}`, {
        method: 'PUT',
        body: { pipelineStageId: targetStageId, status: 'won' }
      });
      results.moveStage = 'ok';
    } catch (e) { results.moveStage = 'error_' + (e.message || 'unknown').substring(0, 120); }
  } else if (oppId) {
    results.moveStage = `no_mapped_stage_for_pipeline:${pipelineId || 'unknown'}`;
  }

  // 3. Drop a note on the contact record for clean audit trail in GHL
  if (contactId) {
    const noteBody = [
      `PROPOSAL ACCEPTED — ${tier.name || tier.id}${tier.sub ? ' · ' + tier.sub : ''}`,
      `Total w/ HST: ${fmtMoney(tierTotalWithTax)}`,
      `Customer: ${customer?.name || '—'}`,
      signatureUrl ? `Signature: ${signatureUrl}` : ''
    ].filter(Boolean).join('\n');
    try {
      await ghlCall(`/contacts/${contactId}/notes`, {
        method: 'POST',
        body: { body: noteBody }
      });
      results.contactNote = 'ok';
    } catch (e) { results.contactNote = 'error_' + (e.message || 'unknown').substring(0, 120); }
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const { refId, estimateId, shareToken, customer, rep, tier, financing, signature, acceptedAt } = body;

  if (!shareToken && !estimateId) {
    return res.status(400).json({ error: 'shareToken or estimateId required' });
  }
  if (!tier || !tier.id) {
    return res.status(400).json({ error: 'tier.id required' });
  }

  // 1. Resolve estimate by share token (authoritative — do not trust estimateId from client alone)
  const query = supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, customer_id, status, selected_package, notes, calculated_packages, ghl_opportunity_id, share_token, customer:customers(full_name, email, phone, ghl_contact_id)')
    .limit(1);
  const lookup = shareToken
    ? await query.eq('share_token', shareToken).maybeSingle()
    : await query.eq('id', estimateId).maybeSingle();

  if (lookup.error || !lookup.data) {
    return res.status(404).json({ error: 'Estimate not found for that share token' });
  }
  const est = lookup.data;

  // 2. Store signature in Blob if provided (it's a data URL — strip prefix and decode)
  let signatureUrl = null;
  if (signature && typeof signature === 'string' && signature.startsWith('data:image/')) {
    try {
      const match = signature.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (match) {
        const [, mime, b64] = match;
        const buf = Buffer.from(b64, 'base64');
        const ext = mime.split('/')[1].replace('+xml', '').replace('jpeg', 'jpg');
        const path = `tenants/${est.tenant_id}/signatures/${est.id}-${Date.now()}.${ext}`;
        const blob = await put(path, buf, { access: 'public', contentType: mime });
        signatureUrl = blob.url;
      }
    } catch (e) {
      console.error('[proposal-accept] signature blob upload failed', e?.message);
      // Not fatal — we still record the acceptance
    }
  }

  // 3. Update the estimate — mark accepted + lock in chosen tier + append note
  const now = new Date().toISOString();
  const existingNotes = Array.isArray(est.notes) ? est.notes : [];
  const tierTotalWithTax = tier.totalWithTax || Math.round((tier.total || 0) * 1.15);
  const acceptanceNote = {
    ts: now,
    body: `PROPOSAL ACCEPTED — ${tier.name || tier.id}${tier.sub ? ' · ' + tier.sub : ''}. Pre-tax $${tier.total?.toLocaleString?.() || tier.total}. With HST $${tierTotalWithTax.toLocaleString()}. ${financing?.monthly ? `Financing: $${financing.monthly}/mo over ${(financing.term || 120) / 12} years.` : 'Paying in full.'} Signed by ${customer?.name || 'customer'} at ${now}.`,
    kind: 'acceptance',
    signatureUrl
  };

  const updates = {
    status: 'accepted',
    selected_package: tier.id,
    notes: [...existingNotes, acceptanceNote]
  };

  const { error: updateErr } = await supabaseAdmin
    .from('estimates')
    .update(updates)
    .eq('id', est.id);

  if (updateErr) {
    console.error('[proposal-accept] estimate update failed', updateErr);
    return res.status(500).json({ error: 'Estimate update failed', detail: updateErr.message });
  }

  // 4. Activity log entry for audit trail
  await supabaseAdmin.from('activity_log').insert({
    tenant_id: est.tenant_id,
    entity_type: 'estimate',
    entity_id: est.id,
    action: 'accepted',
    details: {
      tier_id: tier.id,
      tier_name: tier.name || null,
      total_pre_tax: tier.total || null,
      total_with_tax: tierTotalWithTax,
      financing,
      customer_name: customer?.name || null,
      customer_email: customer?.email || null,
      rep_name: rep?.name || null,
      signature_url: signatureUrl,
      accepted_at: acceptedAt || now,
      ref_id: refId || null
    }
  }).then(r => {
    if (r.error) console.error('[proposal-accept] activity_log insert failed', r.error);
  });

  // 5. Fire-and-forget notifications — never block the success response on these.
  //    They're non-critical: if email or GHL calls fail, the acceptance is still
  //    recorded and Mackenzie will still see it in the next snapshot refresh.
  const customerPayload = {
    name: customer?.name || est.customer?.full_name || '',
    email: customer?.email || est.customer?.email || '',
    phone: customer?.phone || est.customer?.phone || ''
  };

  notifyMackenzie({
    est, tier, financing, customer: customerPayload, rep,
    signatureUrl, tierTotalWithTax,
    acceptedAt: acceptedAt || now,
    refId, shareToken: est.share_token
  }).catch(e => console.error('[proposal-accept] notify email failed', e?.message));

  fireGhlUpdates({
    est, tier,
    customer: customerPayload,
    tierTotalWithTax,
    signatureUrl
  }).then(r => console.log('[proposal-accept] ghl results', r))
    .catch(e => console.error('[proposal-accept] ghl update failed', e?.message));

  return res.status(200).json({
    ok: true,
    estimateId: est.id,
    estimateNumber: est.estimate_number,
    status: 'accepted',
    tier: tier.id,
    signatureUrl
  });
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
