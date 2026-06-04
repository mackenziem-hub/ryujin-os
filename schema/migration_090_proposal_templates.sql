-- ═══════════════════════════════════════════════════════════════
-- Migration 090 · proposal_templates (presets / blueprints)
--
-- Named blueprints for the unified proposal generator. A template is an
-- ordered list of block references (resolved against proposal_blocks) plus a
-- product plan describing which offers/add-ons the proposal presents. The
-- builder picks a template, then a proposal_instances row is materialized
-- from it (resolved + snapshotted).
--
-- WHY: the recurring proposal shapes (full replacement, rejuvenation-vs-
-- replacement two-path, repair, commercial) are rebuilt by hand each time.
-- A template captures the section order, per-template overrides, and the
-- product plan once, so a new proposal is one click instead of a re-assembly.
--
-- Shape:
--   sections jsonb: an ordered array of block_key strings (the resolver also
--     accepts { "block_key": "...", "visible": true, "overrides": {...} } objects
--     for per-template tweaks). Example: ["hero","intro","products","accept"]
--   product_plan jsonb: how the products/pricing section is populated:
--     {
--       "mode": "single" | "good_better_best" | "two_path" | "configurator" | "gutters" | "repair",
--       "offer_slugs": ["gold","platinum","diamond"],
--       "recommended": "platinum",
--       "addons_default": ["leaf_guard","ridge_vent"],
--       "two_path": { "pathA": {...}, "pathB": {...} }
--     }
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,

  -- Blueprint
  sections      JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_plan  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- State
  is_default    BOOLEAN DEFAULT false,
  active        BOOLEAN DEFAULT true,
  sort_order    INTEGER DEFAULT 0,

  -- Audit
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_proposal_templates_tenant
  ON proposal_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposal_templates_active
  ON proposal_templates(tenant_id, active);

-- Touch trigger for updated_at
CREATE OR REPLACE FUNCTION proposal_templates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_templates_touch ON proposal_templates;
CREATE TRIGGER trg_proposal_templates_touch
  BEFORE UPDATE ON proposal_templates
  FOR EACH ROW EXECUTE FUNCTION proposal_templates_touch_updated_at();

-- RLS
ALTER TABLE proposal_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_templates_tenant_isolation ON proposal_templates;
CREATE POLICY proposal_templates_tenant_isolation ON proposal_templates
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
