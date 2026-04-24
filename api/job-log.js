// Ryujin OS — Per-Job Log Entries
//
// GET    /api/job-log?workorder_id=X          — entries for a WO
// GET    /api/job-log?sub_id=X&status=pending — entries by sub (used by sub portal)
// GET    /api/job-log?status=pending          — owner approval queue
// POST   /api/job-log                         — create entry (sub or owner)
// PUT    /api/job-log                         — update entry (owner: approve/deny, editor: edit)
// DELETE /api/job-log?id=X                    — owner delete

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { workorder_id, sub_id, paysheet_id, status, limit = 100 } = req.query;
    let q = supabaseAdmin
      .from('job_log_entries')
      .select('*, workorder:workorders(id, wo_number, address, customer_name), subcontractor:subcontractors(id, name, company)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));
    if (workorder_id) q = q.eq('workorder_id', workorder_id);
    if (sub_id) q = q.eq('subcontractor_id', sub_id);
    if (paysheet_id) q = q.eq('paysheet_id', paysheet_id);
    if (status) q = q.eq('status', status);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.workorder_id || !body.entry_type || !body.description) {
      return res.status(400).json({ error: 'workorder_id, entry_type, description required' });
    }

    // Auto-link paysheet if not provided
    let paysheet_id = body.paysheet_id;
    if (!paysheet_id) {
      const { data: wo } = await supabaseAdmin
        .from('workorders')
        .select('linked_paysheet_id')
        .eq('tenant_id', tenantId).eq('id', body.workorder_id)
        .single();
      paysheet_id = wo?.linked_paysheet_id || null;
    }

    const row = {
      tenant_id: tenantId,
      workorder_id: body.workorder_id,
      paysheet_id,
      subcontractor_id: body.subcontractor_id || null,
      entry_type: body.entry_type,
      description: body.description,
      amount: Number(body.amount) || 0,
      vendor: body.vendor || null,
      photos: Array.isArray(body.photos) ? body.photos : [],
      status: body.status || 'pending',
      created_by_sub: !!body.created_by_sub
    };

    const { data, error } = await supabaseAdmin
      .from('job_log_entries').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    updates.updated_at = new Date().toISOString();

    // If status is flipping to approved, stamp reviewed_at
    if (updates.status === 'approved' || updates.status === 'denied') {
      updates.reviewed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('job_log_entries')
      .update(updates)
      .eq('tenant_id', tenantId).eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('job_log_entries').delete()
      .eq('tenant_id', tenantId).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
