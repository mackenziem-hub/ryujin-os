// Ryujin OS — Work Orders CRUD
// GET    /api/workorders                 — list
// GET    /api/workorders?id=X            — single
// POST   /api/workorders                 — create
// PUT    /api/workorders                 — update
// DELETE /api/workorders?id=X            — cancel
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, status, limit = 100, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('workorders')
        .select('*, estimate:estimates(estimate_number,share_token), paysheet:paysheets(job_id,status,total)')
        .eq('tenant_id', tenantId).eq('id', id).single();
      if (error) return res.status(404).json({ error: 'Work order not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('workorders')
      .select('*, estimate:estimates(estimate_number,share_token), paysheet:paysheets(job_id,status)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('start_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'cancelled');

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ workorders: data, total: count });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const row = { tenant_id: tenantId, ...body };
    const { data, error } = await supabaseAdmin.from('workorders').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('workorders').update(updates)
      .eq('id', id).eq('tenant_id', tenantId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // Sync linked pay sheet status if status was changed
    if (updates.status && data.linked_paysheet_id) {
      const WO_TO_PS = {
        'draft': 'scheduled', 'issued': 'scheduled',
        'in_progress': 'in_progress', 'complete': 'completed', 'cancelled': 'cancelled'
      };
      const psStatus = WO_TO_PS[updates.status];
      if (psStatus) {
        const psUpdate = { status: psStatus, updated_at: new Date().toISOString() };
        if (psStatus === 'completed') psUpdate.completed_date = new Date().toISOString().slice(0,10);
        await supabaseAdmin.from('paysheets').update(psUpdate)
          .eq('id', data.linked_paysheet_id).eq('tenant_id', tenantId);
      }
    }

    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { error } = await supabaseAdmin
      .from('workorders').update({ status: 'cancelled' })
      .eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'cancelled', id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
