// Ryujin OS - Proposal v2 Acceptance Endpoint
//
// POST /api/proposal-v2-accept
// Body: { instanceSlug | shareToken | estimateId, selectedTier, selectedAddons:[], signature, acceptedName }
//
// Two acceptance paths, resolved from a single proposal_instances row
// (migration 091) plus the optional estimate it links to:
//
//   1. ESTIMATE-BACKED - the instance has an estimate_id, OR the caller
//      passed an estimateId / a shareToken that resolves an estimates row.
//      We DELEGATE to api/proposal-accept.js's default handler so the
//      migration-038 state machine writes, the GHL stage move + contact note,
//      the owner email, and the repair-ticket auto-create all run exactly
//      once, from one place. We do NOT re-implement any of that here.
//      If a proposal_instances row is also present, it's marked accepted as a
//      thin mirror after the estimate path succeeds.
//
//   2. STANDALONE - a proposal_instances row with no estimate (custom scope,
//      repair, info-only). There is no estimate to run the state machine on,
//      so we freeze the instance in place: status='accepted', accepted_at=now,
//      accepted_payload=<the post>, locked_at=now - and fire the same owner
//      email + GHL contact note helpers the estimate path uses, adapted to the
//      instance row.
//
// Public endpoint (no auth header). The instance slug / share_token is the
// authentication, mirroring proposal-accept.js + custom-proposal-accept.js.

import { supabaseAdmin } from '../lib/supabase.js';
import { notifyLeadEvent } from '../lib/leadNotify.js';
import { fireSignFanout } from '../lib/fireSignFanout.js';
import { isMetalSlug } from '../lib/metalProposalCopy.js';
// Shared with the assembler so a metal accept can re-derive the panel price
// SERVER-side when the frozen snapshot does not carry panelPrices. We never
// trust a client-posted dollar.
import { metalPanelPrices, metalGradeForTier, METAL_DEFAULT_PANEL } from './proposal-v2.js';
// Reuse the estimate-backed acceptance pipeline wholesale. This handler runs
// the share-token auth, migration-038 state machine, GHL updates, owner email,
// and repair-ticket auto-create. We never duplicate that logic.
import estimateAccept from './proposal-accept.js';

const SITE_BASE = (process.env.SITE_BASE || 'https://ryujin-os.vercel.app').trim();
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || '').trim();
const GHL_VERSION = '2021-07-28';

function fmtMoney(n) {
  if (n == null) return 'n/a';
  return '$' + Number(n).toLocaleString('en-CA', { maximumFractionDigits: 0 });
}

// Mirror of proposal-accept.js ghlCall - same auth/version headers, same
// error surfacing. Kept local so the standalone path can drop a contact note
// without importing module-private helpers.
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

// Pull a human-readable customer + total out of the instance row. Standalone
// instances carry their own resolved variables + pricing_snapshot (migration
// 091); fall back to the joined customer record.
function instanceCustomer(inst) {
  const v = inst.variables && typeof inst.variables === 'object' ? inst.variables : {};
  const c = inst.customer || {};
  return {
    name: v.customer_name || v.customerName || c.full_name || '',
    email: v.customer_email || v.customerEmail || c.email || '',
    phone: v.customer_phone || v.customerPhone || c.phone || '',
    address: v.address || v.customer_address || c.address || ''
  };
}

// Apply HST + $25 rounding exactly the way proposal-v2.html's renderer does:
// display = round-to-nearest-$25( preTax × (1 + taxRate) ).
function withHstRounded(preTax, taxRate) {
  const rate = Number(taxRate) > 0 && Number(taxRate) < 1 ? Number(taxRate) : 0.15;
  return Math.round((Number(preTax) || 0) * (1 + rate) / 25) * 25;
}

// Resolve the accepted total (incl HST where available) from the frozen
// pricing_snapshot, scoped to the selected tier when the snapshot is tiered.
// selectedPanel is the metal panel KEY ('flat'|'wavy'|'stand'), never a price.
function instanceAcceptedTotal(inst, selectedTier, selectedPanel) {
  const ps = inst.pricing_snapshot && typeof inst.pricing_snapshot === 'object' ? inst.pricing_snapshot : {};
  const taxRate = ps.taxRate;
  // Tiered snapshot: tiers may be an array of {id,...} (live builder shape) or an
  // object keyed by tier id. Resolve the selected tier from either.
  if (selectedTier && ps.tiers) {
    const t = Array.isArray(ps.tiers)
      ? ps.tiers.find(x => x && x.id === selectedTier)
      : ps.tiers[selectedTier];
    if (t) {
      // METAL: the signed number is panelPrices[panel] (PRE-TAX). Apply HST +
      // $25 rounding the same way the renderer did so the recorded total matches
      // what the customer saw. Never trust a client dollar.
      if (t.panelPrices && typeof t.panelPrices === 'object') {
        const def = ps.defaultPanel || METAL_DEFAULT_PANEL;
        const panel = selectedPanel || def;
        const base = Number(t.panelPrices[panel] ?? t.panelPrices[def] ?? t.panelPrices[METAL_DEFAULT_PANEL]);
        if (base > 0) return withHstRounded(base, taxRate);
      }
      return Number(t.totalWithTax ?? t.total_incl_hst ?? t.total) || 0;
    }
  }
  return Number(ps.totalWithTax ?? ps.total_incl_hst ?? ps.total ?? ps.grandTotal) || 0;
}

async function notifyOwnerStandalone({ inst, customer, total, selectedTier, selectedAddons, acceptedName, acceptedAt }) {
  const publicUrl = `${SITE_BASE}/proposals/${encodeURIComponent(inst.slug)}`;
  const addonLine = Array.isArray(selectedAddons) && selectedAddons.length
    ? selectedAddons.map(a => (typeof a === 'string' ? a : (a.label || a.slug || ''))).filter(Boolean).join(', ')
    : '';

  const subject = `PROPOSAL ACCEPTED · ${customer.name || 'Customer'}${selectedTier ? ' · ' + selectedTier : ''} · ${fmtMoney(total)}`;
  const lines = [
    `${acceptedName || customer.name || 'A customer'} just accepted proposal ${inst.slug}.`,
    ``,
    selectedTier ? `Tier:     ${selectedTier}` : '',
    addonLine ? `Add-ons:  ${addonLine}` : '',
    total ? `Total:    ${fmtMoney(total)}` : '',
    ``,
    `Customer: ${customer.name || 'n/a'}`,
    `Email:    ${customer.email || 'n/a'}`,
    `Phone:    ${customer.phone || 'n/a'}`,
    `Address:  ${customer.address || 'n/a'}`,
    `Signed:   ${acceptedAt}`,
    ``,
    `Proposal: ${publicUrl}`,
    ``,
    `Ryujin OS`
  ].filter(Boolean);

  // Unified spine: same email content + durable inbox ping + direct owner SMS.
  // Standalone v2 proposals have no estimate and usually no GHL opp, so dedup on
  // the opp id when present else the instance id (stable uuid).
  return notifyLeadEvent({
    tenantId: inst.tenant_id,
    event: 'won',
    title: subject,
    body: lines.join('\n'),
    contactName: customer.name || null,
    ghlContactId: inst.ghl_contact_id || inst.customer?.ghl_contact_id || null,
    urgency: 'high',
    dedupeKey: inst.ghl_opportunity_id || inst.id,
    sms: true,
  });
}

async function fireGhlStandalone({ inst, customer, total, selectedTier }) {
  const contactId = inst.ghl_contact_id || inst.customer?.ghl_contact_id || null;
  if (!contactId) return { skipped: 'no_ghl_contact_on_instance' };
  const noteBody = [
    `PROPOSAL ACCEPTED - ${inst.slug}${selectedTier ? ' · ' + selectedTier : ''}`,
    total ? `Total: ${fmtMoney(total)}` : '',
    `Customer: ${customer.name || 'n/a'}`
  ].filter(Boolean).join('\n');
  try {
    await ghlCall(`/contacts/${contactId}/notes`, { method: 'POST', body: { body: noteBody } });
    return { contactNote: 'ok' };
  } catch (e) {
    return { contactNote: 'error_' + (e.message || 'unknown').substring(0, 120) };
  }
}

// Invoke proposal-accept.js's default handler in-process with a synthesized
// req/res so the full estimate acceptance pipeline runs without an HTTP hop.
// Returns { status, body } from whatever that handler responded with.
function delegateToEstimateAccept(syntheticBody) {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', body: syntheticBody, headers: {}, query: {} };
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { resolve({ status: statusCode, body: payload }); return this; },
      end() { resolve({ status: statusCode, body: null }); return this; },
      setHeader() { return this; }
    };
    Promise.resolve()
      .then(() => estimateAccept(req, res))
      .catch(reject);
  });
}

// Build the tier object proposal-accept.js expects ({ id, name, sub, total,
// totalWithTax }) from the estimate's frozen calculated_packages + the
// customer's selected tier.
function buildTierForEstimate(est, selectedTier) {
  const id = String(selectedTier || est?.selected_package || 'platinum').toLowerCase();
  const pkgs = est?.calculated_packages && typeof est.calculated_packages === 'object' ? est.calculated_packages : {};
  const pkg = pkgs[id] || {};
  const summary = pkg.summary || {};
  const total = Number(pkg.total ?? summary.sellingPrice ?? 0) || 0;
  const tier = { id, total };
  if (pkg.totalWithTax != null) tier.totalWithTax = Number(pkg.totalWithTax);
  if (pkg.name) tier.name = pkg.name;
  return tier;
}

// Locate the tiers array + the path/products default panel in a frozen instance
// snapshot. pricing_snapshot mirrors data.products; fall back to data_snapshot.
function frozenProducts(inst) {
  const ps = inst?.pricing_snapshot && typeof inst.pricing_snapshot === 'object' ? inst.pricing_snapshot : null;
  if (ps && (Array.isArray(ps.tiers) || ps.twoPath || ps.panels)) return ps;
  const ds = inst?.data_snapshot && typeof inst.data_snapshot === 'object' ? inst.data_snapshot : null;
  if (ds && ds.products && typeof ds.products === 'object') return ds.products;
  return ps || {};
}

// Walk a frozen products object for a tier by id, across the top-level ladder,
// any two_path paths, and variant cards. Returns the tier object or null.
function findFrozenTier(products, tierId) {
  if (!products || !tierId) return null;
  const id = String(tierId);
  const scan = (tiers) => {
    if (!Array.isArray(tiers)) return null;
    for (const t of tiers) {
      if (!t) continue;
      if (t.id === id) return t;
      if (Array.isArray(t.variants)) {
        const v = t.variants.find(x => x && x.id === id);
        if (v) return v;
      }
    }
    return null;
  };
  return scan(products.tiers)
    || (products.twoPath && (scan(products.twoPath.a?.tiers) || scan(products.twoPath.b?.tiers)))
    || null;
}

// SERVER-AUTHORITATIVE metal total. The signed metal price is the panel-priced
// pre-tax base (panelPrices[panel]), NOT calculated_packages. Resolve it from
// the FROZEN snapshot first (the exact number the customer saw + signed); if the
// instance was never materialized with panelPrices, recompute it server-side via
// the same metalPanelPrices() formula from the estimate. The posted `panel` is a
// KEY ('flat'|'wavy'|'stand'), never a dollar; we never trust a client price.
// Returns the PRE-TAX base, or 0 when it cannot be resolved.
function resolveMetalAcceptedBase(inst, est, tierId, panelKey) {
  const products = frozenProducts(inst);
  const t = findFrozenTier(products, tierId);
  const def = (products && (products.defaultPanel
    || (products.twoPath && (products.twoPath.a?.defaultPanel || products.twoPath.b?.defaultPanel))))
    || METAL_DEFAULT_PANEL;
  const panel = panelKey || def || METAL_DEFAULT_PANEL;

  // 1. Frozen snapshot panelPrices (preferred): the exact pre-tax base shown.
  if (t && t.panelPrices && typeof t.panelPrices === 'object') {
    const v = Number(t.panelPrices[panel] ?? t.panelPrices[def] ?? t.panelPrices[METAL_DEFAULT_PANEL]);
    if (v > 0) return v;
  }

  // 2. Fallback: recompute server-side from the estimate (never the client).
  if (est) {
    const grade = metalGradeForTier(tierId);
    const prices = metalPanelPrices(est, grade);
    if (prices) {
      const v = Number(prices[panel] ?? prices[def] ?? prices[METAL_DEFAULT_PANEL]);
      if (v > 0) return v;
    }
  }

  // 3. Last resort: the frozen tier.total (already a server-frozen pre-tax base).
  if (t && Number(t.total) > 0) return Number(t.total);
  return 0;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body && typeof req.body === 'object'
    ? req.body
    : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();

  const instanceSlug = String(body.instanceSlug || '').trim();
  const shareToken = String(body.shareToken || '').trim();
  const estimateId = String(body.estimateId || '').trim();
  // Tier id arrives as selectedTier (this endpoint's documented shape) OR as
  // tierId / tier.id (the proposal-v2.html accept POST). Accept all three.
  const selectedTier = (() => {
    const raw = body.selectedTier ?? body.tierId ?? (body.tier && body.tier.id);
    return raw ? String(raw).trim() : null;
  })();
  // Panel is a KEY ('flat'|'wavy'|'stand'), never a price. Used only to look up a
  // SERVER-side pre-tax base; the dollar is resolved server-authoritatively.
  const selectedPanel = body.panel ? String(body.panel).trim() : null;
  const selectedAddons = Array.isArray(body.selectedAddons) ? body.selectedAddons : [];
  const signature = typeof body.signature === 'string' ? body.signature : null;
  const acceptedName = body.acceptedName ? String(body.acceptedName).trim() : '';
  const now = new Date().toISOString();

  if (!instanceSlug && !shareToken && !estimateId) {
    return res.status(400).json({ error: 'instanceSlug, shareToken, or estimateId required' });
  }

  // ── 1. Resolve the proposal_instances row (if any) ──────────────────────
  // Try slug, then the instance's own share_token, then estimate linkage.
  let inst = null;
  if (instanceSlug || shareToken || estimateId) {
    let q = supabaseAdmin
      .from('proposal_instances')
      .select('*, customer:customers(full_name, email, phone, address, ghl_contact_id)')
      .limit(1);
    if (instanceSlug) q = q.eq('slug', instanceSlug);
    else if (shareToken) q = q.eq('share_token', shareToken);
    else q = q.eq('estimate_id', estimateId);
    const { data, error } = await q.maybeSingle();
    if (error) console.warn('[proposal-v2-accept] instance lookup error', error.message);
    inst = data || null;
  }

  // ── 2. Decide the path ──────────────────────────────────────────────────
  // Estimate-backed if the instance links an estimate, OR the caller gave us
  // an estimateId / shareToken that maps to an estimates row directly (no v2
  // instance yet - older proposals).
  const linkedEstimateId = inst?.estimate_id || (estimateId || null);

  // Resolve the estimate's OWN share_token (proposal-accept.js authenticates
  // by the ESTIMATE share token, which differs from the instance share_token).
  let estShareToken = null;
  let est = null;
  if (linkedEstimateId) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, share_token, selected_package, calculated_packages')
      .eq('id', linkedEstimateId)
      .maybeSingle();
    est = data || null;
    estShareToken = est?.share_token || null;
  }
  // Caller passed a shareToken that did NOT resolve a v2 instance - it may be
  // an estimate share token. Probe estimates directly.
  if (!est && !inst && shareToken) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id, share_token, selected_package, calculated_packages')
      .eq('share_token', shareToken)
      .maybeSingle();
    if (data) {
      est = data;
      estShareToken = data.share_token;
    }
  }

  const isEstimateBacked = !!estShareToken;

  // ── 3a. ESTIMATE-BACKED → delegate to proposal-accept.js ────────────────
  if (isEstimateBacked) {
    const tier = buildTierForEstimate(est, selectedTier);

    // METAL: the signed price is the panel-priced pre-tax base (panelPrices[panel]),
    // which does NOT live in calculated_packages. Resolve it SERVER-side from the
    // frozen snapshot (else recompute) and hand it to the delegate as a trusted
    // server base so the recorded/email/GHL/contract total matches what the
    // customer saw and signed. Asphalt/shingle tiers fall through unchanged and
    // keep recomputing from calculated_packages inside proposal-accept.js.
    let metalServerBase = 0;
    if (isMetalSlug(tier.id)) {
      metalServerBase = resolveMetalAcceptedBase(inst, est, tier.id, selectedPanel);
      if (metalServerBase > 0) {
        tier.total = metalServerBase;            // pre-tax base, server-resolved
        delete tier.totalWithTax;                // let the delegate re-derive HST
      }
    }

    const syntheticBody = {
      shareToken: estShareToken,                 // estimate's token - the auth
      estimateId: est.id,
      tier,
      // Trusted server-resolved metal pre-tax base. proposal-accept.js honors
      // this ONLY for metal slugs with no calculated_packages entry, so a public
      // client cannot use it to override an asphalt package price.
      serverTierBase: metalServerBase > 0 ? metalServerBase : undefined,
      selectedAddons,
      signature,
      acceptedAt: now,
      customer: acceptedName ? { name: acceptedName } : undefined,
      rep: undefined,
      financing: body.financing || null
    };

    let delegated;
    try {
      delegated = await delegateToEstimateAccept(syntheticBody);
    } catch (e) {
      console.error('[proposal-v2-accept] estimate delegation threw', e?.message);
      return res.status(500).json({ error: 'estimate_accept_failed', detail: e?.message });
    }

    if (!delegated || delegated.status >= 400) {
      return res.status(delegated?.status || 500).json(delegated?.body || { error: 'estimate_accept_failed' });
    }

    // Thin-mirror the v2 instance row to accepted so /proposals/<slug> shows the
    // frozen accepted state too. The estimate path already fired all side
    // effects - this is purely the instance's display state. Fire-and-forget.
    if (inst && inst.status !== 'accepted') {
      supabaseAdmin
        .from('proposal_instances')
        .update({
          status: 'accepted',
          accepted_at: now,
          accepted_payload: { ...body, _delegated_to: 'proposal-accept', _estimate_id: est.id, _accepted_at: now },
          locked_at: inst.locked_at || now
        })
        .eq('id', inst.id)
        .then(({ error }) => { if (error) console.warn('[proposal-v2-accept] instance mirror update failed', error.message); });
    }

    return res.status(200).json({
      ok: true,
      mode: 'estimate',
      estimateId: est.id,
      instanceSlug: inst?.slug || null,
      delegated: delegated.body || null,
      signatureUrl: delegated.body?.signatureUrl || null
    });
  }

  // ── 3b. STANDALONE proposal_instances row ───────────────────────────────
  if (!inst) {
    return res.status(404).json({ error: 'No proposal found for that slug/shareToken/estimateId' });
  }

  // Idempotency: if already accepted, don't re-fire side effects.
  if (inst.status === 'accepted') {
    return res.status(200).json({
      ok: true,
      mode: 'standalone',
      instanceSlug: inst.slug,
      already_accepted: true
    });
  }

  const customer = instanceCustomer(inst);
  const total = instanceAcceptedTotal(inst, selectedTier, selectedPanel);

  const acceptedPayload = {
    ...body,
    selectedTier: selectedTier || null,
    selectedAddons,
    acceptedName: acceptedName || customer.name || null,
    signature: signature || null,
    accepted_total: total || null,
    accepted_at: now
  };

  // Freeze the instance: accepted + snapshot the post + lock. Race-safe: only
  // flip if not already accepted (mirrors custom-proposal-accept.js gate).
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('proposal_instances')
    .update({
      status: 'accepted',
      accepted_at: now,
      accepted_payload: acceptedPayload,
      locked_at: inst.locked_at || now
    })
    .eq('id', inst.id)
    .neq('status', 'accepted')
    .select('id')
    .maybeSingle();

  if (updateErr) {
    console.error('[proposal-v2-accept] instance accept update failed', updateErr.message);
    return res.status(500).json({ error: 'instance_update_failed', detail: updateErr.message });
  }
  if (!updated) {
    // Lost the race - another request accepted it between our read and write.
    return res.status(200).json({ ok: true, mode: 'standalone', instanceSlug: inst.slug, already_accepted: true });
  }

  // Activity log for audit trail (mirrors proposal-accept.js).
  supabaseAdmin.from('activity_log').insert({
    tenant_id: inst.tenant_id,
    entity_type: 'proposal_instance',
    entity_id: inst.id,
    action: 'accepted',
    details: {
      slug: inst.slug,
      selected_tier: selectedTier || null,
      selected_addons: selectedAddons,
      total,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      accepted_name: acceptedName || null,
      accepted_at: now
    }
  }).then(r => { if (r.error) console.error('[proposal-v2-accept] activity_log insert failed', r.error.message); });

  // Fire-and-forget notifications - never block the success response. The
  // acceptance is already committed above.
  notifyOwnerStandalone({ inst, customer, total, selectedTier, selectedAddons, acceptedName, acceptedAt: now })
    .catch(e => console.error('[proposal-v2-accept] standalone notify failed', e?.message));

  fireGhlStandalone({ inst, customer, total, selectedTier })
    .then(r => console.log('[proposal-v2-accept] ghl standalone result', r))
    .catch(e => console.error('[proposal-v2-accept] ghl standalone failed', e?.message));

  // Sign choreography (intercom fan-out) for a standalone proposal signing.
  // Awaited (Vercel freezes the lambda after res.json) but fail-soft + idempotent,
  // so it can never break the acceptance. estimate_id may be null here (standalone);
  // executeSignFanout UUID-guards it.
  await fireSignFanout({
    tenantId: inst.tenant_id,
    customer: customer.name || null,
    address: customer.address || null,
    phone: customer.phone || null,
    total: total || null,
    estimateId: inst.estimate_id || null,
    scopeSummary: selectedTier || null,
  });

  return res.status(200).json({
    ok: true,
    mode: 'standalone',
    instanceSlug: inst.slug,
    status: 'accepted',
    total: total || null
  });
}

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
