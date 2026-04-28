-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 025: Estimate Lock + PDF Archive (Apr 28 2026)
--
-- Enforces the "No Backfill Rule" at the data layer. Once a quote
-- has been presented to a client (share_token issued + status moved
-- past draft, OR explicitly published, OR accepted), the row is
-- locked. Future PUT calls refuse to clobber pricing/scope on
-- locked rows. Notes/scheduling appends are still allowed.
--
-- Adds two columns:
--   - estimates.locked_at        timestamptz nullable
--   - estimates.locked_reason    text nullable
--
-- Adds two columns referenced by the auto-lock policy:
--   - estimates.proposal_status  text nullable ('Draft' | 'Published' | 'Accepted')
--   - estimates.final_accepted_total numeric (set on acceptance)
--
-- Backfill: locks every estimate that's currently presented per the
-- definition above. Sheila's #71 doesn't exist in this tenant; the
-- three Apr 27 IE quotes (#26/#27/#28) DO get locked here — that's
-- correct, they're presented. The script just won't modify their
-- content.
--
-- Adds proposal_pdf_archive table for the PDF snapshot tracking.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Lock columns on estimates ────────────────────────────────

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS locked_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS proposal_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS final_accepted_total NUMERIC(12,2) NULL;

COMMENT ON COLUMN estimates.locked_at IS
  'Timestamp the estimate was locked from accidental modification. Set automatically when proposal_status transitions to Published, accepted_at is set, or status moves past draft. Once set, PUT updates only allow safe-list fields (notes, scheduling).';
COMMENT ON COLUMN estimates.locked_reason IS
  'Why the row was locked (auto vs manual + which trigger).';
COMMENT ON COLUMN estimates.proposal_status IS
  'Sales lifecycle state: Draft | Published | Accepted. Independent of estimates.status (which mixes proposal + production phases).';
COMMENT ON COLUMN estimates.final_accepted_total IS
  'Locked-in total at acceptance, with HST. Source of truth once a contract is signed.';

-- ─── 2. Backfill: lock everything presented ─────────────────────
-- Definition of "presented" for backfill (any of):
--   - proposal_status = 'Published'
--   - accepted_at IS NOT NULL
--   - final_accepted_total IS NOT NULL
--   - status IN ('proposal_sent','viewed','accepted','scheduled','in_progress','complete')
--   - any proposals row exists with view_count > 0 OR published = true
--   - activity_log shows the client opened/viewed/selected a tier on the share URL
--     (proposal_opened, tier_selected, pdf_rendered, pdf_downloaded, video_played)

UPDATE estimates e
SET locked_at = COALESCE(e.locked_at, GREATEST(e.updated_at, e.accepted_at, e.created_at)),
    locked_reason = COALESCE(
      e.locked_reason,
      'Auto-locked Apr 28 — backfill on migration 025 (presented per share_token + status/proposal/activity signals)'
    )
WHERE e.locked_at IS NULL
  AND e.status NOT IN ('cancelled')
  AND e.share_token IS NOT NULL
  AND (
    e.proposal_status = 'Published'
    OR e.accepted_at IS NOT NULL
    OR e.final_accepted_total IS NOT NULL
    OR e.status IN ('proposal_sent','viewed','accepted','scheduled','in_progress','complete')
    OR EXISTS (
      SELECT 1 FROM proposals p
       WHERE p.estimate_id = e.id
         AND (p.view_count > 0 OR p.published = true)
    )
    OR EXISTS (
      SELECT 1 FROM activity_log al
       WHERE al.entity_type = 'proposal_event'
         AND al.entity_id = e.id
         AND al.action IN ('proposal_opened','tier_selected','pdf_rendered','pdf_downloaded','video_played')
    )
  );

-- ─── 3. Index ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_estimates_locked_at
  ON estimates(locked_at)
  WHERE locked_at IS NOT NULL;

-- ─── 4. proposal_pdf_archive table ──────────────────────────────

CREATE TABLE IF NOT EXISTS proposal_pdf_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL,
  blob_url TEXT,
  local_path TEXT,
  archived_at TIMESTAMPTZ DEFAULT NOW(),
  archived_for TEXT DEFAULT 'historical_snapshot',
  size_bytes INTEGER,
  customer_name TEXT,
  customer_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_pdf_archive_estimate
  ON proposal_pdf_archive(estimate_id);

CREATE INDEX IF NOT EXISTS idx_pdf_archive_tenant_archived
  ON proposal_pdf_archive(tenant_id, archived_at DESC);
