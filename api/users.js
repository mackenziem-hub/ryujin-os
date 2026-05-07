// Ryujin OS — Users API
// GET  /api/users          — List users for tenant
// GET  /api/users?id=X     — Get single user
// POST /api/users          — Create user
// PUT  /api/users          — Update user
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

// SECURITY: never expose password_hash, reset_token, or reset_token_expires_at via this API.
// Any new sensitive column added to the users table must be EXCLUDED here.
const SAFE_USER_FIELDS = 'id, tenant_id, email, name, phone, role, role_id, avatar_url, bio, active, created_at';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, role } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select(SAFE_USER_FIELDS)
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'User not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('users')
      .select(SAFE_USER_FIELDS)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name');

    if (role) query = query.eq('role', role);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ users: data });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({ tenant_id: tenantId, ...body })
      .select(SAFE_USER_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select(SAFE_USER_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
