// ═══════════════════════════════════════════════════════════════
// SERVICE-TICKETS — CRUD for AJ's repair / callback / warranty-visit queue.
// GET   /api/service-tickets                — list, filterable
//       ?status=open|scheduled|...
//       ?type=repair|callback|maintenance|warranty_visit|inspection
//       ?assigned_to=<user_id>
// GET   /api/service-tickets?id=<uuid>      — single
// POST  /api/service-tickets                — create
// PUT   /api/service-tickets?id=<uuid>      — update (mark complete, reassign, etc.)
// DELETE /api/service-tickets?id=<uuid>
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, status, type, assigned_to, limit } = req.query;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('service_tickets')
        .select('*, customer:customers(full_name, email, phone, address)')
        .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'ticket not found' });
      return res.status(200).json({ ticket: data });
    }
    let q = supabaseAdmin
      .from('service_tickets')
      .select('*, customer:customers(full_name, phone)')
      .eq('tenant_id', tenantId)
      .order('reported_at', { ascending: false })
      .limit(parseInt(limit) || 200);
    if (status) q = q.eq('status', status);
    if (type) q = q.eq('ticket_type', type);
    if (assigned_to) q = q.eq('assigned_to', assigned_to);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tickets: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ error: 'title required' });
    const { data, error } = await supabaseAdmin
      .from('service_tickets')
      .insert({
        tenant_id: tenantId,
        customer_id: body.customer_id || null,
        source_estimate: body.source_estimate || null,
        ticket_type: body.ticket_type || 'repair',
        priority: body.priority || 'normal',
        status: body.status || 'open',
        title: body.title,
        description: body.description || null,
        scheduled_at: body.scheduled_at || null,
        assigned_to: body.assigned_to || null,
        estimated_cost: body.estimated_cost ?? null,
        customer_pays: body.customer_pays ?? true,
        metadata: body.metadata || {},
        created_by: body.created_by || null
      })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ticket: data });
  }

  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    const update = {};
    for (const k of ['ticket_type','priority','status','title','description','scheduled_at','assigned_to','estimated_cost','actual_cost','customer_pays','metadata']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (update.status === 'complete' && !body.completed_at) update.completed_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('service_tickets').update(update).eq('id', id).eq('tenant_id', tenantId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ticket: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('service_tickets').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
