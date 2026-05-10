// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Stripe price catalog.
//
// Single source of truth for what we sell. The seeder script
// (scripts/_oneshot/_seed_stripe_catalog.mjs) creates Stripe Products
// + Prices from this config. The subscription webhook
// (api/stripe-subscription-webhook.js) maps Stripe price_id back to
// the entitlements shape (lib/entitlements.js TIER_PRESETS).
//
// EDIT MAC: change `monthly_usd` values to your final pricing before
// running the seeder. Re-running the seeder updates Stripe Products
// in place but creates NEW Prices (Stripe Prices are immutable);
// keep old Price ids active until all subscribers migrate.
// ═══════════════════════════════════════════════════════════════

export const TIER_CATALOG = [
  {
    tier: 'tools_single',
    name: 'Tool — single',
    monthly_usd: 29,
    annual_usd: 290,                                      // 2 months free
    blurb: 'One standalone tool of your choice.',
    metadata: {
      tier_slug: 'tools_single',
      pillars: '[]',
      tools: '[]',                                        // operator picks at checkout
      features: '{}',
    },
  },
  {
    tier: 'starter',
    name: 'Starter Pillar',
    monthly_usd: 99,
    annual_usd: 990,
    blurb: 'One pillar — admin, agent, all interactive tools, advanced layer.',
    metadata: {
      tier_slug: 'starter',
      pillars: '[]',                                      // operator picks 1
      tools: '[]',
      features: '{}',
    },
  },
  {
    tier: 'growth',
    name: 'Growth',
    monthly_usd: 199,
    annual_usd: 1990,
    blurb: 'Any 3 pillars + daily AI agent briefings.',
    metadata: {
      tier_slug: 'growth',
      pillars: '[]',                                      // operator picks 3
      tools: '[]',
      features: '{}',
    },
  },
  {
    tier: 'pro',
    name: 'Pro · Full OS',
    monthly_usd: 399,
    annual_usd: 3990,
    blurb: 'All 6 saleable pillars + HQ + Admin + every standalone tool.',
    metadata: {
      tier_slug: 'pro',
      pillars: '["marketing","sales","production","service","customer","finance"]',
      tools: '["proposal","estimator","doc","chat","marketing_scheduler"]',
      features: '{}',
    },
    featured: true,
  },
  {
    tier: 'agent_layer',
    name: 'Agent Layer',
    monthly_usd: 249,
    annual_usd: 2490,
    blurb: 'Bring your own CRM. AI agent overlay only — no data migration.',
    metadata: {
      tier_slug: 'agent_layer',
      pillars: '["marketing","sales","production","service","customer","finance"]',
      tools: '[]',
      features: '{"agent_layer_only":true}',
    },
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    monthly_usd: 799,
    annual_usd: 7990,
    blurb: 'Pro + custom integration + onboarding + branded white-label.',
    metadata: {
      tier_slug: 'enterprise',
      pillars: '["marketing","sales","production","service","customer","finance"]',
      tools: '["proposal","estimator","doc","chat","marketing_scheduler"]',
      features: '{"white_label":true}',
    },
  },
];

// Maps Stripe price metadata.tier_slug → entitlement update shape.
// Webhook reads metadata off the Price (set by the seeder), constructs
// the entitlements jsonb, and writes via lib/entitlements.invalidateEntitlements
// + supabase update.
export function entitlementsForTier(tierSlug) {
  const item = TIER_CATALOG.find(t => t.tier === tierSlug);
  if (!item) return null;
  return {
    tier: tierSlug,
    pillars: JSON.parse(item.metadata.pillars || '[]'),
    tools: JSON.parse(item.metadata.tools || '[]'),
    integrations: [],
    features: { white_label: false, demo_data: false, agent_layer_only: false, ...JSON.parse(item.metadata.features || '{}') },
  };
}

// Helper for the pricing page to render cards consistently.
export function publicCatalog() {
  return TIER_CATALOG.map(t => ({
    tier: t.tier, name: t.name,
    monthly_usd: t.monthly_usd, annual_usd: t.annual_usd,
    blurb: t.blurb, featured: !!t.featured,
  }));
}
