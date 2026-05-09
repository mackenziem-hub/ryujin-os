// Ryujin OS — Stripe Deposit Checkout Session Endpoint (SCAFFOLD)
//
// POST /api/deposit-checkout
// Auth: Bearer token (Owner or Admin role) — operator triggers Checkout for customer
// Body: { estimate_id }
//
// State guard: estimate.state must be 'deposit_pending' AND deposit_status='pending'.
// Returns: { checkout_url, session_id, expires_at }
//
// 🚧 NOT YET WIRED — requires:
//   1. Stripe account configured (Plus Ultra)
//   2. STRIPE_SECRET_KEY in .env.local + Vercel prod env
//   3. STRIPE_WEBHOOK_SECRET in .env.local + Vercel prod env
//   4. `npm install stripe`
//   5. Webhook URL registered in Stripe dashboard:
//      https://ryujin-os.vercel.app/api/stripe-webhook
//      Events: checkout.session.completed, checkout.session.expired
//
// Manus peer review §5 hard rules:
//   - deposit_amount stored as integer cents (validated here + in webhook)
//   - Reject client-supplied amount overrides (server reads from estimate row)
//   - Tenant + estimate metadata on Stripe Session for webhook idempotency match
//   - Bible v0.2 §2: webhook is the only authority that flips deposit_status='cleared'
//
// Manus peer review §8 decision: Go with strict guardrails. Stripe is backend
// control infrastructure, not a visual proposal refactor. Do not introduce
// hardcoded trust claims in any Stripe-adjacent surface.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';
import { assertTransition } from '../lib/state.js';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const APP_BASE = (process.env.APP_BASE_URL || 'https://ryujin-os.vercel.app').trim();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── Stripe configuration check ──
  if (!STRIPE_SECRET_KEY) {
    return res.status(503).json({
      error: 'Stripe not configured',
      detail: 'STRIPE_SECRET_KEY env var missing. See docs/stripe_setup.md.',
      code: 'STRIPE_NOT_CONFIGURED'
    });
  }

  // ── Owner/admin auth ──
  const auth = await requireOwnerOrAdmin(req, res);
  if (!auth) return;

  const { estimate_id } = req.body || {};
  if (!estimate_id) return res.status(400).json({ error: 'estimate_id required' });

  // ── Load estimate + state guard ──
  const { data: estimate, error: lookupErr } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, estimate_number, state, deposit_status, deposit_amount, final_accepted_total, customer:customers(full_name, email)')
    .eq('id', estimate_id)
    .eq('tenant_id', auth.tenant_id)
    .single();
  if (lookupErr || !estimate) {
    return res.status(404).json({ error: 'Estimate not found in your tenant' });
  }
  if (estimate.state !== 'deposit_pending') {
    return res.status(409).json({ error: 'Estimate not in deposit_pending state', current_state: estimate.state });
  }
  if (estimate.deposit_status !== 'pending') {
    return res.status(409).json({ error: 'Deposit already processed or not applicable', current_deposit_status: estimate.deposit_status });
  }

  // ── Amount validation (Manus peer review §5: integer cents only) ──
  const amount = Number(estimate.deposit_amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(500).json({ error: 'Estimate deposit_amount is not a valid integer cents value', amount });
  }

  // ── Lazy-load Stripe SDK ──
  let stripe;
  try {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
  } catch (e) {
    return res.status(503).json({
      error: 'Stripe SDK not installed',
      detail: 'Run `npm install stripe` and redeploy.',
      code: 'STRIPE_SDK_MISSING'
    });
  }

  // ── Create Checkout Session ──
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      currency: 'cad',
      customer_email: estimate.customer?.email || undefined,
      line_items: [{
        price_data: {
          currency: 'cad',
          unit_amount: amount,
          product_data: {
            name: `Deposit — Estimate PU-${estimate.estimate_number}`,
            description: estimate.customer?.full_name ? `For ${estimate.customer.full_name}` : undefined
          }
        },
        quantity: 1
      }],
      metadata: {
        ryujin_estimate_id: estimate.id,
        ryujin_tenant_id: estimate.tenant_id,
        ryujin_estimate_number: String(estimate.estimate_number || '')
      },
      payment_intent_data: {
        metadata: {
          ryujin_estimate_id: estimate.id,
          ryujin_tenant_id: estimate.tenant_id
        }
      },
      success_url: `${APP_BASE}/proposal-client.html?share=${estimate.id}&deposit=ok`,
      cancel_url: `${APP_BASE}/proposal-client.html?share=${estimate.id}&deposit=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + (24 * 3600)  // 24h expiry
    });

    return res.status(200).json({
      ok: true,
      checkout_url: session.url,
      session_id: session.id,
      expires_at: new Date(session.expires_at * 1000).toISOString(),
      estimate_id: estimate.id,
      amount_cents: amount
    });
  } catch (e) {
    console.error('[deposit-checkout] Stripe error', e?.message);
    return res.status(502).json({ error: 'Stripe Checkout creation failed', detail: e?.message });
  }
}
