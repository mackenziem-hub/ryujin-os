// ═══════════════════════════════════════════════════════════════
// /api/accept-invite — completes a team invite.
//
//   GET  /api/accept-invite?token=XXX
//     → { user_id, name, role, email_hint }  (or 404/410 if invalid/expired)
//
//   POST /api/accept-invite
//     body: { token, email, password, name? }
//     → { ok, token: <session>, user_id, redirect_url }
//
// Uses the existing users.reset_token + reset_token_expires_at columns
// (migration_011) as the invite token store. Token cleared after use.
// Password format matches api/auth.js scrypt + ${salt}:${hash} so the
// user can log in via /api/auth?action=login on subsequent visits.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import crypto from 'node:crypto';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function portalForRole(role, name) {
  const slug = (name || '').toLowerCase().split(/\s+/)[0];
  const named = ['mac','mackenzie','catherine','aj','darcy','diego','pavanjot','ryan'];
  if (named.includes(slug)) return `/portal-${slug === 'mackenzie' ? 'mac' : slug}.html`;
  if (role === 'owner' || role === 'admin') return '/admin-overview.html';
  if (role === 'sales' || role === 'estimator') return '/portal.html?role=sales';
  return '/portal.html?role=crew';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'token required' });
    const { data: user } = await supabaseAdmin
      .from('users').select('id, name, role, email, reset_token_expires_at')
      .eq('reset_token', token).maybeSingle();
    if (!user) return res.status(404).json({ error: 'invite_not_found' });
    if (user.reset_token_expires_at && new Date(user.reset_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'invite_expired' });
    }
    return res.status(200).json({
      user_id: user.id,
      name: user.name,
      role: user.role,
      email_hint: user.email && !user.email.endsWith('.crew') && !user.email.endsWith('.sub') ? user.email : null,
    });
  }

  if (req.method === 'POST') {
    const { token, email, password, name } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    if (!email || !password) return res.status(400).json({ error: 'email + password required' });
    if (password.length < 8) return res.status(400).json({ error: 'password must be ≥ 8 chars' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });

    const { data: user } = await supabaseAdmin
      .from('users').select('id, name, role, tenant_id, reset_token_expires_at')
      .eq('reset_token', token).maybeSingle();
    if (!user) return res.status(404).json({ error: 'invite_not_found' });
    if (user.reset_token_expires_at && new Date(user.reset_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'invite_expired' });
    }

    // Check if the new email is already in use by a different user.
    const { data: emailClash } = await supabaseAdmin
      .from('users').select('id').eq('email', email).neq('id', user.id).maybeSingle();
    if (emailClash) return res.status(409).json({ error: 'email already in use by another account' });

    const { error: uErr } = await supabaseAdmin
      .from('users')
      .update({
        email,
        password_hash: hashPassword(password),
        ...(name ? { name } : {}),
        reset_token: null,
        reset_token_expires_at: null,
      })
      .eq('id', user.id);
    if (uErr) return res.status(500).json({ error: uErr.message });

    // Issue a session.
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    await supabaseAdmin
      .from('sessions')
      .insert({ token: sessionToken, user_id: user.id, tenant_id: user.tenant_id, expires_at: expiresAt });

    return res.status(200).json({
      ok: true,
      token: sessionToken,
      user_id: user.id,
      redirect_url: portalForRole(user.role, name || user.name),
    });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}
