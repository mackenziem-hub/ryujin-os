// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Entitlements
//
// Reads tenant_settings.entitlements (migration 050) and decides
// whether a tenant has paid for a given pillar / tool / integration.
//
// Compose with requireTenant — these gates assume req.tenant is set.
//
//   import { requireTenant } from './tenant.js';
//   import { requirePillar } from './entitlements.js';
//   export default requireTenant(requirePillar('sales')(handler));
//
// Locked vocabulary (matches schema/migration_050_entitlements.sql):
//   tiers:        tools_only · starter · growth · pro · agent_layer · enterprise
//   pillars:      marketing · sales · production · service · customer · finance
//   infra:        hq · admin   (always available, not stored in pillars[])
//   tools:        proposal · estimator · doc · chat · marketing_scheduler
//   integrations: ghl · hubspot · jobnimbus · acculynx · quickbooks · zapier
//   features:     white_label · demo_data · agent_layer_only
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

export const SALEABLE_PILLARS = ['marketing', 'sales', 'production', 'service', 'customer', 'finance'];
export const INFRA_PILLARS = ['hq', 'admin']; // always available regardless of tier
export const TOOLS = ['proposal', 'estimator', 'doc', 'chat', 'marketing_scheduler'];
export const INTEGRATIONS = ['ghl', 'hubspot', 'jobnimbus', 'acculynx', 'quickbooks', 'zapier'];

// Tier presets — what each tier unlocks if the operator hasn't customized.
// At signup the Stripe webhook can apply a preset; operators can later
// add à-la-carte tools/integrations on top.
export const TIER_PRESETS = {
  tools_only: { pillars: [], tools: [], features: {} }, // operator picks tools at checkout
  starter:    { pillars: [], tools: [], features: {} }, // operator picks 1 pillar at checkout
  growth:     { pillars: [], tools: [], features: {} }, // operator picks 3 pillars at checkout
  pro:        { pillars: [...SALEABLE_PILLARS], tools: [...TOOLS], features: {} },
  agent_layer:{ pillars: [...SALEABLE_PILLARS], tools: [], features: { agent_layer_only: true } },
  enterprise: { pillars: [...SALEABLE_PILLARS], tools: [...TOOLS], features: { white_label: true } },
};

const DEFAULT_ENTITLEMENTS = {
  tier: 'starter',
  pillars: [],
  tools: [],
  integrations: [],
  features: { white_label: false, demo_data: false, agent_layer_only: false },
};

// Small in-process cache to avoid hitting Supabase on every request.
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export async function getEntitlements(tenantId) {
  if (!tenantId) return { ...DEFAULT_ENTITLEMENTS };
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.value;

  const { data } = await supabaseAdmin
    .from('tenant_settings')
    .select('entitlements')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const value = data?.entitlements || { ...DEFAULT_ENTITLEMENTS };
  cache.set(tenantId, { value, ts: Date.now() });
  return value;
}

export function invalidateEntitlements(tenantId) {
  cache.delete(tenantId);
}

export function hasPillar(ent, slug) {
  if (INFRA_PILLARS.includes(slug)) return true;
  return Array.isArray(ent?.pillars) && ent.pillars.includes(slug);
}

export function hasTool(ent, slug) {
  return Array.isArray(ent?.tools) && ent.tools.includes(slug);
}

export function hasIntegration(ent, slug) {
  return Array.isArray(ent?.integrations) && ent.integrations.includes(slug);
}

export function hasFeature(ent, slug) {
  return ent?.features?.[slug] === true;
}

// True for tenants on the Agent Layer SKU — they see briefings/KPIs/agent
// recommendations but cannot CRUD on Ryujin-native tables (their data lives in
// an external CRM). Endpoints that mutate should refuse for these tenants.
export function isAgentLayerOnly(ent) {
  return hasFeature(ent, 'agent_layer_only');
}

// ─── Middleware factories ─────────────────────────────────────
// Wrap a handler that's already inside requireTenant. They look up
// entitlements, attach to req.entitlements, or 403 with upgrade hint.

function makeGate(check, kind) {
  return (slug) => (handler) => async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    const ent = await getEntitlements(req.tenant?.id);
    if (!check(ent, slug)) {
      return res.status(403).json({
        error: `${kind}_locked`,
        [kind]: slug,
        tier: ent?.tier || null,
        upgrade_url: '/upgrade.html',
      });
    }
    req.entitlements = ent;
    return handler(req, res);
  };
}

export const requirePillar = makeGate(hasPillar, 'pillar');
export const requireTool = makeGate(hasTool, 'tool');
export const requireIntegration = makeGate(hasIntegration, 'integration');

// Refuse mutating writes for Agent Layer tenants (they're read-only over
// external CRM data). Compose AFTER requireTenant; suitable for POST/PUT/DELETE
// handlers on Ryujin-native CRUD endpoints.
export function refuseAgentLayerWrites(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS' || req.method === 'GET') return handler(req, res);
    const ent = await getEntitlements(req.tenant?.id);
    if (isAgentLayerOnly(ent)) {
      return res.status(403).json({
        error: 'agent_layer_readonly',
        message: 'Agent Layer tenants overlay AI on an external CRM and cannot write to Ryujin-native tables. Upgrade to Pro to unlock writes.',
        upgrade_url: '/upgrade.html',
      });
    }
    req.entitlements = ent;
    return handler(req, res);
  };
}
