-- ═══════════════════════════════════════════════════════════════
-- Migration 099: proposal_packages (per-tenant proposal tier catalog)
--
-- Backs the few-click proposal wizard (proposal-wizard.html, Order 4).
-- Today the Gold/Platinum/Diamond tier copy is hard-coded in
-- api/proposal-v2.js + api/proposal.js (TIER_CATALOG). This table makes
-- the catalog per-tenant and editable without a code deploy, while
-- lib/proposalPackages.js falls back to the canonical hard-coded copy
-- when a tenant has no rows, so sent proposals stay byte-identical.
--
-- Seeded by scripts/seed-proposal-packages.mjs from
-- lib/proposalPackages.js CANONICAL_PACKAGES.
--
-- Applied by hand via the Supabase Management API. Idempotent.
-- Follows the api/proposal.js TIER_CATALOG shape; no RLS stanza, same as
-- migration_067_custom_proposals (access is app-layer tenant-scoped via
-- requireTenant + supabaseAdmin .eq('tenant_id', ...)).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_packages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system          text NOT NULL DEFAULT 'asphalt',
  slug            text NOT NULL,
  tier_tag        text,
  name            text NOT NULL,
  description     text,
  shingle_product text,
  warranty_years  integer,
  perks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  multiplier      numeric,
  is_recommended  boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system, slug)
);

COMMENT ON TABLE proposal_packages IS
  'Per-tenant proposal tier catalog (Gold/Platinum/Diamond etc.) for the proposal wizard. Falls back to lib/proposalPackages.js CANONICAL_PACKAGES when empty.';

-- The wizard lists a tenant's active packages for a system, in card order.
CREATE INDEX IF NOT EXISTS idx_proposal_packages_tenant_system
  ON proposal_packages (tenant_id, system, sort_order)
  WHERE active = true;
