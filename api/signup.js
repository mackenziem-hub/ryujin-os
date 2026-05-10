// ═══════════════════════════════════════════════════════════════
// /api/signup — public new-tenant + new-owner signup.
//
// POST { email, password, business_name, full_name?, tier_slug? }
//
// Creates:
//   1. tenants row (slug derived from business_name + suffix if needed)
//   2. tenant_settings with starter entitlements
//   3. users row (role='owner') hashed password
//   4. sessions row (token returned to client)
//
// Returns: { ok, token, tenant_slug, redirect_url }
//
// If tier_slug provided + Stripe configured, redirect goes through
// /api/checkout-subscription so the new owner can pay before
// onboarding completes. Otherwise redirect → /onboarding.html.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import crypto from 'node:crypto';

const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();

// Mirror api/auth.js:hashPassword — scrypt with salt prefixed via "${salt}:${hash}".
// Using the SAME format means a user signed up via /api/signup can immediately
// log in via /api/auth?action=login.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function makeSlug(businessName) {
  return String(businessName || 'tenant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tenant';
}

async function uniqueSlug(base) {
  let slug = base;
  let suffix = 0;
  while (true) {
    const { data } = await supabaseAdmin.from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (!data) return slug;
    suffix++;
    slug = `${base}-${suffix}`;
    if (suffix > 50) return `${base}-${crypto.randomBytes(3).toString('hex')}`;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { email, password, business_name, full_name, tier_slug } = req.body || {};
  if (!email || !password || !business_name) {
    return res.status(400).json({ error: 'email, password, business_name required' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'password must be ≥ 8 chars' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid email' });

  // Reject if email already in use.
  const { data: existing } = await supabaseAdmin
    .from('users').select('id').eq('email', email).maybeSingle();
  if (existing) return res.status(409).json({ error: 'email already registered. Sign in instead.' });

  // Provision tenant.
  const slug = await uniqueSlug(makeSlug(business_name));
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants')
    .insert({ slug, name: business_name, active: true, metadata: {} })
    .select('id, slug, name')
    .single();
  if (tErr) return res.status(500).json({ error: `tenant create failed: ${tErr.message}` });

  // Provision tenant_settings with starter entitlements.
  const { error: tsErr } = await supabaseAdmin
    .from('tenant_settings')
    .insert({
      tenant_id: tenant.id,
      entitlements: {
        tier: 'starter',
        pillars: [],
        tools: [],
        integrations: [],
        features: { white_label: false, demo_data: false, agent_layer_only: false },
      },
      label_overrides: {},
    });
  if (tsErr) console.error('[signup] tenant_settings insert non-fatal:', tsErr.message);

  // Provision owner user. password_hash format matches api/auth.js so the
  // login endpoint accepts these credentials immediately.
  const password_hash = hashPassword(password);
  const { data: user, error: uErr } = await supabaseAdmin
    .from('users')
    .insert({
      tenant_id: tenant.id,
      email,
      name: full_name || email.split('@')[0],
      role: 'owner',
      password_hash,
    })
    .select('id, email, name')
    .single();
  if (uErr) {
    // Cleanup: roll back tenant if user create fails.
    await supabaseAdmin.from('tenants').delete().eq('id', tenant.id);
    return res.status(500).json({ error: `user create failed: ${uErr.message}` });
  }

  // Issue session.
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();   // 30 days
  await supabaseAdmin
    .from('sessions')
    .insert({ token, user_id: user.id, tenant_id: tenant.id, expires_at: expiresAt });

  // Optional: kick off Stripe Checkout if tier was picked.
  let redirect_url = `${APP_BASE}/onboarding.html?welcome=1`;
  if (tier_slug && process.env.STRIPE_SECRET_KEY) {
    redirect_url = `${APP_BASE}/onboarding.html?welcome=1&tier=${encodeURIComponent(tier_slug)}`;
  }

  return res.status(201).json({
    ok: true,
    token,
    tenant_slug: tenant.slug,
    user: { id: user.id, email: user.email, name: user.name },
    redirect_url,
  });
}
