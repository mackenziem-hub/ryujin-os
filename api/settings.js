// Ryujin OS - Tenant Settings API
// GET   /api/settings         - Get tenant settings
// PUT   /api/settings         - Update tenant settings (column-level overwrite)
// PATCH /api/settings?field=label_overrides
//                              - Deep-merge into a jsonb field. Body is the
//                                delta map; null values delete keys. Used by
//                                advanced-mode label rename UI.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { validateOverridesPatch } from '../lib/labels.js';
import { validateWatches } from '../lib/inboxWatches.js';

// Whitelist of jsonb columns that PATCH may merge into.
const PATCH_FIELDS = new Set([
  'label_overrides',
  'inbox_config',
  // Future: per-pillar configs etc. could land here.
]);

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // GET - load settings. The full row (pricing multipliers, margins, labor
  // rates, overhead, team roster) is returned ONLY to an authenticated session,
  // scoped to that session's tenant. An unauthenticated caller gets a safe
  // public projection (label_overrides only) so the app-wide label resolver
  // (labels-client.js) keeps working without leaking internal config to anyone
  // who knows a tenant slug. Public branding lives at /api/tenant-branding.
  // (Review fix 2026-05-29.)
  if (req.method === 'GET') {
    const session = await resolveSession(req).catch(() => null);
    const readTenantId = session ? session.tenant_id : tenantId;
    const columns = session ? '*' : 'tenant_id, label_overrides';
    const { data, error } = await supabaseAdmin
      .from('tenant_settings')
      .select(columns)
      .eq('tenant_id', readTenantId)
      .single();

    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });
    return res.json(data || { tenant_id: readTenantId, _empty: true });
  }

  // PUT - full-row write of tenant_settings (pricing multipliers, margins,
  // labor rates, branding, team_coverage roster). This is destructive, so it
  // requires a privileged (owner/admin) session and is scoped to the SESSION's
  // tenant, NOT the client-supplied x-tenant-id. Without this gate anyone who
  // knew a tenant slug could rewrite/wipe the whole settings blob unauthenticated.
  // (Review 2026-05-29 critical fix. Service-token callers resolve to a synthetic
  // admin session via resolveSession, so cron/chat.js writes still work.)
  if (req.method === 'PUT') {
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });
    const writeTenantId = session.tenant_id;

    const updates = req.body || {};
    delete updates.id;
    delete updates.tenant_id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    // Check if settings exist
    const { data: existing } = await supabaseAdmin
      .from('tenant_settings')
      .select('id')
      .eq('tenant_id', writeTenantId)
      .single();

    if (existing) {
      const { data, error } = await supabaseAdmin
        .from('tenant_settings')
        .update(updates)
        .eq('tenant_id', writeTenantId)
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    } else {
      // Create new
      const { data, error } = await supabaseAdmin
        .from('tenant_settings')
        .insert({ tenant_id: writeTenantId, ...updates })
        .select()
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }
  }

  // PATCH - deep-merge into a single jsonb field (currently label_overrides).
  // A tenant-wide config write, so it requires a privileged (owner/admin)
  // session (same gate as PUT) and is scoped to the session's tenant, not the
  // client x-tenant-id. (Review fix 2026-05-29; PATCH admin-gated 2026-05-29.)
  if (req.method === 'PATCH') {
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });
    const patchTenantId = session.tenant_id;

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
    // inbox_config.watches is the unified inbox watch list; validate +
    // normalize it (null/'' still falls through to the merge's key-clear).
    if (field === 'inbox_config' && patch.watches != null && patch.watches !== '') {
      const v = validateWatches(patch.watches);
      if (!v.ok) return res.status(400).json({ error: v.error });
      patch.watches = v.watches;
    }

    // Read current value, merge, write back. Race-tolerant for low write rates.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('tenant_settings')
      .select(`id, ${field}`)
      .eq('tenant_id', patchTenantId)
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
        .from('tenant_settings').update(update).eq('tenant_id', patchTenantId).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ [field]: data[field] });
    } else {
      const insert = { tenant_id: patchTenantId, [field]: merged };
      const { data, error } = await supabaseAdmin
        .from('tenant_settings').insert(insert).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ [field]: data[field] });
    }
  }

  return res.status(405).json({ error: 'GET, PUT, or PATCH only' });
}

export default requireTenant(handler);
