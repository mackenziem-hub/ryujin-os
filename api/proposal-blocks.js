// Ryujin OS - Proposal Sections content-library CRUD (Phase B builder).
// GET    /api/proposal-blocks             - list blocks for tenant
// POST   /api/proposal-blocks             - upsert { block_key, block_type, name, content, audience? }
// PUT    /api/proposal-blocks             - update by { id, ...fields }
// DELETE /api/proposal-blocks?block_key=X - delete (or ?id=)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const BLOCK_TYPES = [
  'hero', 'intro', 'message', 'proof', 'portfolio', 'reviews', 'inspection',
  'guarantee', 'why_us', 'comparison', 'transparency', 'video', 'before_after',
  'scope', 'products', 'accept', 'spacer', 'custom_html'
];

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .select('id, block_key, block_type, name, content, audience, active, sort_hint')
      .eq('tenant_id', tenantId)
      .order('block_type', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ blocks: data || [], blockTypes: BLOCK_TYPES });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (!b.block_key || !b.block_type || !b.name) {
      return res.status(400).json({ error: 'block_key + block_type + name required' });
    }
    if (!BLOCK_TYPES.includes(b.block_type)) {
      return res.status(400).json({ error: `block_type must be one of: ${BLOCK_TYPES.join(', ')}` });
    }
    const row = {
      tenant_id: tenantId,
      block_key: String(b.block_key),
      block_type: b.block_type,
      name: String(b.name),
      content: (b.content && typeof b.content === 'object') ? b.content : {},
      audience: b.audience === 'internal' ? 'internal' : 'customer',
      active: b.active !== false,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .upsert(row, { onConflict: 'tenant_id,block_key' })
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, tenant_id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    if (updates.block_type && !BLOCK_TYPES.includes(updates.block_type)) {
      return res.status(400).json({ error: 'invalid block_type' });
    }
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('proposal_blocks')
      .update(updates)
      .eq('id', id).eq('tenant_id', tenantId)
      .select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'DELETE') {
    const key = req.query.block_key;
    const id = req.query.id;
    if (!key && !id) return res.status(400).json({ error: 'Missing ?block_key= or ?id=' });
    let q = supabaseAdmin.from('proposal_blocks').delete().eq('tenant_id', tenantId);
    q = id ? q.eq('id', id) : q.eq('block_key', key);
    const { error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id || key });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
