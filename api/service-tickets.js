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

// Resolve a routing key ('aj' | 'mac' | 'catherine') to a tenant user.
// Name ilike match first (same idiom as sub-portal QUESTION_ROUTING: 'aj'
// also matches a future 'Arielle' rename), then falls back to the tenant
// owner so a routed ticket never lands on nobody.
async function resolveServiceAssignee(tenantId, key) {
  const patterns = key === 'aj' ? ['aj', 'arielle'] : [String(key || 'mac')];
  const orFilter = patterns.map(n => `name.ilike.%${n}%`).join(',');
  const byName = await supabaseAdmin
    .from('users').select('id, name, role')
    .eq('tenant_id', tenantId).eq('active', true)
    .or(orFilter).limit(1);
  if (byName.data && byName.data.length) return byName.data[0];
  const owner = await supabaseAdmin
    .from('users').select('id, name, role')
    .eq('tenant_id', tenantId).eq('active', true).eq('role', 'owner').limit(1);
  return (owner.data && owner.data[0]) || null;
}

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

    // ── Auto-routing (service_config.auto_route, saved by service-admin.html) ──
    // estimated_cost at or under aj_cap routes to AJ; over the cap, or cost
    // unknown, routes to the configured above-cap assignee (Mac by default)
    // for review. Skipped when the caller already assigned someone.
    // Best-effort: a routing failure never fails the create.
    let ticket = data;
    if (!body.assigned_to) {
      try {
        const { data: ts } = await supabaseAdmin
          .from('tenant_settings').select('service_config')
          .eq('tenant_id', tenantId).maybeSingle();
        const autoRoute = ts?.service_config?.auto_route;
        const cap = Number(autoRoute?.aj_cap);
        if (autoRoute && Number.isFinite(cap)) {
          // Number(null) === 0, which would treat a missing cost as $0 and
          // route to AJ. Unknown cost must fall through to the above-cap
          // reviewer, so map null/undefined to NaN explicitly.
          const cost = ticket.estimated_cost == null ? NaN : Number(ticket.estimated_cost);
          const underCap = Number.isFinite(cost) && cost <= cap;
          const routeKey = underCap ? 'aj' : (autoRoute.default_assignee_above_cap || 'mac');
          const assignee = await resolveServiceAssignee(tenantId, routeKey);
          if (assignee) {
            const upd = await supabaseAdmin
              .from('service_tickets')
              .update({ assigned_to: assignee.id })
              .eq('id', ticket.id).eq('tenant_id', tenantId)
              .select('*').single();
            if (!upd.error && upd.data) ticket = upd.data;
            await supabaseAdmin.from('activity_log').insert({
              tenant_id: tenantId,
              entity_type: 'service_ticket',
              entity_id: ticket.id,
              action: 'auto_routed',
              details: {
                assigned_to: assignee.id,
                assignee_name: assignee.name,
                route: routeKey,
                estimated_cost: Number.isFinite(cost) ? cost : null,
                aj_cap: cap
              }
            });
          }
        }
      } catch { /* best-effort: never block ticket creation on routing */ }
    }
    return res.status(201).json({ ticket });
  }

  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    const update = {};
    // customer_id + source_estimate added so the ticket-modal dropdowns work
    // in edit mode too. acknowledged_at is caller-opt-in only (column lands
    // with migration 097; writing it unconditionally would 500 every PUT
    // until that migration is applied).
    for (const k of ['ticket_type','priority','status','title','description','scheduled_at','assigned_to','estimated_cost','actual_cost','customer_pays','metadata','customer_id','source_estimate','acknowledged_at']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (update.status === 'complete' && !body.completed_at) update.completed_at = new Date().toISOString();

    // ── Escalate to Mac: priority high + assign the tenant owner ──
    let escalatedTo = null;
    if (body.escalate === true) {
      escalatedTo = await resolveServiceAssignee(tenantId, 'mac');
      update.priority = 'high';
      if (escalatedTo) update.assigned_to = escalatedTo.id;
    }

    const { data, error } = await supabaseAdmin
      .from('service_tickets').update(update).eq('id', id).eq('tenant_id', tenantId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    if (body.escalate === true) {
      await supabaseAdmin.from('activity_log').insert({
        tenant_id: tenantId,
        entity_type: 'service_ticket',
        entity_id: data.id,
        action: 'escalated',
        details: {
          priority: 'high',
          assigned_to: escalatedTo?.id || null,
          assignee_name: escalatedTo?.name || null
        }
      });
    }
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
