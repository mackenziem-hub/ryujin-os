// Ryujin OS — Estimates CRUD
// GET    /api/estimates         — List estimates (with filters)
// GET    /api/estimates?id=X    — Get single estimate
// POST   /api/estimates         — Create estimate
// PUT    /api/estimates         — Update estimate
// DELETE /api/estimates?id=X    — Soft-delete (set status=cancelled)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status, customer_id, limit = 50, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('estimates')
        .select('*, customer:customers(*), photos:estimate_photos(*), proposal:proposals(*)')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'Estimate not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('estimates')
      .select('*, customer:customers(full_name, address, city, phone)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'cancelled');
    if (customer_id) query = query.eq('customer_id', customer_id);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ estimates: data, total: count });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // If customer info is inline, create or find customer first
    let customerId = body.customer_id;
    if (!customerId && body.customer) {
      const { data: existing } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('full_name', body.customer.full_name)
        .eq('address', body.customer.address || '')
        .maybeSingle();

      if (existing) {
        customerId = existing.id;
      } else {
        const { data: newCust, error: custErr } = await supabaseAdmin
          .from('customers')
          .insert({ tenant_id: tenantId, ...body.customer })
          .select('id')
          .single();

        if (custErr) return res.status(500).json({ error: `Customer creation failed: ${custErr.message}` });
        customerId = newCust.id;
      }
    }

    const estimate = {
      tenant_id: tenantId,
      customer_id: customerId,
      created_by: body.created_by || null,
      sales_owner: body.sales_owner || null,
      proposal_mode: body.proposal_mode || 'Roof Only',
      pricing_model: body.pricing_model || 'Local',
      roof_area_sqft: body.roof_area_sqft,
      roof_pitch: body.roof_pitch,
      complexity: body.complexity || 'medium',
      eaves_lf: body.eaves_lf || 0,
      rakes_lf: body.rakes_lf || 0,
      ridges_lf: body.ridges_lf || 0,
      valleys_lf: body.valleys_lf || 0,
      walls_lf: body.walls_lf || 0,
      hips_lf: body.hips_lf || 0,
      pipes: body.pipes || 0,
      vents: body.vents || 0,
      chimneys: body.chimneys || 0,
      chimney_size: body.chimney_size || 'small',
      chimney_cricket: body.chimney_cricket || false,
      stories: body.stories || 1,
      extra_layers: body.extra_layers || 0,
      cedar_tearoff: body.cedar_tearoff || false,
      redeck_sheets: body.redeck_sheets || 0,
      new_construction: body.new_construction || false,
      siding_sqft: body.siding_sqft || 0,
      soffit_lf: body.soffit_lf || 0,
      fascia_lf: body.fascia_lf || 0,
      gutter_lf: body.gutter_lf || 0,
      window_count: body.window_count || 0,
      door_count: body.door_count || 0,
      osb_sheets: body.osb_sheets || 0,
      remediation_allowance: body.remediation_allowance || 0,
      distance_km: body.distance_km || 0,
      calculated_packages: body.calculated_packages || {},
      selected_package: body.selected_package,
      custom_prices: body.custom_prices || {},
      status: body.status || 'draft',
      notes: body.notes || [],
      tags: body.tags || [],
      ghl_opportunity_id: body.ghl_opportunity_id
    };

    const { data, error } = await supabaseAdmin
      .from('estimates')
      .insert(estimate)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Generate share token
    const shareToken = `${req.tenant.slug}-${data.estimate_number || data.id.slice(0, 8)}`;
    await supabaseAdmin
      .from('estimates')
      .update({ share_token: shareToken })
      .eq('id', data.id);

    data.share_token = shareToken;

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'estimate',
      entity_id: data.id,
      action: 'created',
      details: { proposal_mode: estimate.proposal_mode, status: estimate.status }
    });

    return res.status(201).json(data);
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Prevent cross-tenant updates
    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Estimate not found' });

    const { data, error } = await supabaseAdmin
      .from('estimates')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'estimate',
      entity_id: id,
      action: 'updated',
      details: { fields: Object.keys(updates) }
    });

    return res.json(data);
  }

  // ── DELETE (soft) ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { error } = await supabaseAdmin
      .from('estimates')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'cancelled', id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
