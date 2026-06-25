-- Migration 083: context_store (session_entries + context_principles)
--
-- Cross-machine context spine. The Claude Code session brain (SESSION_CONTEXT.md)
-- and durable auto-memory (~/.claude/.../memory) were file-only: one rode OneDrive
-- (which FORKS to SESSION_CONTEXT-<machine>.md on concurrent edits), the other was
-- machine-local (synced nowhere). So context drifted across Mac's machines/terminals
-- (DESKTOP-71KPCBP / HAL / Mind-Palace). These two tables make Supabase the source
-- of truth; local files become a rebuildable cache (scripts/context-pull.mjs at LOAD,
-- scripts/context-push.mjs at SAVE). Append-only session_entries make the OneDrive
-- whole-file fork structurally impossible: two concurrent saves become two rows.
--
-- Writes go ONE record at a time through api/context-store.js behind
-- requirePortalSessionAndTenant (the per-record authenticated path; NOT a bulk
-- RLS-bypass PATCH/DELETE, which the classifier denies). Modeled on
-- migration_077_deck_notes (idempotent upsert via a UNIQUE key).

BEGIN;

-- Append-only session handoff log. entry_key carries the machine + timestamp so two
-- machines saving in the same window produce two distinct rows, never a clobber.
CREATE TABLE IF NOT EXISTS session_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_key   TEXT NOT NULL,
  machine     TEXT NOT NULL DEFAULT 'unknown',
  terminal    TEXT,
  title       TEXT,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entry_key)
);

CREATE INDEX IF NOT EXISTS idx_session_entries_tenant_created
  ON session_entries (tenant_id, created_at DESC);

-- Durable principles (the ~/.claude auto-memory). Upsert-by-slug; soft-delete via
-- is_active=false keeps deletes recoverable. kind = feedback|reference|project|user
-- (plus 'meta' for the MEMORY.md index preamble, which travels with the data).
CREATE TABLE IF NOT EXISTS context_principles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'reference',
  title          TEXT,
  body           TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  source_machine TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_context_principles_tenant_active
  ON context_principles (tenant_id, is_active, updated_at DESC);

COMMIT;
