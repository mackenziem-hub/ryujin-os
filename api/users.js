// Ryujin OS — Users API
// GET  /api/users          — List users for tenant
// GET  /api/users?id=X     — Get single user
// POST /api/users          — Create user
// PUT  /api/users          — Update user
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { hashPassword } from '../lib/passwords.js';

// SECURITY: never expose password_hash, reset_token, or reset_token_expires_at via this API.
// Any new sensitive column added to the users table must be EXCLUDED here.
const SAFE_USER_FIELDS = 'id, tenant_id, email, username, name, phone, role, role_id, avatar_url, bio, active, created_at';

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
    // Creating a user is owner/admin-only (previously a blind, unauthenticated insert).
    const auth = await requireOwnerOrAdmin(req, res);
    if (!auth) return; // 401/403 already sent

    const body = req.body || {};
    const name = body.name ? String(body.name).trim() : '';
    const username = body.username ? String(body.username).toLowerCase().trim() : null;
    const email = body.email ? String(body.email).toLowerCase().trim() : null;
    if (!name || (!username && !email)) {
      return res.status(400).json({ error: 'name and a username or email are required' });
    }

    // Workforce roles default to crew. Legacy role CHECK = owner/admin/estimator/crew.
    const roleSlug = ['owner', 'admin', 'estimator', 'crew'].includes(body.role_slug) ? body.role_slug : 'crew';
    let roleId = null;
    const { data: roleRow } = await supabaseAdmin
      .from('roles').select('id').eq('tenant_id', auth.tenant_id).eq('slug', roleSlug).maybeSingle();
    if (roleRow) roleId = roleRow.id;

    const insert = { tenant_id: auth.tenant_id, name, username, email, role: roleSlug, role_id: roleId };
    if (body.phone) insert.phone = body.phone;
    if (body.password) {
      if (String(body.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      insert.password_hash = hashPassword(String(body.password));
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .insert(insert)
      .select(SAFE_USER_FIELDS)
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That username or email is already in use.' });
      return res.status(500).json({ error: error.message });
    }
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
