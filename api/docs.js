// Ryujin OS — Documents API
// GET    /api/docs                  — List docs (id, slug, title, status, hero_image, updated_at)
// GET    /api/docs?slug=X           — Get full doc (markdown + metadata)
// PUT    /api/docs?slug=X           — Upsert doc (body: { title, markdown, hero_image, summary, status, gamma_url, notebook_url })
// DELETE /api/docs?slug=X           — Hard delete
//
// Tenant-gated. Markdown is the source of truth; rendering happens client-side
// in /doc.html (and via puppeteer for PDF). Index entries (no markdown body)
// are <2KB so chat brain can include them in fetchSnapshot context.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const VALID_STATUS = new Set(['draft', 'published']);
const SLUG_RX = /^[a-z0-9][a-z0-9-]{0,80}$/;

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;
  const slug = req.query.slug ? String(req.query.slug).trim().toLowerCase() : null;

  if (req.method === 'GET') {
    if (slug) {
      const { data, error } = await supabaseAdmin
        .from('docs')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('slug', slug)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Doc not found' });
      return res.json(data);
    }

    const status = req.query.status ? String(req.query.status) : null;
    let query = supabaseAdmin
      .from('docs')
      .select('id, slug, title, summary, hero_image, status, is_system_managed, version, gamma_url, notebook_url, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false });
    if (status && VALID_STATUS.has(status)) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ docs: data });
  }

  if (req.method === 'PUT') {
    if (!slug) return res.status(400).json({ error: 'Missing ?slug=' });
    if (!SLUG_RX.test(slug)) return res.status(400).json({ error: 'Invalid slug — lowercase letters, numbers, hyphens (max 80 chars)' });

    const body = req.body || {};
    if (body.title !== undefined && !String(body.title).trim()) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }
    const patch = {
      tenant_id: tenantId,
      slug,
      title: body.title !== undefined ? String(body.title).trim().slice(0, 200) : undefined,
      markdown: body.markdown != null ? String(body.markdown) : undefined,
      hero_image: body.hero_image !== undefined ? (body.hero_image || null) : undefined,
      summary: body.summary !== undefined ? (body.summary || null) : undefined,
      status: body.status && VALID_STATUS.has(body.status) ? body.status : undefined,
      gamma_url: body.gamma_url !== undefined ? (body.gamma_url || null) : undefined,
      notebook_url: body.notebook_url !== undefined ? (body.notebook_url || null) : undefined
    };
    Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);

    const { data: existing } = await supabaseAdmin
      .from('docs')
      .select('id, version, is_system_managed')
      .eq('tenant_id', tenantId)
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      patch.version = (existing.version || 1) + 1;
      const { data, error } = await supabaseAdmin
        .from('docs')
        .update(patch)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (!patch.title) return res.status(400).json({ error: 'title required for new doc' });
    if (patch.markdown == null) patch.markdown = '';
    const { data, error } = await supabaseAdmin
      .from('docs')
      .insert(patch)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    if (!slug) return res.status(400).json({ error: 'Missing ?slug=' });
    const { error } = await supabaseAdmin
      .from('docs')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('slug', slug);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
