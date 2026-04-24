// Ryujin OS — Brands CRUD
// GET    /api/brands           — list brands for tenant
// POST   /api/brands           — create brand { slug, name, voice?, cta?, tagline?, hashtags?, website? }
// PUT    /api/brands?id=X      — update brand
// DELETE /api/brands?id=X      — delete brand
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('brands').select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ brands: data });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.slug || !body.name) return res.status(400).json({ error: 'slug + name required' });
    const row = {
      tenant_id: tenantId,
      slug: body.slug,
      name: body.name,
      voice: body.voice ?? null,
      tagline: body.tagline ?? null,
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : null,
      cta: body.cta ?? null,
      website: body.website ?? null
    };
    const { data, error } = await supabaseAdmin.from('brands').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('brands').update(updates)
      .eq('id', id).eq('tenant_id', tenantId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { error } = await supabaseAdmin
      .from('brands').delete()
      .eq('id', id).eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
