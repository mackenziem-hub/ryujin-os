// Ryujin OS — Change Orders (authed CRUD)
//
//   GET    /api/change-orders?workorder_id=X   — COs for a job (by job_id=wo)
//          /api/change-orders?estimate_id=X     — COs for an estimate
//          /api/change-orders?paysheet_id=X      — COs for a paysheet
//          /api/change-orders?id=X               — single CO
//   POST   /api/change-orders                    — create a CO (owner)
//   PUT    /api/change-orders                    — owner edit / cancel
//
// Doctrine (PR2, locked with Mac 2026-06-02): "record + log only" — accepting a
// CO flips its status and writes change_order_log (via the DB trigger); it does
// NOT auto-rewrite the estimate accepted total or the paysheet sub pay. That
// reconciliation is a deliberate fast-follow, not this PR.
//
// Linking: change_orders has no workorder_id column. We store the workorder UUID
// in job_id (text) so a job profile can list its COs by job_id, and ALSO stamp
// estimate_id / paysheet_id when known (for the future totals roll-up).
//
// Money: the table stores deltas in CENTS. Callers send/receive DOLLARS; we
// convert at the boundary so the UI never juggles cents.

import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const dollarsToCents = (v) => (v == null || v === '' ? null : Math.round(Number(v) * 100));
const centsToDollars = (v) => (v == null ? null : Number(v) / 100);
const newToken = () => crypto.randomBytes(24).toString('base64url');

// Public-facing columns echoed back to the owner (tokens included so the UI can
// build the accept links). Never expose tokens cross-tenant — requireTenant scopes.
const SELECT_COLS = '*';

// Shape a DB row for the owner UI: cents -> dollars, attach the accept links.
function shapeForOwner(row, origin) {
  if (!row) return row;
  const base = origin || '';
  return {
    ...row,
    price_delta_customer: centsToDollars(row.price_delta_customer),
    rate_delta_sub: centsToDollars(row.rate_delta_sub),
    margin_impact: centsToDollars(row.margin_impact),
    customer_accept_url: row.customer_accept_token ? `${base}/change-order.html?token=${row.customer_accept_token}` : null,
    sub_accept_url: row.sub_accept_token ? `${base}/change-order.html?token=${row.sub_accept_token}` : null,
  };
}

function originOf(req) {
  // Build an absolute origin for accept links. Prefer the request host.
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'ryujin-os.vercel.app').split(',')[0].trim();
  return `${proto}://${host}`;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const origin = originOf(req);

  // ───────── GET ─────────
  if (req.method === 'GET') {
    const { id, workorder_id, estimate_id, paysheet_id } = req.query;
    let q = supabaseAdmin.from('change_orders').select(SELECT_COLS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (id) q = q.eq('id', id);
    else if (workorder_id) q = q.eq('job_id', workorder_id);
    else if (estimate_id) q = q.eq('estimate_id', estimate_id);
    else if (paysheet_id) q = q.eq('paysheet_id', paysheet_id);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const shaped = (data || []).map((r) => shapeForOwner(r, origin));
    return res.json({ change_orders: shaped });
  }

  // ───────── POST (create) ─────────
  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.reason || !String(b.reason).trim()) {
      return res.status(400).json({ error: 'reason required' });
    }

    const priceDeltaCents = dollarsToCents(b.price_delta_customer);
    const rateDeltaCents = dollarsToCents(b.rate_delta_sub);
    const hasCustomer = priceDeltaCents != null;
    const hasSub = rateDeltaCents != null;

    // Resolve estimate/paysheet links from the workorder when only the WO is given.
    let estimateId = b.estimate_id || null;
    let paysheetId = b.paysheet_id || null;
    if (b.workorder_id && (!estimateId || !paysheetId)) {
      const { data: wo } = await supabaseAdmin
        .from('workorders')
        .select('linked_estimate_id, linked_paysheet_id')
        .eq('tenant_id', tenantId).eq('id', b.workorder_id)
        .maybeSingle();
      estimateId = estimateId || wo?.linked_estimate_id || null;
      paysheetId = paysheetId || wo?.linked_paysheet_id || null;
    }

    // Status: pending the side(s) that carry a delta. No deltas -> an
    // informational CO (scope record only) lands 'approved' immediately.
    let status = 'approved';
    if (hasCustomer && hasSub) status = 'pending_both';
    else if (hasCustomer) status = 'pending_customer';
    else if (hasSub) status = 'pending_sub';

    // margin_impact snapshot at creation: customer delta minus sub delta (cents).
    const marginImpact = (hasCustomer || hasSub)
      ? (priceDeltaCents || 0) - (rateDeltaCents || 0)
      : null;

    const row = {
      tenant_id: tenantId,
      estimate_id: estimateId,
      paysheet_id: paysheetId,
      job_id: b.workorder_id || b.job_id || null,
      requested_by: b.requested_by || 'owner',
      source_surface: b.source_surface || 'admin',
      created_by_user_id: req.user?.id || null,
      reason: String(b.reason).trim(),
      scope_before: b.scope_before || null,
      scope_after: b.scope_after || null,
      price_delta_customer: priceDeltaCents,
      customer_accept_token: hasCustomer ? newToken() : null,
      customer_accept_status: hasCustomer ? 'pending' : 'not_applicable',
      rate_delta_sub: rateDeltaCents,
      sub_accept_token: hasSub ? newToken() : null,
      sub_accept_status: hasSub ? 'pending' : 'not_applicable',
      margin_impact: marginImpact,
      status,
    };
    if (status === 'approved') row.approved_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('change_orders').insert(row).select(SELECT_COLS).single();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ change_order: shapeForOwner(data, origin) });
  }

  // ───────── PUT (owner edit / cancel) ─────────
  if (req.method === 'PUT') {
    const b = req.body || {};
    const id = b.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Terminal-state lock: don't let an already-decided CO be re-edited or
    // re-cancelled (would fire a spurious change_order_log transition and rewrite
    // scope text both sides already agreed to). Only draft/pending_* are editable.
    const { data: existing } = await supabaseAdmin
      .from('change_orders').select('status')
      .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Change order not found' });
    if (['approved', 'rejected', 'superseded', 'cancelled'].includes(existing.status)) {
      return res.status(409).json({ error: 'Cannot edit a finalized change order', status: existing.status });
    }

    const updates = { updated_at: new Date().toISOString() };
    // Whitelist owner-editable fields. Never let the client set tokens or
    // acceptance status directly — those move only through the public accept flow.
    if (b.reason != null) updates.reason = String(b.reason).trim();
    if (b.scope_before != null) updates.scope_before = b.scope_before;
    if (b.scope_after != null) updates.scope_after = b.scope_after;
    if (b.status === 'cancelled') { updates.status = 'cancelled'; }

    const { data, error } = await supabaseAdmin
      .from('change_orders').update(updates)
      .eq('tenant_id', tenantId).eq('id', id)
      .select(SELECT_COLS).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ change_order: shapeForOwner(data, origin) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
