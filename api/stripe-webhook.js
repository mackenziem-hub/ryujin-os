// Ryujin OS — Stripe Webhook Handler (SCAFFOLD)
//
// POST /api/stripe-webhook
// Auth: Stripe signature verification (NEVER token/cookie auth)
// Events handled:
//   * checkout.session.completed → flip deposit_status='cleared',
//                                  state='deposit_pending' → 'schedule_pending'
//   * checkout.session.expired   → deposit_status='failed' if still pending
//
// 🚧 NOT YET WIRED — requires STRIPE_WEBHOOK_SECRET + `npm install stripe`.
// See api/deposit-checkout.js for full setup checklist.
//
// Manus peer review §5 + Bible v0.2 §2 hard rules:
//   - Idempotent on payment_intent ID (skip if deposit_payment_intent already set)
//   - Verify Stripe signature before trusting payload
//   - Verify metadata.ryujin_estimate_id + ryujin_tenant_id match the estimate
//   - Verify amount matches estimate.deposit_amount (no client-supplied override)
//   - Use assertTransition guard before state change
//   - WEBHOOK IS THE ONLY AUTHORITY for deposit_status='cleared'
//
// Vercel raw body handling: must disable bodyParser to compute Stripe signature
// over the raw byte stream. Enabled via `export const config` below.

import { supabaseAdmin } from '../lib/supabase.js';
import { assertTransition, computeScheduleDue } from '../lib/state.js';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

// Vercel: read raw body (Buffer) for signature verification
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({
      error: 'Stripe not configured',
      code: 'STRIPE_NOT_CONFIGURED'
    });
  }

  // Lazy-load Stripe SDK
  let stripe;
  try {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
  } catch {
    return res.status(503).json({ error: 'Stripe SDK not installed', code: 'STRIPE_SDK_MISSING' });
  }

  // Read raw body + verify signature
  const rawBody = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[stripe-webhook] signature verify failed', e?.message);
    return res.status(400).json({ error: `Webhook signature failed: ${e?.message}` });
  }

  console.log(`[stripe-webhook] received ${event.type} (${event.id})`);

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event, res);
    case 'checkout.session.expired':
      return handleCheckoutExpired(event, res);
    default:
      // Acknowledge but ignore — Stripe expects 2xx
      return res.status(200).json({ received: true, type: event.type, ignored: true });
  }
}

async function handleCheckoutCompleted(event, res) {
  const session = event.data.object;
  const estimateId = session.metadata?.ryujin_estimate_id;
  const tenantId = session.metadata?.ryujin_tenant_id;
  const paymentIntent = session.payment_intent;

  if (!estimateId || !tenantId) {
    console.error('[stripe-webhook] missing metadata', session.id);
    return res.status(400).json({ error: 'Missing ryujin_estimate_id or ryujin_tenant_id metadata' });
  }
  if (!paymentIntent) {
    return res.status(400).json({ error: 'Missing payment_intent on session' });
  }

  // Idempotency guard: already processed?
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('estimates')
    .select('id, tenant_id, state, deposit_status, deposit_amount, deposit_payment_intent')
    .eq('id', estimateId)
    .eq('tenant_id', tenantId)
    .single();
  if (lookupErr || !existing) {
    console.error('[stripe-webhook] estimate not found', estimateId, lookupErr);
    return res.status(404).json({ error: 'Estimate not found' });
  }
  if (existing.deposit_payment_intent === paymentIntent) {
    console.log('[stripe-webhook] already processed (idempotent skip)', paymentIntent);
    return res.status(200).json({ received: true, idempotent: true });
  }

  // Amount match check — never trust client; cross-check session amount with estimate
  const sessionAmountCents = session.amount_total;
  if (sessionAmountCents !== existing.deposit_amount) {
    console.error('[stripe-webhook] amount mismatch', { session: sessionAmountCents, estimate: existing.deposit_amount });
    return res.status(400).json({ error: 'Session amount does not match estimate.deposit_amount' });
  }

  // State machine guard
  try {
    assertTransition('estimate', existing.state, 'schedule_pending');
  } catch (e) {
    // Don't 500 — webhook ack must be 2xx for Stripe to stop retrying. Log + accept.
    console.error('[stripe-webhook] illegal transition (logged, not retried)', e.message);
    return res.status(200).json({ received: true, error: 'illegal_transition', detail: e.message });
  }

  const now = new Date().toISOString();
  const scheduleDueBy = computeScheduleDue(now);

  const { error: updateErr } = await supabaseAdmin
    .from('estimates')
    .update({
      state: 'schedule_pending',
      deposit_status: 'cleared',
      deposit_cleared_at: now,
      deposit_payment_intent: paymentIntent,
      schedule_due_by: scheduleDueBy
    })
    .eq('id', estimateId);

  if (updateErr) {
    console.error('[stripe-webhook] update failed', updateErr);
    return res.status(500).json({ error: 'Update failed', detail: updateErr.message });
  }

  // Audit log
  await supabaseAdmin.from('activity_log').insert({
    tenant_id: tenantId,
    entity_type: 'estimate',
    entity_id: estimateId,
    action: 'deposit_cleared',
    details: {
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
      amount_cents: sessionAmountCents,
      previous_state: existing.state,
      new_state: 'schedule_pending',
      schedule_due_by: scheduleDueBy
    }
  }).then(({ error }) => { if (error) console.error('[stripe-webhook] audit_log fail', error.message); });

  console.log(`[stripe-webhook] deposit cleared for estimate ${estimateId} (${paymentIntent})`);
  return res.status(200).json({ received: true, estimate_id: estimateId, new_state: 'schedule_pending' });
}

async function handleCheckoutExpired(event, res) {
  const session = event.data.object;
  const estimateId = session.metadata?.ryujin_estimate_id;
  const tenantId = session.metadata?.ryujin_tenant_id;

  if (!estimateId || !tenantId) {
    return res.status(400).json({ error: 'Missing metadata' });
  }

  // Only flip to failed if still pending; never overwrite a cleared deposit
  const { data: existing } = await supabaseAdmin
    .from('estimates')
    .select('deposit_status')
    .eq('id', estimateId)
    .eq('tenant_id', tenantId)
    .single();
  if (!existing || existing.deposit_status !== 'pending') {
    return res.status(200).json({ received: true, ignored: true, reason: 'deposit not pending' });
  }

  await supabaseAdmin
    .from('estimates')
    .update({ deposit_status: 'failed' })
    .eq('id', estimateId);

  console.log(`[stripe-webhook] checkout expired for estimate ${estimateId}`);
  return res.status(200).json({ received: true, estimate_id: estimateId, deposit_status: 'failed' });
}

// Disable Vercel's body parser — we need raw bytes for Stripe signature verification
export const config = {
  api: {
    bodyParser: false
  }
};
