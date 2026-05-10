// ═══════════════════════════════════════════════════════════════
// /api/checkout-subscription
//
// POST { price_id, tenant_id?, email?, success_url?, cancel_url? }
//
// Creates a Stripe Checkout Session for a subscription. Used by:
//   - /pricing.html  → operator clicks "Choose Plan"
//   - /upgrade.html  → existing tenant upgrades
//   - /signup.html   → new tenant signs up + immediately picks a tier
//
// Returns: { checkout_url } — page does location.href = checkout_url.
//
// Required env: STRIPE_SECRET_KEY (already set for deposits flow).
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe not configured', code: 'STRIPE_NOT_CONFIGURED' });
  }

  const body = req.body || {};
  const priceId = body.price_id;
  if (!priceId) return res.status(400).json({ error: 'price_id required' });

  let stripe;
  try {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
  } catch {
    return res.status(503).json({ error: 'Stripe SDK not installed', code: 'STRIPE_SDK_MISSING' });
  }

  // Resolve tenant + Stripe customer (existing or new).
  let tenantId = body.tenant_id || null;
  let stripeCustomerId = null;
  let customerEmail = body.email || null;

  if (tenantId) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id, slug, metadata').eq('id', tenantId).maybeSingle();
    if (tenant) {
      stripeCustomerId = tenant.metadata?.stripe_customer_id || null;
      if (!customerEmail) {
        const { data: ownerUser } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('tenant_id', tenant.id)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle();
        if (ownerUser?.email) customerEmail = ownerUser.email;
      }
    }
  }

  // Create Checkout session.
  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: body.success_url || `${APP_BASE}/onboarding.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: body.cancel_url || `${APP_BASE}/pricing.html?canceled=1`,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    automatic_tax: { enabled: false },                    // turn on later if you collect tax
    metadata: tenantId ? { tenant_id: tenantId } : {},
  };
  if (tenantId) params.client_reference_id = tenantId;
  if (stripeCustomerId) params.customer = stripeCustomerId;
  else if (customerEmail) params.customer_email = customerEmail;

  try {
    const session = await stripe.checkout.sessions.create(params);
    return res.status(200).json({ checkout_url: session.url, session_id: session.id });
  } catch (e) {
    console.error('[checkout-sub] create failed:', e?.message);
    return res.status(500).json({ error: e?.message });
  }
}
