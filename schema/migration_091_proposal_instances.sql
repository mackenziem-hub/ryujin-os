-- ═══════════════════════════════════════════════════════════════
-- Migration 091 · proposal_instances (per-proposal renderable + frozen snapshot)
--
-- One row per generated proposal. Materialized from a proposal_templates
-- blueprint: section refs are resolved against proposal_blocks, product +
-- pricing are snapshotted, and the result is rendered by the dynamic public
-- renderer at /proposals/<slug> (or via share_token).
--
-- WHY: a sent proposal must be FROZEN. The customer always sees exactly what
-- was sent even if blocks, templates, or pricing change later (see
-- feedback_no_changes_to_sent_proposals). This row carries the fully resolved
-- sections + pricing_snapshot so rendering never re-reads the live library.
-- estimate_id is NULLABLE: a proposal can be estimate-backed OR standalone
-- (custom scope, repair, info-only), same as migration 067 custom_proposals.
--
-- Shape:
--   sections jsonb: resolved + snapshotted block payloads in render order
--     (template refs already merged with overrides; no live lookups at render).
--   product_selection jsonb: chosen offers/add-ons/two-path resolution.
--   variables jsonb: per-proposal merge fields (customer name, address, rep).
--   pricing_snapshot jsonb: frozen totals/tiers at send time (CAD, pre/incl HST).
--   accepted_payload jsonb: signature + acceptance metadata on accept.
--
-- Lifecycle: draft → sent → viewed → accepted (or expired / archived).
-- locked_at stamps when the snapshot is frozen (typically on send/accept).
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_instances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity / addressing
  slug               TEXT UNIQUE NOT NULL,
  share_token        TEXT UNIQUE,

  -- Source links (estimate optional: estimate-backed OR standalone)
  estimate_id        UUID REFERENCES estimates(id) ON DELETE SET NULL,
  template_id        UUID REFERENCES proposal_templates(id),
  customer_id        UUID REFERENCES customers(id),
  ghl_contact_id     TEXT,

  -- Resolved + snapshotted content
  sections           JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_selection  JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables          JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_snapshot   JSONB NOT NULL DEFAULT '{}'::jsonb,
  renderer_version   TEXT NOT NULL DEFAULT 'v2',

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sent','viewed','accepted','expired','archived')),
  sent_at            TIMESTAMPTZ,
  accepted_at        TIMESTAMPTZ,
  accepted_payload   JSONB,
  locked_at          TIMESTAMPTZ,

  -- Engagement
  view_count         INTEGER NOT NULL DEFAULT 0,
  last_viewed_at     TIMESTAMPTZ,

  -- Audit
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_instances_share_token
  ON proposal_instances(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposal_instances_slug
  ON proposal_instances(slug);
CREATE INDEX IF NOT EXISTS idx_proposal_instances_estimate
  ON proposal_instances(estimate_id) WHERE estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposal_instances_tenant_status
  ON proposal_instances(tenant_id, status);

-- Touch trigger for updated_at
CREATE OR REPLACE FUNCTION proposal_instances_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_instances_touch ON proposal_instances;
CREATE TRIGGER trg_proposal_instances_touch
  BEFORE UPDATE ON proposal_instances
  FOR EACH ROW EXECUTE FUNCTION proposal_instances_touch_updated_at();

-- RLS
ALTER TABLE proposal_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_instances_tenant_isolation ON proposal_instances;
CREATE POLICY proposal_instances_tenant_isolation ON proposal_instances
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
