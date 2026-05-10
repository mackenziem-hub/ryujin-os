// ═══════════════════════════════════════════════════════════════
// /api/me — return the current session's user profile.
//
//   GET /api/me
//   Headers: Authorization: Bearer <token>  OR  x-ryujin-token: <token>
//
// Used by client-side gates (mode-switcher.js, portal nav, etc.) to
// branch on role without re-implementing session resolution.
//
// Returns 401 if no valid session token.
// ═══════════════════════════════════════════════════════════════

import { resolveSession } from '../lib/portalAuth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });

  return res.status(200).json({
    user_id: session.user_id,
    tenant_id: session.tenant_id,
    name: session.name,
    email: session.email,
    role: session.role,
    is_admin: session.role === 'owner' || session.role === 'admin',
  });
}
