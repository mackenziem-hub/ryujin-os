// POST /api/set-password — owner/admin sets a teammate's password (and optionally email).
//
// Why this exists: the app could create users with a password and mint reset
// tokens, but had no way to set an EXISTING user's password directly. The only
// recovery paths were the forgot-password email (useless for crew accounts whose
// email is a placeholder that doesn't receive mail) and the /i/<firstname> invite
// link (first-activation only, refuses already-activated accounts). This closes
// that gap so an owner/admin can set any teammate's login in one call.
//
// Auth: resolveSession() — accepts a real owner/admin browser session OR the
// RYUJIN_SERVICE_TOKEN (synthetic admin). isPrivileged() gates to owner/admin.
// Scoped to the caller's tenant; never crosses tenants.
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { hashPassword } from '../lib/passwords.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  if (!isPrivileged(session)) return res.status(403).json({ error: 'Owner or admin role required' });

  const { id, password, email, username } = req.body || {};
  if (!id || !password) return res.status(400).json({ error: 'id and password are required' });
  const pw = String(password);
  if (pw.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (pw.length > 128) return res.status(400).json({ error: 'Password too long' });

  // Optional username (first-name login). Same admin gate as the password set,
  // since the only other write path (PUT /api/users) needs a browser owner
  // session and isn't reachable by the service token. Crew/workforce accounts
  // log in by username; without one they can only log in by full email.
  let normUsername;
  if (username !== undefined && username !== null && String(username).trim() !== '') {
    normUsername = String(username).toLowerCase().trim();
    if (!/^[a-z0-9._-]{2,32}$/.test(normUsername)) {
      return res.status(400).json({ error: 'Username must be 2-32 chars: letters, numbers, dot, dash, underscore' });
    }
  }

  const updates = {
    password_hash: hashPassword(pw),
    reset_token: null,
    reset_token_expires_at: null,
    // Revoke every alternate auth path, not just the password: a stale magic-login
    // link (users.magic_token, consumed by /api/auth?action=magic-consume) would
    // otherwise still mint a session without the new password.
    magic_token: null,
    magic_expires_at: null,
  };
  if (email !== undefined && email !== null && String(email).trim() !== '') {
    updates.email = String(email).toLowerCase().trim();
  }
  if (normUsername) updates.username = normUsername;

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', session.tenant_id)
    .select('id, name, email, username, role')
    .maybeSingle();

  if (error) {
    // Duplicate email is a predictable admin-fix case (the address already belongs
    // to another teammate); surface it as a 409 like the other user endpoints.
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return res.status(409).json({ error: 'That email or username is already used by another teammate.' });
    }
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'User not found in this tenant' });

  // Force a clean re-login: revoke any existing sessions for the target user so a
  // changed password actually locks out old/compromised devices (a forced reset that
  // leaves old sessions live defeats the purpose). Fire-and-forget; the password is
  // already changed even if this cleanup fails.
  await supabaseAdmin.from('sessions').delete().eq('user_id', id).then(() => {}, () => {});

  return res.json({ ok: true, user: data });
}
