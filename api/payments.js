// ═══════════════════════════════════════════════════════════════
// /api/payments — canonical payment ledger.
//
//   GET  /api/payments?since_days=90&limit=300&status=matched|unmatched
//   POST /api/payments     — operator-entered payment (source='manual')
//   PATCH /api/payments?id=<uuid>   — update match (e.g. operator
//          reconciles an unmatched row to an estimate)
//
// All writes go here. Sources:
//   - stripe   — api/stripe-webhook.js inserts on checkout.session.completed
//   - gmail    — api/agents/cashflow.js inserts on each parsed payment email
//   - manual   — this endpoint (operator UI)
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';
import { requirePillar } from '../lib/entitlements.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Finance ledger exposes Stripe payment_intent_id and lets the caller
  // fabricate/edit payment rows. Reads + writes are owner/admin only.
  // (requirePortalSessionAndTenant guarantees req.session is set here.)
  if (!isPrivileged(req.session)) {
    return res.status(403).json({ error: 'owner_or_admin_required' });
  }
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const sinceDays = Math.min(parseInt(req.query.since_days, 10) || 90, 365);
    const limit = Math.min(parseInt(req.query.limit, 10) || 300, 1000);
    const status = req.query.status; // optional filter
    const since = new Date(Date.now() - sinceDays * 86400000).toISOString();

    let q = supabaseAdmin
      .from('payments')
      .select('id, payment_date, customer_id, customer_name, matched_estimate_id, amount, invoice_description, payment_method, source, payment_intent_id, status, created_at')
      .eq('tenant_id', tenantId)
      .gte('payment_date', since)
      .order('payment_date', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const stats = {
      total: data.length,
      matched: data.filter(p => p.status === 'matched').length,
      unmatched: data.filter(p => p.status === 'unmatched').length,
      total_amount: data.reduce((s, p) => s + parseFloat(p.amount || 0), 0),
    };
    return res.status(200).json({ payments: data, stats, since_days: sinceDays });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const required = ['payment_date', 'amount'];
    for (const k of required) {
      if (body[k] == null) return res.status(400).json({ error: `${k} required` });
    }

    const insert = {
      tenant_id: tenantId,
      payment_date: body.payment_date,
      customer_id: body.customer_id || null,
      customer_name: body.customer_name || null,
      matched_estimate_id: body.matched_estimate_id || null,
      amount: body.amount,
      invoice_description: body.invoice_description || null,
      payment_method: body.payment_method || 'manual',
      source: 'manual',
      status: body.matched_estimate_id ? 'matched' : 'unmatched',
      created_by: body.created_by || null,
      raw_meta: body.raw_meta || {},
    };

    const { data, error } = await supabaseAdmin
      .from('payments')
      .insert(insert)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ payment: data });
  }

  if (req.method === 'PATCH') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const body = req.body || {};
    const allowed = ['matched_estimate_id', 'customer_id', 'customer_name', 'status', 'invoice_description', 'payment_method'];
    const update = {};
    for (const k of allowed) if (k in body) update[k] = body[k];
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'no allowed fields to update' });

    // If operator just attached an estimate, flip status to matched.
    if (update.matched_estimate_id && !('status' in update)) update.status = 'matched';

    const { data, error } = await supabaseAdmin
      .from('payments')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ payment: data });
  }

  return res.status(405).json({ error: 'GET, POST, PATCH only' });
}

// Wrap order: requirePortalSessionAndTenant first (authenticates the session
// and derives req.tenant from session.tenant_id, ignoring client-supplied
// x-tenant-id/?tenant=), then requirePillar('finance') (reads req.tenant.id).
export default requirePortalSessionAndTenant(requirePillar('finance')(handler));
