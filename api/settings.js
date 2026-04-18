// Ryujin OS — Tenant Settings API
// GET  /api/settings         — Get tenant settings
// PUT  /api/settings         — Update tenant settings (partial merge)
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // GET — load settings
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
    return res.json(data || { tenant_id: tenantId, _empty: true });
  }

  // PUT — update (partial merge)
  if (req.method === 'PUT') {
    const updates = req.body || {};
    delete updates.id;
    delete updates.tenant_id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    // Check if settings exist
    const { data: existing } = await supabaseAdmin
      .from('tenant_settings')
      .select('id')
      .eq('tenant_id', tenantId)
      .single();

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('tenant_settings')
        .update(updates)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } else {
      // Create new
      const { data, error } = await supabaseAdmin
        .from('tenant_settings')
        .insert({ tenant_id: tenantId, ...updates })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }
  }

  return res.status(405).json({ error: 'GET or PUT only' });
}

export default requireTenant(handler);
