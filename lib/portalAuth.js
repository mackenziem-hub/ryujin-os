// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Portal session resolver + role helpers.
//
// Used by portal pages + API endpoints that need to gate on session
// presence and apply role-aware filtering. Reuses the same session
// token resolution as /api/chat.js + /api/messages.js.
//
//   const session = await resolveSession(req);
//   if (!session) return res.status(401).json({ error: 'sign in' });
//   if (!canViewUserData(session, req.query.user_id)) {
//     // strip the user filter so sales/crew default to their own data
//     req.query.user_id = session.user_id;
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

const PRIVILEGED_ROLES = new Set(['owner', 'admin']);

export async function resolveSession(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token
    || (req.body?.token);
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('sessions').select('user_id, tenant_id, expires_at').eq('token', token).maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const { data: user } = await supabaseAdmin
    .from('users').select('id, name, email, role, tenant_id').eq('id', session.user_id).maybeSingle();
  if (!user) return null;
  return {
    user_id: user.id, tenant_id: user.tenant_id,
    name: user.name, email: user.email, role: user.role || 'crew',
  };
}

// Owner / admin can pass any user_id; sales/crew restricted to themselves.
// Returns the effective user_id to use for filtering, or null = no filter.
export function effectiveUserId(session, requestedUserId) {
  if (!session) return requestedUserId || null;
  if (PRIVILEGED_ROLES.has(session.role)) return requestedUserId || null;
  // Non-privileged: ignore any passed user_id, force their own.
  return session.user_id;
}

export function isPrivileged(session) {
  return !!(session && PRIVILEGED_ROLES.has(session.role));
}

// Middleware factory: 401 if no session, else attach req.session and continue.
export function requirePortalSession(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    const session = await resolveSession(req);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    req.session = session;
    return handler(req, res);
  };
}

// Soft variant: attach session if present, but don't 401. Useful for
// state endpoints that should still work for the existing
// browser-localhost tenant flow but tighten when a session exists.
export function attachSession(handler) {
  return async (req, res) => {
    if (req.method !== 'OPTIONS') {
      req.session = await resolveSession(req).catch(() => null);
    }
    return handler(req, res);
  };
}
