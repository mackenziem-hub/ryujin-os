// ═══════════════════════════════════════════════════════════════
// /api/stripe-subscription-webhook
//
// SUBSCRIPTION events only (separate from /api/stripe-webhook which
// handles customer-proposal deposits). Maps Stripe subscription state
// → tenant_settings.entitlements.
//
// Events handled:
//   checkout.session.completed           — first-time signup → activate tier
//   customer.subscription.created        — same as above (belt + suspenders)
//   customer.subscription.updated        — tier change / pause / resume
//   customer.subscription.deleted        — cancellation → downgrade to starter
//   invoice.payment_failed               — flag tenant.metadata.payment_state
//
// Required env: STRIPE_SECRET_KEY, STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
//
// Auth: Stripe signature verification only. Vercel raw-body required.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { entitlementsForTier } from '../lib/stripeCatalog.js';
import { invalidateEntitlements } from '../lib/entitlements.js';

const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const WEBHOOK_SECRET = (process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET || '').trim();

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function findTenantByCustomer(stripeCustomerId) {
  // Tenants store their Stripe customer id in metadata.stripe_customer_id
  // (set by /api/checkout-subscription on first checkout).
  const { data } = await supabaseAdmin
    .from('tenants')
    .select('id, slug, metadata')
    .filter('metadata->>stripe_customer_id', 'eq', stripeCustomerId)
    .maybeSingle();
  return data;
}

async function applyTier(tenantId, tierSlug) {
  const ent = entitlementsForTier(tierSlug);
  if (!ent) {
    console.error(`[stripe-sub] unknown tier: ${tierSlug}`);
    return false;
  }
  const { error } = await supabaseAdmin
    .from('tenant_settings')
    .update({ entitlements: ent, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (error) {
    console.error(`[stripe-sub] entitlements write failed for tenant ${tenantId}:`, error.message);
    return false;
  }
  invalidateEntitlements(tenantId);
  return true;
}

function tierFromSubscription(sub) {
  // Look up the tier_slug from the first item's price metadata.
  const item = sub?.items?.data?.[0];
  return item?.price?.metadata?.tier_slug || null;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe subscription webhook not configured', code: 'STRIPE_SUB_NOT_CONFIGURED' });
  }

  let stripe;
  try {
    const Stripe = (await import('stripe')).default;
    stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
  } catch {
    return res.status(503).json({ error: 'Stripe SDK not installed', code: 'STRIPE_SDK_MISSING' });
  }

  const rawBody = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).json({ error: `signature verify failed: ${e.message}` });
  }

  console.log(`[stripe-sub] received ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') return res.status(200).json({ received: true, ignored: 'non-subscription' });
        const tenantId = session.client_reference_id || session.metadata?.tenant_id;
        const customerId = session.customer;
        if (!tenantId) return res.status(200).json({ received: true, error: 'missing tenant_id' });

        // Stamp the customer id onto the tenant for future event lookups.
        const { data: tenant } = await supabaseAdmin
          .from('tenants').select('id, metadata').eq('id', tenantId).maybeSingle();
        if (tenant) {
          await supabaseAdmin
            .from('tenants')
            .update({ metadata: { ...(tenant.metadata || {}), stripe_customer_id: customerId } })
            .eq('id', tenantId);
        }

        // Pull subscription to read tier metadata.
        const subscriptionId = session.subscription;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const tier = tierFromSubscription(sub);
          if (tier) await applyTier(tenantId, tier);
        }
        return res.status(200).json({ received: true });
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const tenant = await findTenantByCustomer(sub.customer);
        if (!tenant) return res.status(200).json({ received: true, error: 'tenant not found for customer' });
        const tier = tierFromSubscription(sub);
        if (tier) await applyTier(tenant.id, tier);
        return res.status(200).json({ received: true });
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const tenant = await findTenantByCustomer(sub.customer);
        if (!tenant) return res.status(200).json({ received: true, error: 'tenant not found for customer' });
        // Downgrade to starter (no pillars, no tools).
        await applyTier(tenant.id, 'starter');
        return res.status(200).json({ received: true });
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const tenant = await findTenantByCustomer(inv.customer);
        if (tenant) {
          await supabaseAdmin
            .from('tenants')
            .update({ metadata: { ...(tenant.metadata || {}), payment_state: 'failed', last_payment_failure_at: new Date().toISOString() } })
            .eq('id', tenant.id);
        }
        return res.status(200).json({ received: true });
      }

      default:
        return res.status(200).json({ received: true, type: event.type, ignored: true });
    }
  } catch (e) {
    console.error('[stripe-sub] handler error:', e?.message);
    return res.status(500).json({ error: e?.message });
  }
}
