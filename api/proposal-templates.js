// Ryujin OS - Proposal template (preset) CRUD (Phase B builder).
// GET    /api/proposal-templates          - list templates for tenant
// GET    /api/proposal-templates?slug=X    - one template
// POST   /api/proposal-templates          - upsert { slug, name, description?, sections, product_plan }
// PUT    /api/proposal-templates          - update by { id, ...fields }
// DELETE /api/proposal-templates?slug=X    - delete (or ?id=)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const slug = req.query.slug;
    const base = supabaseAdmin
      .from('proposal_templates')
      .select('id, slug, name, description, sections, product_plan, is_default, active, sort_order')
      .eq('tenant_id', tenantId);
    if (slug) {
      const { data, error } = await base.eq('slug', slug).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Template not found' });
      return res.json(data);
    }
    const { data, error } = await base
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ templates: data || [] });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.slug || !b.name) return res.status(400).json({ error: 'slug + name required' });
    const row = {
      tenant_id: tenantId,
      slug: String(b.slug),
      name: String(b.name),
      description: b.description ?? null,
      sections: Array.isArray(b.sections) ? b.sections : [],
      product_plan: (b.product_plan && typeof b.product_plan === 'object') ? b.product_plan : {},
      is_default: !!b.is_default,
      active: b.active !== false,
      sort_order: Number.isFinite(b.sort_order) ? b.sort_order : 0,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabaseAdmin
      .from('proposal_templates')
      .upsert(row, { onConflict: 'tenant_id,slug' })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, tenant_id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('proposal_templates')
      .update(updates)
      .eq('id', id).eq('tenant_id', tenantId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { slug, id } = req.query;
    if (!slug && !id) return res.status(400).json({ error: 'Missing ?slug= or ?id=' });
    let q = supabaseAdmin.from('proposal_templates').delete().eq('tenant_id', tenantId);
    q = id ? q.eq('id', id) : q.eq('slug', slug);
    const { error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id || slug });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
