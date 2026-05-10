// One-shot: create Stripe Products + Prices from lib/stripeCatalog.js.
// Idempotent — looks up by metadata.tier_slug + interval and reuses
// existing Products. Always creates new Prices (Stripe Prices are
// immutable); old Prices left active so existing subscribers don't
// break — manually archive them in Stripe dashboard if you want to
// retire a tier.
//
// Required env (in .env.local or shell):
//   STRIPE_SECRET_KEY=sk_live_xxx OR sk_test_xxx
//
// Run: node scripts/_oneshot/_seed_stripe_catalog.mjs
// Output: writes Stripe price_id mapping to scripts/_oneshot/.stripe_catalog_ids.json
// for the webhook to reference.

import fs from 'node:fs';
import path from 'node:path';
import { TIER_CATALOG } from '../../lib/stripeCatalog.js';

// Load .env.local if present
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
if (!KEY) { console.error('STRIPE_SECRET_KEY missing'); process.exit(1); }

const Stripe = (await import('stripe')).default;
const stripe = new Stripe(KEY, { apiVersion: '2024-11-20.acacia' });

const ids = {};

for (const item of TIER_CATALOG) {
  // Find or create Product (idempotent by metadata.tier_slug)
  const existing = await stripe.products.search({ query: `metadata['tier_slug']:'${item.tier}'`, limit: 1 });
  let product;
  if (existing.data.length) {
    product = await stripe.products.update(existing.data[0].id, {
      name: item.name,
      description: item.blurb,
      metadata: item.metadata,
    });
    console.log(`[product] reused ${product.id} for ${item.tier}`);
  } else {
    product = await stripe.products.create({
      name: item.name,
      description: item.blurb,
      metadata: item.metadata,
    });
    console.log(`[product] created ${product.id} for ${item.tier}`);
  }

  // Always create new Price entries (immutable). Archive old ones in dashboard if reshuffling.
  const monthly = await stripe.prices.create({
    product: product.id,
    unit_amount: item.monthly_usd * 100,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { ...item.metadata, billing_interval: 'month' },
    nickname: `${item.name} · Monthly`,
  });
  console.log(`[price] monthly ${monthly.id} for ${item.tier} ($${item.monthly_usd}/mo)`);

  let annual = null;
  if (item.annual_usd) {
    annual = await stripe.prices.create({
      product: product.id,
      unit_amount: item.annual_usd * 100,
      currency: 'usd',
      recurring: { interval: 'year' },
      metadata: { ...item.metadata, billing_interval: 'year' },
      nickname: `${item.name} · Annual`,
    });
    console.log(`[price] annual ${annual.id} for ${item.tier} ($${item.annual_usd}/yr)`);
  }

  ids[item.tier] = {
    product_id: product.id,
    monthly_price_id: monthly.id,
    annual_price_id: annual?.id || null,
  };
}

const outPath = path.resolve('scripts/_oneshot/.stripe_catalog_ids.json');
fs.writeFileSync(outPath, JSON.stringify(ids, null, 2));
console.log(`\nWrote price-id map → ${outPath}`);
console.log('\nNext steps:');
console.log('  1. Set STRIPE_PUBLISHABLE_KEY in Vercel env');
console.log('  2. Create webhook in Stripe dashboard pointing at /api/stripe-subscription-webhook');
console.log('  3. Set STRIPE_SUBSCRIPTION_WEBHOOK_SECRET in Vercel env');
console.log('  4. /pricing.html will render Checkout buttons against these prices');
