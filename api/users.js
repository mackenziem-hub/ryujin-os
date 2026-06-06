// Ryujin OS — Users API
// GET  /api/users          — List users for tenant
// GET  /api/users?id=X     — Get single user
// POST /api/users          — Create user
// PUT  /api/users          — Update user
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { resolveSession } from '../lib/portalAuth.js';
import { hashPassword } from '../lib/passwords.js';
import crypto from 'node:crypto';

// SECURITY: never expose password_hash, reset_token, or reset_token_expires_at via this API.
// Any new sensitive column added to the users table must be EXCLUDED here.
const SAFE_USER_FIELDS = 'id, tenant_id, email, username, name, phone, role, role_id, avatar_url, bio, active, created_at';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    // GATE: the staff directory was readable unauthenticated by tenant slug.
    // Require a valid portal session (any signed-in user in the tenant) or the
    // RYUJIN_SERVICE_TOKEN for server-to-server callers. Scope the query to the
    // SESSION's tenant, not the client-supplied x-tenant-id/?tenant=, so a
    // logged-in user of tenant A cannot read tenant B's directory.
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    const scopedTenantId = session.tenant_id;

    const { id, role } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select(SAFE_USER_FIELDS)
        .eq('tenant_id', scopedTenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'User not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('users')
      .select(SAFE_USER_FIELDS)
      .eq('tenant_id', scopedTenantId)
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

    // Invite mode: mint a single-use reset_token so the new hire can set their own
    // password via /accept-invite.html (reached through the SMS-safe /i/<firstname>
    // short link). Without this, the user row exists but has no way to sign in.
    // The token is a bearer credential, so we build the URLs for the authenticated
    // admin who just created the account but never echo the raw token via SAFE_USER_FIELDS.
    if (body.invite) {
      // 40-char hex matches the system's reset_token convention and accept-invite.html's
      // token slicing (it trims to the first 40 hex chars), so the token survives intact.
      const token = crypto.randomBytes(20).toString('hex');
      const ttlDays = Math.max(1, Math.min(30, Number(body.invite_ttl_days) || 7));
      const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
      const { error: tErr } = await supabaseAdmin
        .from('users')
        .update({ reset_token: token, reset_token_expires_at: expiresAt })
        .eq('id', data.id);
      if (tErr) return res.status(500).json({ error: 'User created but invite link failed: ' + tErr.message });
      // Only emit the /i/<firstname> short link when the first name is purely letters.
      // api/i.js strips non-letters from the slug but compares it against the RAW first
      // token, so a punctuated name (e.g. "Jean-Luc") never resolves. Returning null for
      // those forces callers to the token-specific invite_url, which always works.
      const firstToken = name.toLowerCase().split(/\s+/)[0];
      const shortSlug = /^[a-z]+$/.test(firstToken) ? firstToken : null;
      return res.status(201).json({
        ...data,
        invite_url: `/accept-invite.html?token=${token}`,
        short_url: shortSlug ? `/i/${shortSlug}` : null,
        invite_expires_at: expiresAt,
      });
    }

    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    // Owner/admin-only (was an open blind update that could rewrite any user's role).
    const auth = await requireOwnerOrAdmin(req, res);
    if (!auth) return;
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    // P3: explicit allowlist instead of spreading req.body. The old `...updates`
    // spread let a caller mass-assign tenant_id / role / role_id (privilege
    // escalation + cross-tenant move) along with sensitive columns. Only these
    // profile fields may be written here; role/role_id/tenant_id changes are NOT
    // permitted through the generic update path.
    const ALLOWED_UPDATE_FIELDS = ['name', 'email', 'username', 'phone', 'avatar_url', 'bio', 'active'];
    const updates = {};
    for (const k of ALLOWED_UPDATE_FIELDS) {
      if (body[k] !== undefined) updates[k] = body[k];
    }
    if (updates.email) updates.email = String(updates.email).toLowerCase().trim();
    if (updates.username) updates.username = String(updates.username).toLowerCase().trim();
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', auth.tenant_id)
      .select(SAFE_USER_FIELDS)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
