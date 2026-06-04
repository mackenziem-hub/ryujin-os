-- ═══════════════════════════════════════════════════════════════
-- Migration 089 · proposal_blocks (Sections content library)
--
-- Reusable content blocks for the unified proposal generator. Each row is
-- one library "section" (hero, intro, proof, reviews, guarantee, etc.) that
-- a proposal_templates blueprint can reference and a proposal_instances row
-- can resolve + snapshot at render time.
--
-- WHY: today proposal content is scattered across hand-edited static HTML
-- (public/proposals/*), per-estimate _envelope blobs, and inline copy in the
-- renderer. This table is the single tenant-level content library the block
-- builder reads from, so the same vetted hero / reviews / guarantee copy can
-- be dropped into any proposal instead of re-typed per job.
--
-- Shape:
--   content jsonb — block-type-specific payload, e.g.
--     hero:        { "headline": "...", "subhead": "...", "cover_url": "..." }
--     reviews:     { "items": [{ "name": "...", "quote": "...", "stars": 5 }] }
--     guarantee:   { "title": "...", "body": "...", "badge_url": "..." }
--     custom_html: { "html": "..." }
--   audience — 'customer' blocks render in the public proposal; 'internal'
--     blocks (margin notes, scope rationale) never leave the admin view.
--   is_library — true = appears in the builder picker; false = one-off /
--     instance-local block kept out of the picker.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposal_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  block_key   TEXT NOT NULL,
  block_type  TEXT NOT NULL CHECK (block_type IN (
                'hero','intro','message','proof','portfolio','reviews',
                'inspection','guarantee','why_us','comparison','transparency',
                'video','before_after','scope','products','accept','spacer',
                'custom_html'
              )),
  name        TEXT NOT NULL,

  -- Content
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience    TEXT NOT NULL DEFAULT 'customer'
                CHECK (audience IN ('customer','internal')),

  -- Library state
  is_library  BOOLEAN DEFAULT true,
  active      BOOLEAN DEFAULT true,
  sort_hint   INTEGER DEFAULT 0,

  -- Audit
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, block_key)
);

CREATE INDEX IF NOT EXISTS idx_proposal_blocks_tenant_type
  ON proposal_blocks(tenant_id, block_type);

-- Touch trigger for updated_at
CREATE OR REPLACE FUNCTION proposal_blocks_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_blocks_touch ON proposal_blocks;
CREATE TRIGGER trg_proposal_blocks_touch
  BEFORE UPDATE ON proposal_blocks
  FOR EACH ROW EXECUTE FUNCTION proposal_blocks_touch_updated_at();

-- RLS
ALTER TABLE proposal_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_blocks_tenant_isolation ON proposal_blocks;
CREATE POLICY proposal_blocks_tenant_isolation ON proposal_blocks
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
