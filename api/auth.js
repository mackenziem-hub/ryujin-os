// Ryujin OS — Auth API
// POST /api/auth?action=login      — Login with email + password
// POST /api/auth?action=register   — Register new user (admin only or invite)
// POST /api/auth?action=logout     — Invalidate session
// GET  /api/auth?action=me         — Get current user from session token
import { supabaseAdmin } from '../lib/supabase.js';
import { gmailSend } from '../lib/google.js';
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
    const { email, username, password, tenant_slug, remember } = req.body || {};
    const ident = String(username || email || '').toLowerCase().trim();
    if (!ident || !password) return res.status(400).json({ error: 'Username or email and password required' });

    // Find tenant
    const slug = tenant_slug || req.query.tenant || 'plus-ultra';
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id, name, slug').eq('slug', slug).single();
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    // Find user by username (workforce/crew, no email) or email. When a username is
    // supplied it takes precedence so it never collides with the email lookup.
    const lookupCol = username ? 'username' : 'email';
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, name, email, username, role, role_id, password_hash')
      .eq('tenant_id', tenant.id)
      .eq(lookupCol, ident)
      .single();

    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
    if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });

    // Create session. Initial TTL caps absolute lifetime if the user never
    // returns: Remember Me checked = 365 days, unchecked = 90 days. Sliding
    // refresh in lib/portalAuth.js bumps expires_at to (now + 90 days) on
    // every authed call, so active users never get kicked out either way.
    const token = generateToken();
    const ttlDays = remember ? 365 : 90;
    const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

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
        username: user.username,
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

    // Resolve role.
    // SECURITY: role_slug from request body is IGNORED for self-serve registration —
    // it was a self-elevation primitive (anyone could POST role_slug=admin and create
    // an admin account). Elevated roles can only come from invite_token, where the
    // role is read from the invite row (which an admin had to issue), not the body.
    let roleId = null;
    let resolvedRoleSlug = 'crew';
    if (invite_token) {
      const { data: invite } = await supabaseAdmin
        .from('invites').select('role_id, expires_at, used_at')
        .eq('token', invite_token).eq('tenant_id', tenant.id).single();

      if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
      }
      roleId = invite.role_id;
      if (roleId) {
        const { data: invitedRole } = await supabaseAdmin
          .from('roles').select('slug').eq('id', roleId).single();
        if (invitedRole?.slug) resolvedRoleSlug = invitedRole.slug;
      }
    } else {
      // Self-serve registration without an invite always lands as 'crew'.
      const { data: crewRole } = await supabaseAdmin
        .from('roles').select('id').eq('tenant_id', tenant.id).eq('slug', 'crew').single();
      roleId = crewRole?.id || null;
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
        role: resolvedRoleSlug,
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

    // Build URL from the request host so it works on preview + prod deploys.
    // SECURITY: do NOT return resetUrl in the API response — that's an account-takeover
    // primitive for any known email. Logged server-side so Mac can pull from Vercel
    // logs until Gmail email-send is wired (TODO: gmailSend from lib/google.js).
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const resetUrl = `${proto}://${host}/reset-password.html?token=${token}`;
    console.log(`[auth/forgot] Reset URL for ${user.email}: ${resetUrl} (expires ${expires.toISOString()})`);

    // Email the link to the account owner. Same server-side Gmail path used by
    // leads/approve. Swallow send errors so we never leak whether the email
    // exists; the console log above stays the admin fallback if delivery fails.
    try {
      await gmailSend(
        user.email,
        'Reset your Plus Ultra Roofing password',
        [
          'Hi,',
          '',
          'We received a request to reset the password on your Plus Ultra Roofing account.',
          'Use the link below within the next hour to set a new password:',
          '',
          resetUrl,
          '',
          'If you did not request this, you can ignore this email and your password stays the same.',
          '',
          'Plus Ultra Roofing'
        ].join('\n')
      );
    } catch (e) {
      console.error('[auth/forgot] reset email send failed:', e?.message);
    }

    return res.json({
      ok: true,
      message: 'If the account exists, a reset link has been emailed. The link expires in 1 hour.'
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

  // ── MAGIC-CREATE (admin only) ──
  // POST { user_id?, email?, tenant_slug?, ttl_days? } → generates a one-tap magic token,
  // stores on users.magic_token, returns the full landing URL (e.g. /magic.html?t=...).
  // Caller must be an authenticated admin/owner session. Mac generates these for crew.
  if (action === 'magic-create' && req.method === 'POST') {
    const sessionToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!sessionToken) return res.status(401).json({ error: 'Admin session required' });

    const { data: session } = await supabaseAdmin
      .from('sessions').select('user_id, tenant_id, expires_at').eq('token', sessionToken).single();
    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    const { data: caller } = await supabaseAdmin
      .from('users').select('role').eq('id', session.user_id).single();
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Owner or admin only' });
    }

    const { user_id, email, ttl_days } = req.body || {};
    if (!user_id && !email) return res.status(400).json({ error: 'user_id or email required' });

    let userQuery = supabaseAdmin
      .from('users').select('id, name, email').eq('tenant_id', session.tenant_id);
    userQuery = user_id ? userQuery.eq('id', user_id) : userQuery.eq('email', email.toLowerCase().trim());
    const { data: target } = await userQuery.single();
    if (!target) return res.status(404).json({ error: 'User not found in your tenant' });

    const token = generateToken();
    const ttl = Math.max(1, Math.min(30, ttl_days || 7));
    const expires = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);

    await supabaseAdmin
      .from('users')
      .update({ magic_token: token, magic_expires_at: expires.toISOString() })
      .eq('id', target.id);

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/magic.html?t=${token}`;
    console.log(`[auth/magic-create] Magic URL for ${target.email}: ${url} (expires ${expires.toISOString()})`);

    return res.json({ ok: true, url, expires_at: expires.toISOString(), user: { id: target.id, name: target.name, email: target.email } });
  }

  // ── MAGIC-CONSUME (public) ──
  // POST { token } → validates the magic token, creates a session, returns same payload
  // shape as login. Magic token is single-use: cleared after a successful consume.
  //
  // Atomic claim: the clear-and-fetch is a single UPDATE...WHERE token=? AND
  // expires>now() RETURNING *, so two concurrent consumes can't both pass the
  // validation step before one writes the clear.
  if (action === 'magic-consume' && req.method === 'POST') {
    const { token: magicToken } = req.body || {};
    if (!magicToken) return res.status(400).json({ error: 'token required' });

    const nowIso = new Date().toISOString();
    const { data: claimed } = await supabaseAdmin
      .from('users')
      .update({ magic_token: null, magic_expires_at: null })
      .eq('magic_token', magicToken)
      .gt('magic_expires_at', nowIso)
      .select('id, tenant_id, name, email, role, role_id')
      .single();

    if (!claimed) {
      // Either the token never existed, was already consumed, or has expired.
      // Disambiguate for UX — does a row with this token still exist with an
      // expired timestamp?
      const { data: stale } = await supabaseAdmin
        .from('users')
        .select('id, magic_expires_at')
        .eq('magic_token', magicToken)
        .maybeSingle();
      if (stale) return res.status(410).json({ error: 'Magic link has expired' });
      return res.status(404).json({ error: 'Magic link not found or already used' });
    }
    const user = claimed;

    const sessionToken = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await supabaseAdmin.from('sessions').insert({
      tenant_id: user.tenant_id, user_id: user.id, token: sessionToken, expires_at: expires.toISOString()
    });

    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id, name, slug').eq('id', user.tenant_id).single();
    let roleInfo = null;
    if (user.role_id) {
      const { data: role } = await supabaseAdmin
        .from('roles').select('name, slug, permissions').eq('id', user.role_id).single();
      roleInfo = role;
    }

    return res.json({
      token: sessionToken,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: roleInfo?.slug || user.role || 'crew',
        roleName: roleInfo?.name || user.role || 'Crew',
        permissions: roleInfo?.permissions || []
      },
      tenant: tenant || {},
      expiresAt: expires.toISOString()
    });
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

  return res.status(400).json({ error: 'Unknown action. Use login, register, me, logout, forgot, reset, magic-create, or magic-consume.' });
}
