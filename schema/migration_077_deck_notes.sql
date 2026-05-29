-- Migration 077: deck_notes
--
-- Server-side persistence for Ryujin Proposal Generator deck sticky notes.
-- Notes were localStorage-only (public/scripts/presentation.js), so they could
-- not survive across devices or be read back by the working session. This table
-- lets the engine sync notes up when a portal session is present, while decks
-- still open standalone (localStorage-only) for unauthenticated review.
--
-- Notes are tenant-scoped collaborative review annotations, keyed by the
-- client-side note id (the localStorage uuid) so localStorage <-> server sync
-- is idempotent (re-syncing the same note upserts instead of duplicating).

BEGIN;

CREATE TABLE IF NOT EXISTS deck_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deck_id        TEXT NOT NULL,
  slide_id       TEXT NOT NULL,
  client_note_id TEXT NOT NULL,
  author         TEXT NOT NULL DEFAULT 'mac',
  text           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, deck_id, client_note_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_notes_tenant_deck ON deck_notes (tenant_id, deck_id);

COMMIT;
