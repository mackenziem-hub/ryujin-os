-- ═══════════════════════════════════════════════════════════════
-- Migration 099: proposal_packages (per-tenant proposal tier catalog)
--
-- Makes the proposal tier catalog (Gold / Platinum / Diamond, and any future
-- tiers) a per-tenant table instead of a hardcoded TIER_CATALOG in
-- api/proposal.js. The few-click proposal wizard (proposal-wizard.html) reads
-- these via GET /api/proposal-packages so tiers, perks, warranties, and
-- multipliers are configurable without a code change.
--
-- ZERO regression: this table being present changes nothing on its own. The
-- live v1 renderer keeps using its in-code TIER_CATALOG, and lib/proposalPackages.js
-- falls back to the same catalog when this table is empty, so sent proposals
-- render byte-identical until a tenant deliberately seeds + adopts it.
--
-- Applied by hand via the Supabase Management API (MIGRATION_BUNDLE pattern).
-- Idempotent (IF NOT EXISTS guards). Do NOT auto-run against prod.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_packages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  system          TEXT NOT NULL DEFAULT 'asphalt',       -- asphalt | metal | exterior | combined
  slug            TEXT NOT NULL,                          -- gold | platinum | diamond
  tier_tag        TEXT,                                   -- GOOD | BETTER | BEST
  name            TEXT NOT NULL,                          -- 'Platinum · Landmark Pro'
  shingle_product TEXT,                                   -- 'CertainTeed Landmark Pro'
  warranty_years  INTEGER,                                -- Plus Ultra workmanship warranty years
  perks           JSONB NOT NULL DEFAULT '[]'::jsonb,     -- bullet list shown on the tier card
  multiplier      NUMERIC(5,3),                           -- local hard-cost -> sell multiplier
  is_recommended  BOOLEAN NOT NULL DEFAULT false,         -- the preselected tier (Platinum)
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, system, slug)
);

CREATE INDEX IF NOT EXISTS idx_proposal_packages_tenant
  ON proposal_packages (tenant_id, system, active, sort_order);

COMMENT ON TABLE proposal_packages IS
  'Per-tenant proposal tier catalog (Gold/Platinum/Diamond etc). Seeded from the in-code TIER_CATALOG by scripts/seed-proposal-packages.mjs; lib/proposalPackages.js falls back to that catalog when empty so sent proposals render byte-identical.';
