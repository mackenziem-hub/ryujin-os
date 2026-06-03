-- Ryujin OS - Migration 088: message_reads (per-user read receipts)
--
-- Applied directly via the Management API on 2026-06-02; documents it for the
-- migration tracker (schema/ is documentation, not auto-run).
--
-- WHY: the per-job TEAM THREAD (migration 086 / api/messages.js) is a shared
-- channel, so a single messages.read_at cannot model who-on-the-team has read a
-- message. This per-user-per-message table backs real read receipts: the thread
-- shows "seen by <names>" and a true unread count. The job profile marks a thread
-- read via POST /api/messages { action: 'mark_read_thread', ref_workorder_id }.

CREATE TABLE IF NOT EXISTS message_reads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_msg ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id, tenant_id);
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;
