// ═══════════════════════════════════════════════════════════════
// KPIS — list + manual update for the KPI Scouter tile grid.
//
// GET /api/kpis           — list all KPIs for tenant, sorted
// PUT /api/kpis?key=<key> — manual update (Mac/Catherine click-to-edit)
//     body: { value?, target?, unit?, label? }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('kpis')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ kpis: data || [] });
  }

  if (req.method === 'PUT') {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'key required' });
    const body = req.body || {};

    const update = { last_updated_at: new Date().toISOString() };
    for (const k of ['value','target','unit','label','trend','trend_pct','sort_order','metadata']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (body.last_updated_by) update.last_updated_by = body.last_updated_by;

    const { data, error } = await supabaseAdmin
      .from('kpis')
      .update(update)
      .eq('tenant_id', tenantId)
      .eq('key', key)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ kpi: data });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
