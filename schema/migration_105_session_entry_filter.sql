-- Migration 105: per-person session filter (author + audience on session_entries)
--
-- Adds attribution + visibility so each operator's LOAD pulls its relevant slice of the
-- shared brain instead of the full firehose. Backward-compatible: existing rows get
-- audience='all' (everyone still sees them) and author NULL (treated as shared). The
-- filter is applied on PULL (scripts/context-pull.mjs) keyed by RYUJIN_OPERATOR +
-- RYUJIN_ROLE; a machine with no identity set, or `--full`, sees everything (current
-- behavior). Owners get a one-line digest of operators' own-stream entries.
-- See docs/SPINE_FILTER_DESIGN.md.

BEGIN;

ALTER TABLE session_entries ADD COLUMN IF NOT EXISTS author   TEXT;
ALTER TABLE session_entries ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';

-- author lookups power the owner digest; cheap on a small table
CREATE INDEX IF NOT EXISTS idx_session_entries_tenant_author
  ON session_entries (tenant_id, author);

COMMIT;
