// Ryujin OS — Tenant Settings API
// GET   /api/settings         — Get tenant settings
// PUT   /api/settings         — Update tenant settings (column-level overwrite)
// PATCH /api/settings?field=label_overrides
//                              — Deep-merge into a jsonb field. Body is the
//                                delta map; null values delete keys. Used by
//                                advanced-mode label rename UI.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { validateOverridesPatch } from '../lib/labels.js';

// Whitelist of jsonb columns that PATCH may merge into.
const PATCH_FIELDS = new Set([
  'label_overrides',
  // Future: per-pillar configs etc. could land here.
]);

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

  // PATCH — deep-merge into a single jsonb field (currently label_overrides).
  if (req.method === 'PATCH') {
    const field = req.query.field;
    if (!field || !PATCH_FIELDS.has(field)) {
      return res.status(400).json({ error: `field must be one of: ${[...PATCH_FIELDS].join(', ')}` });
    }
    const patch = req.body || {};

    // Field-specific validation.
    if (field === 'label_overrides') {
      const v = validateOverridesPatch(patch);
      if (!v.ok) return res.status(400).json({ error: v.error });
    }

    // Read current value, merge, write back. Race-tolerant for low write rates.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('tenant_settings')
      .select(`id, ${field}`)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });

    const current = existing?.[field] || {};
    const merged = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') delete merged[k];   // null clears
      else merged[k] = v;
    }

    if (existing?.id) {
      const update = { [field]: merged, updated_at: new Date().toISOString() };
      const { data, error } = await supabaseAdmin
        .from('tenant_settings').update(update).eq('tenant_id', tenantId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ [field]: data[field] });
    } else {
      const insert = { tenant_id: tenantId, [field]: merged };
      const { data, error } = await supabaseAdmin
        .from('tenant_settings').insert(insert).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ [field]: data[field] });
    }
  }

  return res.status(405).json({ error: 'GET, PUT, or PATCH only' });
}

export default requireTenant(handler);
