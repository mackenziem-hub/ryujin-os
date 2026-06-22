// Ryujin OS - Change Order Acceptance (token-gated, public)
//
//   POST /api/change-order-accept
//   Body: { token, decision: 'accept'|'decline', note? }
//
// No auth header - the accept token is the authentication. The token resolves
// which side (customer or sub) is deciding. We flip THAT side's acceptance,
// recompute the overall status, and let the change_order_log trigger record the
// transition. Per the locked PR2 doctrine this is "record + log only": no
// estimate/paysheet total is rewritten here.

import { supabaseAdmin } from '../lib/supabase.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const MACKENZIE_CONTACT = 'jadj4Jgz8WE9gqheoFeX';

// Best-effort SMS to Mac (mirrors paysheet-accept). Degrades silently if the
// GHL token is missing/expired - never blocks the decision.
async function smsMackenzie(message) {
  const token = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
  if (!token) { console.warn('[change-order-accept] no GHL token, skipping SMS'); return; }
  try {
    await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId: MACKENZIE_CONTACT, message }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) { console.error(`[change-order-accept] SMS failed: ${e.message}`); }
}

const centsToDollars = (v) => (v == null ? null : Number(v) / 100);
const round2 = (n) => Math.round(n * 100) / 100;

// Roll an approved change order's deltas into the live financials: the customer
// delta into the estimate's accepted total, the sub delta into the paysheet (as
// an add_on line + subtotal/total bump that preserves the paysheet's existing
// HST ratio). Once-only: stamps totals_applied_at up front. Best-effort per side
// based on which links the CO carries. This is the PR4 fast-follow to PR2's
// "record + log only" doctrine.
async function applyChangeOrderTotals(co) {
  const out = { estimate: null, paysheet: null };
  const custDelta = centsToDollars(co.price_delta_customer);
  const subDelta = centsToDollars(co.rate_delta_sub);

  // Claim the right to apply (idempotency) before moving any money. The accept
  // single-shot guard already prevents re-accept; this is belt-and-suspenders
  // against a re-trigger.
  const { data: claimed } = await supabaseAdmin
    .from('change_orders')
    .update({ totals_applied_at: new Date().toISOString() })
    .eq('id', co.id).is('totals_applied_at', null)
    .select('id').maybeSingle();
  if (!claimed) return { ...out, skipped: 'already_applied' };

  // Customer side -> estimate accepted total
  if (co.estimate_id && custDelta != null) {
    const { data: est } = await supabaseAdmin
      .from('estimates').select('final_accepted_total').eq('id', co.estimate_id).maybeSingle();
    if (est && typeof est.final_accepted_total === 'number') {
      const to = round2(est.final_accepted_total + custDelta);
      await supabaseAdmin.from('estimates').update({ final_accepted_total: to }).eq('id', co.estimate_id);
      out.estimate = { from: est.final_accepted_total, to };
    }
  }

  // Sub side -> paysheet: append an add_on line + recompute subtotal/hst/total.
  // Keep all THREE persisted columns consistent (subtotal + hst = total), matching
  // the canonical paysheet formula (subcontractor-rates.js: hst = subtotal * 0.15).
  // Preserve whether this paysheet actually carries HST (a non-registered sub may
  // have total == subtotal) so we never invent tax on a no-HST paysheet.
  if (co.paysheet_id && subDelta != null) {
    const { data: ps } = await supabaseAdmin
      .from('paysheets').select('subtotal, hst, total, add_ons').eq('id', co.paysheet_id).maybeSingle();
    if (ps && typeof ps.subtotal === 'number') {
      const addOns = Array.isArray(ps.add_ons) ? ps.add_ons.slice() : [];
      addOns.push({ label: ('Change order: ' + (co.reason || '')).slice(0, 120), qty: 1, rate: subDelta, unit: 'CO', total: subDelta, note: 'CO ' + co.id });
      const newSub = round2(ps.subtotal + subDelta);
      const hadHst = typeof ps.total === 'number' && ps.total > ps.subtotal + 0.001;
      const newHst = hadHst ? round2(newSub * 0.15) : 0;
      const newTotal = round2(newSub + newHst);
      await supabaseAdmin.from('paysheets').update({ add_ons: addOns, subtotal: newSub, hst: newHst, total: newTotal }).eq('id', co.paysheet_id);
      out.paysheet = { subtotal: newSub, hst: newHst, total: newTotal };
    }
  }
  return out;
}

// Recompute the overall CO status from both sides' acceptance.
// not_applicable sides are ignored. Any decline => rejected. All applicable
// accepted => approved. Otherwise pending the side(s) still out.
function computeStatus(cust, sub) {
  if (cust === 'declined' || sub === 'declined') return 'rejected';
  const applicable = [cust, sub].filter((s) => s && s !== 'not_applicable');
  if (applicable.length && applicable.every((s) => s === 'accepted')) return 'approved';
  const pc = cust === 'pending';
  const ps = sub === 'pending';
  if (pc && ps) return 'pending_both';
  if (pc) return 'pending_customer';
  if (ps) return 'pending_sub';
  return 'approved';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { token, decision, note } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Missing token' });
  // Token is interpolated into the PostgREST .or() filter below - constrain it
  // to our base64url generator charset to block filter injection.
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return res.status(404).json({ error: 'Change order not found for this link' });
  }
  if (!['accept', 'decline'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "accept" or "decline"' });
  }

  const { data: co, error: lookupErr } = await supabaseAdmin
    .from('change_orders')
    .select('id, tenant_id, job_id, reason, status, estimate_id, paysheet_id, totals_applied_at, ' +
            'customer_accept_token, customer_accept_status, ' +
            'sub_accept_token, sub_accept_status, price_delta_customer, rate_delta_sub')
    .or(`customer_accept_token.eq.${token},sub_accept_token.eq.${token}`)
    .maybeSingle();

  if (lookupErr) return res.status(500).json({ error: lookupErr.message });
  if (!co) return res.status(404).json({ error: 'Change order not found for this link' });

  const side = co.customer_accept_token === token ? 'customer' : 'sub';
  const curSideStatus = side === 'customer' ? co.customer_accept_status : co.sub_accept_status;

  // Single-shot: only a side that is still pending can decide.
  if (curSideStatus !== 'pending') {
    return res.status(409).json({
      error: 'This change order has already been decided',
      side,
      side_status: curSideStatus,
      overall_status: co.status,
    });
  }

  const target = decision === 'accept' ? 'accepted' : 'declined';
  const decidedAt = new Date().toISOString();
  const decisionNote = (note ? String(note).slice(0, 1000) : null);

  const newCustomer = side === 'customer' ? target : co.customer_accept_status;
  const newSub = side === 'sub' ? target : co.sub_accept_status;
  const newStatus = computeStatus(newCustomer, newSub);

  const updates = { status: newStatus, updated_at: decidedAt };
  if (side === 'customer') {
    updates.customer_accept_status = target;
    updates.customer_decided_at = decidedAt;
    updates.customer_decision_note = decisionNote;
  } else {
    updates.sub_accept_status = target;
    updates.sub_decided_at = decidedAt;
    updates.sub_decision_note = decisionNote;
  }
  if (newStatus === 'approved') updates.approved_at = decidedAt;
  if (newStatus === 'rejected') updates.rejected_at = decidedAt;

  const { error: updErr } = await supabaseAdmin
    .from('change_orders').update(updates).eq('id', co.id);
  if (updErr) return res.status(500).json({ error: 'Update failed', detail: updErr.message });

  // Roll the agreed deltas into the live totals once the CO is fully approved.
  // Best-effort: a roll-up hiccup never fails the (already-committed) acceptance.
  let totals_applied = null;
  if (newStatus === 'approved' && !co.totals_applied_at) {
    totals_applied = await applyChangeOrderTotals(co)
      .catch((e) => { console.error('[change-order-accept] roll-up failed:', e?.message); return { error: e?.message }; });
  }

  // Notify Mac (best-effort).
  const sideDelta = side === 'customer' ? centsToDollars(co.price_delta_customer) : centsToDollars(co.rate_delta_sub);
  const verb = decision === 'accept' ? 'ACCEPTED' : 'DECLINED';
  smsMackenzie(
    `Change order ${verb} by ${side}\n${co.job_id || ''} ${co.reason || ''}`.trim() +
    (sideDelta != null ? `\nDelta: $${sideDelta.toFixed(2)}` : '') +
    `\nNow: ${newStatus}`
  ).catch(() => {});

  return res.status(200).json({
    ok: true,
    side,
    side_status: target,
    overall_status: newStatus,
    decided_at: decidedAt,
    totals_applied,
  });
}
