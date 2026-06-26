// ═══════════════════════════════════════════════════════════════
// PURCHASE-ORDERS API — Inventory pillar Phase 3 v1.
//
// Catherine's coordination home. Replaces the spreadsheet + email +
// WhatsApp material-order workflow with persistent state.
//
// GET    /api/purchase-orders                      — list all (most recent first)
// GET    /api/purchase-orders?status=draft         — filter by status
// GET    /api/purchase-orders?merchant_id=X        — filter by supplier
// GET    /api/purchase-orders?estimate_id=X        — filter by job
// GET    /api/purchase-orders?id=X                 — single PO with merchant + estimate joined
// POST   /api/purchase-orders                      — create new (auto-assigns po_number)
// PUT    /api/purchase-orders                      — update fields including status
// DELETE /api/purchase-orders?id=X                 — delete (only allowed when status=draft)
//
// Migration 063 schema: line_items live as JSONB array on the row.
// Status lifecycle: draft → sent → confirmed → partial → received (cancelled possible from any).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function nextPoNumber(tenantId) {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const { data } = await supabaseAdmin
    .from('purchase_orders')
    .select('po_number')
    .eq('tenant_id', tenantId)
    .like('po_number', `${prefix}%`)
    .order('po_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return `${prefix}001`;
  const lastNum = parseInt(String(data.po_number).split('-').pop(), 10) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
}

function computeTotals(lineItems = []) {
  let subtotal = 0;
  for (const it of Array.isArray(lineItems) ? lineItems : []) {
    const q = Number(it.qty || 0);
    const up = Number(it.unit_price || 0);
    const lineTotal = it.line_total != null ? Number(it.line_total) : q * up;
    subtotal += lineTotal;
  }
  return { subtotal: Math.round(subtotal * 100) / 100 };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status, merchant_id, estimate_id, limit } = req.query;

    // Single PO
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('purchase_orders')
        .select('*, merchant:merchants(id, name, city, phone, website), estimate:estimates(id, customer_name, address)')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Purchase order not found' });
      return res.status(200).json(data);
    }

    // List
    let q = supabaseAdmin
      .from('purchase_orders')
      .select('*, merchant:merchants(id, name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (status) {
      const statuses = String(status).split(',').map(s => s.trim()).filter(Boolean);
      q = statuses.length > 1 ? q.in('status', statuses) : q.eq('status', statuses[0]);
    }
    if (merchant_id) q = q.eq('merchant_id', merchant_id);
    if (estimate_id) q = q.eq('estimate_id', estimate_id);
    q = q.limit(Math.min(Number(limit) || 200, 500));

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ purchase_orders: data || [] });
  }

  // ── POST (create) ──
  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.merchant_id) return res.status(400).json({ error: 'merchant_id required' });

    const lineItems = Array.isArray(body.line_items) ? body.line_items : [];
    const { subtotal } = computeTotals(lineItems);
    const taxAmount = body.tax_amount != null ? Number(body.tax_amount) : 0;
    const totalAmount = body.total_amount != null ? Number(body.total_amount) : (subtotal + taxAmount);

    const po_number = body.po_number || await nextPoNumber(tenantId);

    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .insert({
        tenant_id: tenantId,
        po_number,
        merchant_id: body.merchant_id,
        estimate_id: body.estimate_id || null,
        status: body.status || 'draft',
        ordered_at: body.status === 'sent' ? (body.ordered_at || new Date().toISOString()) : (body.ordered_at || null),
        expected_delivery_date: body.expected_delivery_date || null,
        subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        currency: body.currency || 'CAD',
        line_items: lineItems,
        notes: body.notes || null,
        created_by: body.created_by || null,
      })
      .select('*, merchant:merchants(id, name)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT (update) ──
  if (req.method === 'PUT') {
    const body = req.body || {};
    if (!body.id) return res.status(400).json({ error: 'id required' });

    const updates = {};
    const allowed = [
      'merchant_id', 'estimate_id', 'status', 'expected_delivery_date',
      'actual_delivery_date', 'tax_amount', 'total_amount', 'notes',
      'po_number'
    ];
    for (const k of allowed) if (k in body) updates[k] = body[k];

    // Recompute subtotal if line_items provided
    if (Array.isArray(body.line_items)) {
      updates.line_items = body.line_items;
      const { subtotal } = computeTotals(body.line_items);
      updates.subtotal = subtotal;
      if (!('total_amount' in body)) {
        updates.total_amount = subtotal + Number(updates.tax_amount ?? 0);
      }
    }

    // Status-transition timestamps
    if (body.status === 'sent' && !body.ordered_at) {
      updates.ordered_at = new Date().toISOString();
    }
    if (body.status === 'confirmed' && !body.confirmed_at) {
      updates.confirmed_at = new Date().toISOString();
    }
    if (body.status === 'received' && !body.actual_delivery_date) {
      updates.actual_delivery_date = new Date().toISOString().slice(0, 10);
    }

    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .update(updates)
      .eq('id', body.id)
      .eq('tenant_id', tenantId)
      .select('*, merchant:merchants(id, name)')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Purchase order not found' });
    return res.status(200).json(data);
  }

  // ── DELETE (drafts only) ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Only allow delete on drafts — others should use status=cancelled
    const { data: existing } = await supabaseAdmin
      .from('purchase_orders')
      .select('id, status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Purchase order not found' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'Only draft POs can be deleted. Use status=cancelled for sent/confirmed POs.' });
    }

    const { error } = await supabaseAdmin
      .from('purchase_orders')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
