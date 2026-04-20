// Ryujin OS — Auth API
// POST /api/auth?action=login      — Login with email + password
// POST /api/auth?action=register   — Register new user (admin only or invite)
// POST /api/auth?action=logout     — Invalidate session
// GET  /api/auth?action=me         — Get current user from session token
import { supabaseAdmin } from '../lib/supabase.js';
import crypto from 'crypto';

// Simple password hashing (bcrypt-like but using built-in crypto)
function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === attempt;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;

  // ── LOGIN ──
  if (action === 'login' && req.method === 'POST') {
    const { email, password, tenant_slug } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Find tenant
    const slug = tenant_slug || req.query.tenant || 'plus-ultra';
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id, name, slug').eq('slug', slug).single();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Find user
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, role_id, password_hash')
      .eq('tenant_id', tenant.id)
      .eq('email', email.toLowerCase().trim())
      .single();

    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });

    // Create session
    const token = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await supabaseAdmin.from('sessions').insert({
      tenant_id: tenant.id,
      user_id: user.id,
      token,
      expires_at: expires.toISOString()
    });

    // Get role info
    let roleInfo = null;
    if (user.role_id) {
      const { data: role } = await supabaseAdmin
        .from('roles').select('name, slug, permissions').eq('id', user.role_id).single();
      roleInfo = role;
    }

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: roleInfo?.slug || user.role || 'crew',
        roleName: roleInfo?.name || user.role || 'Crew',
        permissions: roleInfo?.permissions || []
      },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      expiresAt: expires.toISOString()
    });
  }

  // ── REGISTER ──
  if (action === 'register' && req.method === 'POST') {
    const { name, email, password, tenant_slug, role_slug, invite_token } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (password.length > 128) return res.status(400).json({ error: 'Password too long' });

    const slug = tenant_slug || req.query.tenant || 'plus-ultra';
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', slug).single();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Check for existing user
    const { data: existing } = await supabaseAdmin
      .from('users').select('id').eq('tenant_id', tenant.id).eq('email', email.toLowerCase().trim()).single();
    if (existing) return res.status(409).json({ error: 'User already exists' });

    // Resolve role
    let roleId = null;
    if (invite_token) {
      const { data: invite } = await supabaseAdmin
        .from('invites').select('role_id, expires_at, used_at')
        .eq('token', invite_token).eq('tenant_id', tenant.id).single();

      if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }
      roleId = invite.role_id;
    } else if (role_slug) {
      const { data: role } = await supabaseAdmin
        .from('roles').select('id').eq('tenant_id', tenant.id).eq('slug', role_slug).single();
      roleId = role?.id || null;
    }

    // Create user
    const passwordHash = hashPassword(password);
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: tenant.id,
        name,
        email: email.toLowerCase().trim(),
        password_hash: passwordHash,
        role: role_slug || 'crew',
        role_id: roleId
      })
      .select('id, name, email, role')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Mark invite as used
    if (invite_token) {
      await supabaseAdmin.from('invites').update({
        used_at: new Date().toISOString(),
        used_by: user.id
      }).eq('token', invite_token);
    }

    return res.json({ user, message: 'User registered. Log in to continue.' });
  }

  // ── ME (get current user from token) ──
  if (action === 'me') {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
      || req.query.token || '';

    if (!token) return res.status(401).json({ error: 'No token provided' });

    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('user_id, tenant_id, expires_at')
      .eq('token', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, role_id')
      .eq('id', session.user_id)
      .single();

    if (!user) return res.status(404).json({ error: 'User not found' });

    let roleInfo = null;
    if (user.role_id) {
      const { data: role } = await supabaseAdmin
        .from('roles').select('name, slug, permissions').eq('id', user.role_id).single();
      roleInfo = role;
    }

    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id, name, slug').eq('id', session.tenant_id).single();

    return res.json({
      user: {
        id: user.id, name: user.name, email: user.email,
        role: roleInfo?.slug || user.role || 'crew',
        roleName: roleInfo?.name || user.role || 'Crew',
        permissions: roleInfo?.permissions || []
      },
      tenant: tenant || {}
    });
  }

  // ── FORGOT PASSWORD ──
  // POST { email, tenant_slug } → issue a single-use reset token, store in users row,
  // return a ready-to-use reset URL. (Plus Ultra is solo-tenant — when this scales to
  // multiple tenants, swap the URL-in-response for an email send via Resend/SendGrid.)
  if (action === 'forgot' && req.method === 'POST') {
    const { email, tenant_slug } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });

    const slug = tenant_slug || req.query.tenant || 'plus-ultra';
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', slug).single();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('tenant_id', tenant.id)
      .eq('email', email.toLowerCase().trim())
      .single();

    // Don't leak whether the email exists — always return ok
    if (!user) return res.json({ ok: true, message: 'If the account exists, a reset link is available.' });

    const token = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await supabaseAdmin
      .from('users')
      .update({ reset_token: token, reset_token_expires_at: expires.toISOString() })
      .eq('id', user.id);

    // Build URL from the request host so it works on preview + prod deploys
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const resetUrl = `${proto}://${host}/reset-password.html?token=${token}`;

    return res.json({
      ok: true,
      message: 'Reset link generated. Open the URL below within the hour to set a new password.',
      resetUrl,
      expiresAt: expires.toISOString()
    });
  }

  // ── RESET PASSWORD ──
  // POST { token, password } → validate token, set new password, clear token
  if (action === 'reset' && req.method === 'POST') {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (password.length > 128) return res.status(400).json({ error: 'Password too long' });

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, reset_token_expires_at')
      .eq('reset_token', token)
      .single();

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Reset link expired. Request a new one.' });
    }

    const passwordHash = hashPassword(password);
    await supabaseAdmin
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expires_at: null
      })
      .eq('id', user.id);

    // Invalidate all existing sessions for this user — force re-login everywhere
    await supabaseAdmin.from('sessions').delete().eq('user_id', user.id);

    return res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  }

  // ── LOGOUT ──
  if (action === 'logout' && req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
      || req.body?.token || '';

    if (token) {
      await supabaseAdmin.from('sessions').delete().eq('token', token);
    }
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action. Use login, register, me, logout, forgot, or reset.' });
}
