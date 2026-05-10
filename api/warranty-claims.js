// ═══════════════════════════════════════════════════════════════
// WARRANTY-CLAIMS — CertainTeed + workmanship claim filings.
// GET    /api/warranty-claims              — list (filter ?status=, ?claim_type=)
// GET    /api/warranty-claims?id=<uuid>    — single
// POST   /api/warranty-claims              — create
// PUT    /api/warranty-claims?id=<uuid>    — update
// DELETE /api/warranty-claims?id=<uuid>
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, status, claim_type, limit } = req.query;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('warranty_claims')
        .select('*, customer:customers(full_name, email, phone, address)')
        .eq('tenant_id', tenantId).eq('id', id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'claim not found' });
      return res.status(200).json({ claim: data });
    }
    let q = supabaseAdmin
      .from('warranty_claims')
      .select('*, customer:customers(full_name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit) || 200);
    if (status) q = q.eq('status', status);
    if (claim_type) q = q.eq('claim_type', claim_type);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ claims: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ error: 'title required' });
    if (!body.claim_type) return res.status(400).json({ error: 'claim_type required' });
    const { data, error } = await supabaseAdmin
      .from('warranty_claims')
      .insert({
        tenant_id: tenantId,
        customer_id: body.customer_id || null,
        source_estimate: body.source_estimate || null,
        claim_type: body.claim_type,
        manufacturer: body.manufacturer || null,
        status: body.status || 'open',
        title: body.title,
        description: body.description || null,
        defect_observed: body.defect_observed || null,
        filed_at: body.filed_at || null,
        reference_number: body.reference_number || null,
        service_ticket_id: body.service_ticket_id || null,
        metadata: body.metadata || {},
        created_by: body.created_by || null
      })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ claim: data });
  }

  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    const update = {};
    for (const k of ['claim_type','manufacturer','status','title','description','defect_observed','filed_at','reference_number','resolution','resolved_at','service_ticket_id','metadata']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    const { data, error } = await supabaseAdmin
      .from('warranty_claims').update(update).eq('id', id).eq('tenant_id', tenantId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ claim: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('warranty_claims').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
