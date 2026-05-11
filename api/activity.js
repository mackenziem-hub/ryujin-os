// ═══════════════════════════════════════════════════════════════
// /api/activity — admin-only activity log viewer.
//
//   GET /api/activity?entity_type=&entity_id=&user_id=&action=
//                    &days=7&limit=200&offset=0
//
//   Returns a paginated, filterable list of activity_log rows for
//   the current tenant. Owner/admin only — other roles get 403.
//
// Auth: requires session token (Authorization: Bearer / x-ryujin-token
// / ?token).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function resolveCurrentUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token;
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('user_id, tenant_id, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, name, email, role')
    .eq('id', session.user_id)
    .maybeSingle();
  return user ? { ...user, tenant_id: session.tenant_id } : null;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const me = await resolveCurrentUser(req);
  if (!me) return res.status(401).json({ error: 'Sign in to read activity' });
  if (!['owner', 'admin'].includes(me.role)) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const tenantId = req.tenant.id;
  const {
    entity_type, entity_id, user_id, action,
    days = '7', limit = '200', offset = '0'
  } = req.query;

  const lim = Math.min(parseInt(limit, 10) || 200, 1000);
  const off = parseInt(offset, 10) || 0;
  const daysBack = Math.min(parseInt(days, 10) || 7, 90);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

  let q = supabaseAdmin
    .from('activity_log')
    .select(`
      id, tenant_id, entity_type, entity_id, user_id, action, details, created_at,
      user:users!activity_log_user_id_fkey(name, email, role)
    `, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .range(off, off + lim - 1);

  if (entity_type) q = q.eq('entity_type', entity_type);
  if (entity_id) q = q.eq('entity_id', entity_id);
  if (user_id) q = q.eq('user_id', user_id);
  if (action) q = q.eq('action', action);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Distinct entity_types + actions for filter dropdowns (cheap query, scoped to window).
  const { data: facets } = await supabaseAdmin
    .from('activity_log')
    .select('entity_type, action')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .limit(2000);
  const entityTypes = [...new Set((facets || []).map(f => f.entity_type).filter(Boolean))].sort();
  const actions = [...new Set((facets || []).map(f => f.action).filter(Boolean))].sort();

  return res.status(200).json({
    activity: data,
    total: count,
    limit: lim,
    offset: off,
    facets: { entity_types: entityTypes, actions }
  });
}

export default requireTenant(handler);
