// Ryujin OS — Tickets CRUD + Calendar + Metrics
// GET    /api/tickets                — List tickets (filterable by user, status, project)
// GET    /api/tickets?id=X           — Get single ticket
// GET    /api/tickets?view=calendar  — Calendar format (date-grouped)
// GET    /api/tickets?view=metrics   — Performance metrics for a user
// POST   /api/tickets                — Create ticket
// PUT    /api/tickets                — Update ticket (acknowledge, complete, reassign)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { id, view, assigned_to, status, project_id, limit = 50, offset = 0, from, to } = req.query;

    // Single ticket
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('tickets')
        .select(`
          *,
          assigned_user:users!tickets_assigned_to_fkey(id, name, avatar_url),
          project:projects(id, name, address),
          customer:customers(full_name, phone, address)
        `)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'Ticket not found' });
      return res.json(data);
    }

    // Calendar view — grouped by date for a user
    if (view === 'calendar') {
      if (!assigned_to) return res.status(400).json({ error: 'assigned_to required for calendar view' });

      let query = supabaseAdmin
        .from('tickets')
        .select('id, ticket_number, title, status, priority, due_date, project:projects(name, address)')
        .eq('tenant_id', tenantId)
        .eq('assigned_to', assigned_to)
        .neq('status', 'cancelled')
        .order('due_date', { ascending: true });

      if (from) query = query.gte('due_date', from);
      if (to) query = query.lte('due_date', to);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      // Group by date
      const grouped = {};
      for (const t of (data || [])) {
        const day = t.due_date || 'unscheduled';
        if (!grouped[day]) grouped[day] = [];
        grouped[day].push(t);
      }

      return res.json({ calendar: grouped });
    }

    // Metrics view — performance stats for a user
    if (view === 'metrics') {
      if (!assigned_to) return res.status(400).json({ error: 'assigned_to required for metrics view' });

      const { data: all } = await supabaseAdmin
        .from('tickets')
        .select('id, status, due_date, created_at, updated_at, completed_at')
        .eq('tenant_id', tenantId)
        .eq('assigned_to', assigned_to);

      const tickets = all || [];
      const total = tickets.length;
      const done = tickets.filter(t => t.status === 'done');
      const completionRate = total > 0 ? Math.round((done.length / total) * 100) : 0;

      // On-time: completed_at <= due_date (end of day)
      const onTime = done.filter(t => {
        if (!t.due_date || !t.completed_at) return false;
        return new Date(t.completed_at) <= new Date(t.due_date + 'T23:59:59');
      });
      const onTimeRate = done.length > 0 ? Math.round((onTime.length / done.length) * 100) : 0;

      // Average completion time (created → completed, in hours)
      const completionTimes = done
        .filter(t => t.completed_at && t.created_at)
        .map(t => (new Date(t.completed_at) - new Date(t.created_at)) / (1000 * 60 * 60));
      const avgCompletionHours = completionTimes.length > 0
        ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length * 10) / 10
        : null;

      // This week / this month
      const now = new Date();
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const doneThisWeek = done.filter(t => t.completed_at && new Date(t.completed_at) >= weekAgo).length;
      const doneThisMonth = done.filter(t => t.completed_at && new Date(t.completed_at) >= monthAgo).length;
      const lateCount = done.length - onTime.length;

      return res.json({
        metrics: {
          total,
          completed: done.length,
          completionRate: `${completionRate}%`,
          onTimeRate: `${onTimeRate}%`,
          avgCompletionHours,
          doneThisWeek,
          doneThisMonth,
          lateCount,
          open: tickets.filter(t => t.status === 'open').length,
          active: tickets.filter(t => t.status === 'active').length
        }
      });
    }

    // Standard list
    let query = supabaseAdmin
      .from('tickets')
      .select(`
        *,
        assigned_user:users!tickets_assigned_to_fkey(id, name),
        project:projects(id, name, address)
      `, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (status) query = query.eq('status', status);
    if (project_id) query = query.eq('project_id', project_id);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ tickets: data, total: count });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .insert({
        tenant_id: tenantId,
        title: body.title,
        description: body.description,
        estimate_id: body.estimate_id || null,
        customer_id: body.customer_id || null,
        project_id: body.project_id || null,
        assigned_to: body.assigned_to || null,
        priority: body.priority || 'medium',
        status: body.assigned_to ? 'open' : 'open',
        due_date: body.due_date || null,
        tags: body.tags || [],
        notes: body.notes || []
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'ticket',
      entity_id: data.id,
      action: 'created',
      details: { title: body.title, assigned_to: body.assigned_to, due_date: body.due_date }
    });

    return res.status(201).json(data);
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    const { id, action, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Handle specific actions
    if (action === 'acknowledge') {
      updates.status = 'active';
    } else if (action === 'complete') {
      updates.status = 'done';
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'ticket',
      entity_id: id,
      action: action || 'updated',
      details: action ? { action } : { fields: Object.keys(updates) }
    });

    return res.json(data);
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { error } = await supabaseAdmin
      .from('tickets')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'ticket',
      entity_id: id,
      action: 'deleted',
      details: {}
    });

    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
