// Ryujin OS — Invite System
// GET    /api/invites              — List pending invites
// GET    /api/invites?token=X      — Validate an invite token (public — for sign-up page)
// POST   /api/invites              — Create invite (admin only)
// POST   /api/invites (with token) — Accept invite (sign up)
// DELETE /api/invites?id=X         — Revoke invite
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant } from '../lib/tenant.js';

function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 24; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Public: Validate invite token ──
  if (req.method === 'GET' && req.query.token) {
    const { data: invite, error } = await supabaseAdmin
      .from('invites')
      .select('*, role:roles(name, slug), tenant:tenants(name, branding)')
      .eq('token', req.query.token)
      .is('used_at', null)
      .single();

    if (error || !invite) return res.status(404).json({ error: 'Invite not found or already used' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invite has expired' });

    return res.json({
      valid: true,
      tenant_name: invite.tenant?.name,
      branding: invite.tenant?.branding,
      role_name: invite.role?.name,
      email: invite.email || null
    });
  }

  // ── Public: Accept invite (sign up) ──
  if (req.method === 'POST' && req.body?.token) {
    const { token, name, email, phone, password } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const { data: invite } = await supabaseAdmin
      .from('invites')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .single();

    if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'Invite has expired' });
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'This invite is locked to a different email address' });
    }

    // Create the user
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .insert({
        tenant_id: invite.tenant_id,
        email: email.toLowerCase(),
        name,
        phone: phone || null,
        role: 'crew', // legacy field
        role_id: invite.role_id,
        active: true
      })
      .select('*')
      .single();

    if (userErr) {
      if (userErr.code === '23505') return res.status(409).json({ error: 'A user with this email already exists' });
      return res.status(500).json({ error: userErr.message });
    }

    // Mark invite as used
    await supabaseAdmin
      .from('invites')
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq('id', invite.id);

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      tenant_id: invite.tenant_id,
      user_id: user.id,
      entity_type: 'user',
      entity_id: user.id,
      action: 'joined',
      details: { via: 'invite', role_id: invite.role_id }
    });

    return res.status(201).json({ user, message: 'Account created. You can now sign in.' });
  }

  // ── Authenticated routes ──
  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(400).json({ error: 'Tenant required' });
  const tenantId = tenant.id;

  // List invites
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('invites')
      .select('*, role:roles(name), invited_by_user:users!invites_invited_by_fkey(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ invites: data });
  }

  // Create invite
  if (req.method === 'POST') {
    const { role_id, email, invited_by, expires_days = 7 } = req.body || {};
    if (!role_id) return res.status(400).json({ error: 'role_id required' });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + expires_days * 86400000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('invites')
      .insert({
        tenant_id: tenantId,
        token,
        email: email || null,
        role_id,
        invited_by: invited_by || null,
        expires_at: expiresAt
      })
      .select('*, role:roles(name)')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const inviteUrl = `${req.headers.origin || 'https://ryujin-os.vercel.app'}/join.html?token=${token}`;

    return res.status(201).json({ ...data, invite_url: inviteUrl });
  }

  // Revoke invite
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    const { error } = await supabaseAdmin
      .from('invites')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
