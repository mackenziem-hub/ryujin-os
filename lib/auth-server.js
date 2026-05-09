// lib/auth-server.js
// Server-side helpers for owner/admin-protected endpoints.
// Builds on api/auth.js sessions table + users.role_id model.
//
// Usage:
//   import { requireOwnerOrAdmin } from '../lib/auth-server.js';
//   const auth = await requireOwnerOrAdmin(req, res);
//   if (!auth) return; // requireOwnerOrAdmin already sent 401/403
//   // auth = { user, role, session, tenant_id }

import { supabaseAdmin } from './supabase.js';

const OWNER_ADMIN_SLUGS = new Set(['owner', 'admin']);
const OWNER_ADMIN_ROLES = new Set(['owner', 'admin']); // legacy text column fallback

function readBearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  // Also accept x-user-token header (used by some Ryujin client code)
  const xToken = req.headers?.['x-user-token'];
  if (xToken) return String(xToken).trim();
  return null;
}

/**
 * Resolve the active user from a request token, returning null if missing,
 * expired, or not owner/admin. Sends the appropriate HTTP error response on
 * `res` and returns null in failure cases.
 *
 * @returns {Promise<null | {user, role, session, tenant_id}>}
 */
export async function requireOwnerOrAdmin(req, res) {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required (Bearer token or x-user-token header)' });
    return null;
  }

  // Look up session
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from('sessions')
    .select('id, user_id, tenant_id, expires_at, token')
    .eq('token', token)
    .single();

  if (sessionErr || !session) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return null;
  }
  if (new Date(session.expires_at) < new Date()) {
    res.status(401).json({ error: 'Session expired' });
    return null;
  }

  // Look up user + role
  const { data: user, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, name, email, tenant_id, role, role_id')
    .eq('id', session.user_id)
    .single();
  if (userErr || !user) {
    res.status(401).json({ error: 'User not found' });
    return null;
  }
  if (user.tenant_id !== session.tenant_id) {
    res.status(403).json({ error: 'Tenant mismatch' });
    return null;
  }

  let roleSlug = user.role || null;
  if (user.role_id) {
    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('name, slug, permissions')
      .eq('id', user.role_id)
      .single();
    if (role) roleSlug = role.slug || roleSlug;
  }

  const isPrivileged = OWNER_ADMIN_SLUGS.has(roleSlug) || OWNER_ADMIN_ROLES.has(user.role);
  if (!isPrivileged) {
    res.status(403).json({ error: 'Owner or admin role required for this action', current_role: roleSlug });
    return null;
  }

  return { user, role: roleSlug, session, tenant_id: user.tenant_id };
}
