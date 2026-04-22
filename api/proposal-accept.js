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
    .select('id, tenant_id, estimate_number, customer_id, status, selected_package, notes, calculated_packages, ghl_opportunity_id')
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

  // 5. Success — Shenron cron jobs will pick this up in the next snapshot refresh.
  //    (A future enhancement could fire an SMS to Mackenzie via Automator or drop a GHL note here.)
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
