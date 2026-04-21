// Ryujin OS — Pay Sheets CRUD
// GET    /api/paysheets                  — list all (with filters)
// GET    /api/paysheets?id=X             — single pay sheet
// GET    /api/paysheets?job_id=PU-...    — lookup by job id
// POST   /api/paysheets                  — create
// PUT    /api/paysheets                  — update (pass {id, ...updates})
// DELETE /api/paysheets?id=X             — soft delete (status=cancelled)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, job_id, status, limit = 100, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('paysheets')
        .select('*, estimate:estimates(id,estimate_number,share_token)')
        .eq('tenant_id', tenantId).eq('id', id).single();
      if (error) return res.status(404).json({ error: 'Pay sheet not found' });
      return res.json(data);
    }

    if (job_id) {
      const { data, error } = await supabaseAdmin
        .from('paysheets').select('*')
        .eq('tenant_id', tenantId).eq('job_id', job_id).single();
      if (error) return res.status(404).json({ error: 'Pay sheet not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('paysheets')
      .select('*, estimate:estimates(estimate_number,share_token)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'cancelled');

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ paysheets: data, total: count });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const row = { tenant_id: tenantId, ...body };
    const { data, error } = await supabaseAdmin.from('paysheets').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('paysheets').update(updates)
      .eq('id', id).eq('tenant_id', tenantId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });

    // Sync linked work order status if pay sheet status changed
    if (updates.status) {
      const PS_TO_WO = {
        'scheduled': 'issued', 'in_progress': 'in_progress',
        'completed': 'complete', 'invoice_final': 'complete', 'cancelled': 'cancelled'
      };
      const woStatus = PS_TO_WO[updates.status];
      if (woStatus) {
        const { data: linked } = await supabaseAdmin
          .from('workorders').select('id,status')
          .eq('tenant_id', tenantId).eq('linked_paysheet_id', id);
        if (linked && linked.length) {
          const woUpdate = { status: woStatus, updated_at: new Date().toISOString() };
          if (woStatus === 'complete') woUpdate.completed_at = new Date().toISOString();
          await supabaseAdmin.from('workorders').update(woUpdate)
            .eq('tenant_id', tenantId).eq('linked_paysheet_id', id);
        }
      }
    }

    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { error } = await supabaseAdmin
      .from('paysheets').update({ status: 'cancelled' })
      .eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'cancelled', id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
