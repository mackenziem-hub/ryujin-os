// ═══════════════════════════════════════════════════════════════
// CAMPAIGNS — CRUD for marketing-campaign.html (5-step Hormozi builder).
//
// GET    /api/campaigns                 — list (filter: ?status=)
// GET    /api/campaigns?id=<uuid>       — single
// POST   /api/campaigns                 — create
// PUT    /api/campaigns?id=<uuid>       — update (full or partial)
// DELETE /api/campaigns?id=<uuid>
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, status, limit } = req.query;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('campaigns').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'campaign not found' });
      return res.status(200).json({ campaign: data });
    }
    let q = supabaseAdmin
      .from('campaigns').select('*').eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(parseInt(limit) || 100);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ campaigns: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        status: body.status || 'draft',
        hormozi_step: body.hormozi_step || 1,
        offer: body.offer || {},
        audience: body.audience || {},
        creative: body.creative || {},
        budget: body.budget || {},
        funnel: body.funnel || {},
        brand_ids: body.brand_ids || [],
        schedule_start: body.schedule_start || null,
        schedule_end: body.schedule_end || null,
        metadata: body.metadata || {},
        created_by: body.created_by || null
      })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ campaign: data });
  }

  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};
    const update = {};
    for (const k of ['name','status','hormozi_step','offer','audience','creative','budget','funnel','brand_ids','schedule_start','schedule_end','metadata']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    const { data, error } = await supabaseAdmin
      .from('campaigns').update(update).eq('id', id).eq('tenant_id', tenantId).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ campaign: data });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('campaigns').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
