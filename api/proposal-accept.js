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
import {
  computeRateHoldExpiry,
  computeRepCallDue,
  computeDepositAmountCents,
  ESTIMATE_TIMING
} from '../lib/state.js';

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
// Mirrors the ghl.js PIPELINE_STAGES, filtered to the terminal-success stage
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
  const { refId, estimateId, shareToken, customer, rep, tier, financing, signature, acceptedAt, selectedAddons, addonsSubtotal, envelope } = body;
  const addonsList = Array.isArray(selectedAddons) ? selectedAddons : [];
  // SECURITY (P1): never trust client money. addonsSubtotal / a.price from the
  // body are display-only echoes; the persisted add-on subtotal is re-derived
  // below from est.custom_prices._addons by slug. Kept here only for the audit
  // breakdown, not for any persisted financial value.
  const clientAddonsSum = Number(addonsSubtotal) || addonsList.reduce((s, a) => s + (Number(a?.price) || 0), 0);
  // Envelope mode payload (Performance Shell configurator). When present,
  // this is the customer's full configuration: which roof tier, which siding
  // tier, which trim toggles, plus the engine-computed bundle/savings/cash.
  // NOTE (P1 residual): finalSelling here is still client-computed (see
  // needsHumanConfirm) — there is no stored authoritative envelope total to
  // re-derive against.
  const envelopeAccept = envelope && typeof envelope === 'object' ? envelope : null;

  // Bug-sweep #1/S1 (2026-04-24): shareToken is mandatory. Public endpoint cannot
  // be authenticated by `estimateId` alone — that lets any client accept any tenant's
  // quote by guessing/iterating IDs.
  if (!shareToken) {
    return res.status(400).json({ error: 'shareToken required' });
  }
  if (!tier || !tier.id) {
    return res.status(400).json({ error: 'tier.id required' });
  }

  // 1. Resolve estimate by share token (authoritative — do not trust estimateId from client)
  const lookup = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, customer_id, status, selected_package, notes, calculated_packages, custom_prices, ghl_opportunity_id, share_token, proposal_mode, tags, customer:customers(full_name, email, phone, address, ghl_contact_id)')
    .eq('share_token', shareToken)
    .limit(1)
    .maybeSingle();

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
  // Fold add-on / envelope selections into the contract total.
  //
  // Envelope mode (newer): customer's selections drive bundle pricing. Use
  // the client-computed finalSelling (which includes any cash discount) as
  // the authoritative pre-tax. Re-derive HST.
  //
  // Add-on mode (legacy): selectedAddons + addonsSubtotal layer on top of
  // the chosen tier total.
  let tierBaseTotal, tierTotalWithTax, acceptanceBodyExtra = '';

  // SECURITY (P1): re-price add-ons SERVER-SIDE from est.custom_prices._addons
  // (the authoritative list proposal.js serves) keyed by slug. Ignore the
  // client-supplied a.price / addonsSubtotal entirely for persisted values.
  // Unknown slugs (e.g. the dynamic gutter-package not present in static
  // _addons — see needsHumanConfirm) contribute 0 to the persisted total.
  const serverAddons = Array.isArray(est.custom_prices?._addons) ? est.custom_prices._addons : [];
  const serverAddonPrice = (slug) => {
    const match = serverAddons.find(a => a && a.slug === slug);
    return match ? (Number(match.price) || 0) : 0;
  };
  const addonsSum = addonsList.reduce((s, a) => s + serverAddonPrice(a?.slug), 0);

  if (envelopeAccept && envelopeAccept.finalSelling != null) {
    // Envelope mode: see needsHumanConfirm — finalSelling cannot yet be
    // re-derived server-side, so it is intentionally left unchanged here.
    tierBaseTotal = Number(envelopeAccept.finalSelling) || 0;
    tierTotalWithTax = Math.round(tierBaseTotal * 1.15);
    const sel = envelopeAccept.selections || {};
    const lines = [];
    if (sel.roof)   lines.push(`Roof: ${sel.roof}`);
    if (sel.siding && sel.siding !== 'none') lines.push(`Siding: ${sel.siding}`);
    const trimOn = ['gutters','soffit','fascia'].filter(k => sel.trim?.[k]);
    if (trimOn.length) lines.push(`Trim: ${trimOn.join(', ')}`);
    const cashLine = (envelopeAccept.cashOff && envelopeAccept.cashOff > 0)
      ? ` Cash discount applied: -$${Number(envelopeAccept.cashOff).toLocaleString()}.`
      : '';
    const savingsLine = (envelopeAccept.savings && envelopeAccept.savings > 0)
      ? ` Bundle savings vs à la carte: $${Number(envelopeAccept.savings).toLocaleString()}.`
      : '';
    acceptanceBodyExtra = ` [${envelopeAccept.packageName || 'Custom Package'}] ${lines.join(' · ')}.${savingsLine}${cashLine}`;
  } else {
    // SECURITY (P1): re-derive the tier base price SERVER-SIDE from the frozen
    // est.calculated_packages[tier.id]. Never trust client tier.total /
    // tier.totalWithTax — they drive final_accepted_total + the 33% deposit.
    // Mirrors api/proposal.js + api/proposal-v2-accept.js: pkg.total ?? summary.sellingPrice.
    const pkgs = est.calculated_packages && typeof est.calculated_packages === 'object' ? est.calculated_packages : {};
    const pkg = pkgs[tier.id];
    const serverTierBase = pkg ? Number(pkg.total ?? pkg.summary?.sellingPrice ?? 0) : 0;
    if (!pkg || !(serverTierBase > 0)) {
      return res.status(400).json({ error: 'Unknown or unpriced tier for this proposal', tier: tier.id });
    }
    tierBaseTotal = serverTierBase + addonsSum;
    // Re-derive HST from the server base; ignore any client-supplied totalWithTax.
    tierTotalWithTax = Math.round(tierBaseTotal * 1.15);
    if (addonsList.length) {
      acceptanceBodyExtra = ' Add-ons: ' + addonsList.map(a => `${a.label || a.slug} ($${serverAddonPrice(a?.slug).toLocaleString()})`).join(', ') + `. Add-ons subtotal pre-tax: $${addonsSum.toLocaleString()}.`;
    }
  }

  const acceptanceNote = {
    ts: now,
    body: `PROPOSAL ACCEPTED — ${envelopeAccept?.packageName || tier.name || tier.id}${tier.sub ? ' · ' + tier.sub : ''}. Pre-tax $${tierBaseTotal.toLocaleString()}. With HST $${tierTotalWithTax.toLocaleString()}.${acceptanceBodyExtra} ${financing?.monthly ? `Financing: $${financing.monthly}/mo over ${(financing.term || 120) / 12} years.` : 'Paying in full.'} Signed by ${customer?.name || 'customer'} at ${now}.`,
    kind: 'acceptance',
    signatureUrl,
    addons: addonsList,
    envelope: envelopeAccept
  };

  // Resolve customer payload up front so it's available throughout (was previously
  // defined later, causing ReferenceError in the repair-ticket auto-create block).
  const customerPayload = {
    name: customer?.name || est.customer?.full_name || '',
    email: customer?.email || est.customer?.email || '',
    phone: customer?.phone || est.customer?.phone || ''
  };

  // State machine integration (Bible §5.2 + migration 038).
  // Accept transitions estimate from proposal_sent → approved_pending_rep_call.
  // Sets timing windows: rep call due 24h, rate held 30 days from proposal_sent
  // (preserve existing if already set during proposal_sent).
  // Sets deposit_status / finance_status based on financing path:
  //   * Financed (financing.monthly truthy) → finance_status='pending', deposit_status='not_required'
  //   * Cash → deposit_status='pending', deposit_amount=33% of total, finance_status='not_applicable'
  const isFinanced = !!(financing?.monthly);
  const depositAmountCents = computeDepositAmountCents(tierTotalWithTax, isFinanced);
  const rateHoldExpiresAt = est.rate_hold_expires_at || computeRateHoldExpiry(now);
  const repCallDueAt = computeRepCallDue(now);

  const updates = {
    status: 'accepted',                                // legacy column, mirror
    state: 'approved_pending_rep_call',                // canonical state machine field
    selected_package: tier.id,
    notes: [...existingNotes, acceptanceNote],
    final_accepted_total: tierTotalWithTax,
    approved_at: now,
    rate_hold_expires_at: rateHoldExpiresAt,
    rep_call_due_at: repCallDueAt,
    deposit_status: isFinanced ? 'not_required' : 'pending',
    deposit_amount: depositAmountCents,
    finance_status: isFinanced ? 'pending' : 'not_applicable',
    finance_provider: isFinanced ? 'financeit' : null
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
      total_pre_tax: tierBaseTotal,
      total_with_tax: tierTotalWithTax,
      client_claimed_pre_tax: tier.total ?? null,
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

  // 4b. Auto-create a service_tickets row if this estimate is flagged as a repair.
  //     Trigger: proposal_mode contains "repair" OR tags array contains "repair".
  //     Repairs land in AJ's service queue (migration 047), NOT the legacy
  //     crew-tickets table — that's the production-side ticket migration to
  //     finish per the May 10 ticket-board punch list.
  //     Fire-and-forget — don't block the success response if the insert fails.
  const isRepair =
    String(est.proposal_mode || '').toLowerCase().includes('repair') ||
    (Array.isArray(est.tags) && est.tags.some(t => String(t).toLowerCase().includes('repair')));

  if (isRepair) {
    const customerName = customer?.name || est.customer?.full_name || 'customer';
    const customerAddress = est.customer?.address || '';
    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const ticketTitle = `Schedule repair · ${customerName}${customerAddress ? ' · ' + customerAddress : ''}`;
    const ticketDescription = [
      `Repair estimate accepted — ${tier.name || tier.id}.`,
      `Total w/ HST: ${fmtMoney(tierTotalWithTax)}.`,
      `Customer: ${customerName}${customerPayload.phone ? ' · ' + customerPayload.phone : ''}${customerPayload.email ? ' · ' + customerPayload.email : ''}.`,
      `Address: ${customerAddress || '—'}.`,
      `Estimate: PU-${est.estimate_number || est.id.slice(0, 8)}.`,
      `Auto-created on acceptance — AJ to schedule with crew, order materials if needed, confirm timeline with customer.`
    ].join(' ');

    supabaseAdmin
      .from('service_tickets')
      .insert({
        tenant_id: est.tenant_id,
        title: ticketTitle,
        description: ticketDescription,
        source_estimate: est.id,
        customer_id: est.customer_id || null,
        ticket_type: 'repair',
        priority: 'high',
        status: 'open',
        scheduled_at: scheduledAt,
        customer_pays: true,
        metadata: { auto_created_by: 'proposal_accept', source_tags: ['from_proposal_accept'] }
      })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('[proposal-accept] service_ticket insert failed', error?.message);
          return;
        }
        supabaseAdmin.from('activity_log').insert({
          tenant_id: est.tenant_id,
          entity_type: 'service_ticket',
          entity_id: data.id,
          action: 'created',
          details: { source: 'proposal_accept_repair_automation', estimate_id: est.id }
        }).then(() => {}, () => {});
      })
      .catch(e => console.error('[proposal-accept] service_ticket insert threw', e?.message));
  }

  // 5. Run the owner notification + GHL sync to completion BEFORE responding.
  //    On Vercel the function instance is frozen the instant the response is
  //    sent, so any promise still in flight after res.json() is silently killed.
  //    That is exactly why "PROPOSAL ACCEPTED" emails were not arriving: the
  //    Gmail round-trip was started fire-and-forget, then the freeze cut it off
  //    mid-send (the DB write, signature and activity_log all completed because
  //    they run before this point). Awaiting them guarantees delivery. They run
  //    concurrently (latency = the slower one, not the sum) and each is bounded
  //    by a timeout so a slow GHL call can never hang the customer's acceptance.
  //    allSettled: one failing must not swallow the other.
  //    customerPayload was resolved earlier (before the repair-ticket block).
  const withTimeout = (promise, ms, label) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  };

  const [notifyResult, ghlResult] = await Promise.allSettled([
    withTimeout(notifyMackenzie({
      est, tier, financing, customer: customerPayload, rep,
      signatureUrl, tierTotalWithTax,
      acceptedAt: acceptedAt || now,
      refId, shareToken: est.share_token
    }), 8000, 'notify email'),
    withTimeout(fireGhlUpdates({
      est, tier,
      customer: customerPayload,
      tierTotalWithTax,
      signatureUrl
    }), 8000, 'ghl update')
  ]);

  if (notifyResult.status === 'rejected') {
    console.error('[proposal-accept] notify email failed', notifyResult.reason?.message);
  } else {
    console.log('[proposal-accept] notify email sent');
  }
  if (ghlResult.status === 'rejected') {
    console.error('[proposal-accept] ghl update failed', ghlResult.reason?.message);
  } else {
    console.log('[proposal-accept] ghl results', ghlResult.value);
  }

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
