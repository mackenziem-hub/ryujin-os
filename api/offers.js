// Ryujin OS — Offers API
// GET    /api/offers              — List offers
// GET    /api/offers?id=X         — Get single offer with full scope template
// POST   /api/offers              — Create offer
// PUT    /api/offers              — Update offer (name, scope, pricing rules)
// DELETE /api/offers?id=X         — Deactivate offer
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, system } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('offers')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (error) return res.status(404).json({ error: 'Offer not found' });

      // Enrich scope template with product names
      const template = data.scope_template || [];
      const productIds = template.filter(t => t.product_id).map(t => t.product_id);
      let products = {};
      if (productIds.length > 0) {
        const { data: prods } = await supabaseAdmin
          .from('products')
          .select('id, name, brand, unit, units_per_coverage')
          .in('id', productIds);
        for (const p of (prods || [])) products[p.id] = p;
      }

      const enrichedTemplate = template.map(t => ({
        ...t,
        product: t.product_id ? products[t.product_id] || null : null
      }));

      return res.json({ ...data, scope_template: enrichedTemplate });
    }

    let query = supabaseAdmin
      .from('offers')
      .select('id, name, slug, description, system, badge, warranty_years, pricing_method, multipliers, margin_floor, sort_order, is_default, active')
      .eq('tenant_id', tenantId)
      .order('sort_order');

    if (system) query = query.eq('system', system);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ offers: data });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const slug = (body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const { data, error } = await supabaseAdmin
      .from('offers')
      .insert({
        tenant_id: tenantId,
        name: body.name,
        slug,
        description: body.description || '',
        system: body.system || 'asphalt',
        scope_template: body.scope_template || [],
        pricing_method: body.pricing_method || 'multiplier',
        multipliers: body.multipliers || {},
        margin_floor: body.margin_floor || 10,
        warranty_years: body.warranty_years || 0,
        warranty_adder_per_sq: body.warranty_adder_per_sq || 0,
        badge: body.badge || null,
        sort_order: body.sort_order || 10,
        is_default: body.is_default || false
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabaseAdmin
      .from('offers')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { error } = await supabaseAdmin
      .from('offers')
      .update({ active: false })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deactivated: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
