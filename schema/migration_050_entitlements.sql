-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 050: Entitlements (productization)
-- Adds tenant_settings.entitlements jsonb so tenants can hold
-- different combinations of pillars / tools / integrations / features.
--
-- Shape (locked to match lib/entitlements.js):
-- {
--   "tier": "starter|growth|pro|agent_layer|tools_only|enterprise",
--   "pillars": ["sales", "service", ...],
--   "tools":   ["proposal", "estimator", "doc", "chat", "marketing_scheduler"],
--   "integrations": ["ghl", "hubspot", "jobnimbus", "acculynx", "quickbooks", "zapier"],
--   "features": {
--     "white_label": false,
--     "demo_data": false,
--     "agent_layer_only": false
--   }
-- }
--
-- Saleable pillar slugs (6): marketing, sales, production, service, customer, finance.
-- Infra pillars (always available): hq, admin. NOT stored in pillars[] — implicit.
-- ═══════════════════════════════════════════════════════════════

alter table tenant_settings
  add column if not exists entitlements jsonb default jsonb_build_object(
    'tier', 'starter',
    'pillars', '[]'::jsonb,
    'tools', '[]'::jsonb,
    'integrations', '[]'::jsonb,
    'features', jsonb_build_object(
      'white_label', false,
      'demo_data', false,
      'agent_layer_only', false
    )
  );

-- Backfill existing rows to the same default (in case the default doesn't apply retro).
update tenant_settings set entitlements = jsonb_build_object(
  'tier', 'starter',
  'pillars', '[]'::jsonb,
  'tools', '[]'::jsonb,
  'integrations', '[]'::jsonb,
  'features', jsonb_build_object(
    'white_label', false,
    'demo_data', false,
    'agent_layer_only', false
  )
) where entitlements is null;

-- Plus Ultra (tenant 1) keeps full access — bump to pro tier with all saleable pillars.
update tenant_settings ts
set entitlements = jsonb_build_object(
  'tier', 'pro',
  'pillars', '["marketing","sales","production","service","customer","finance"]'::jsonb,
  'tools', '["proposal","estimator","doc","chat","marketing_scheduler"]'::jsonb,
  'integrations', '["ghl"]'::jsonb,
  'features', jsonb_build_object(
    'white_label', false,
    'demo_data', false,
    'agent_layer_only', false
  )
)
from tenants t
where ts.tenant_id = t.id and t.slug = 'plus-ultra';

alter table tenant_settings alter column entitlements set not null;

comment on column tenant_settings.entitlements is
  'What this tenant has paid for. Read via lib/entitlements.js getEntitlements(). Updated by Stripe webhook on subscription create/update/delete.';
