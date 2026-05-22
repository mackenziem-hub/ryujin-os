-- ═══════════════════════════════════════════════════════════════
-- Migration 069 · chat_conversations.working_on
--
-- Sticky conversation context so Cat / Mac don't have to repeat
-- "Kevin Chase 67 Berry" every message. Chat tools read this as the
-- default scope when the user's message doesn't name an estimate, and
-- write it explicitly via set_working_estimate or implicitly when a
-- tool resolves a target estimate.
--
-- Shape: { estimate_id, customer_id, project_id, set_at, source }
--   source = 'explicit' (user said so) | 'inferred' (tool resolved it)
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS working_on JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_working_on
  ON chat_conversations USING gin (working_on);
