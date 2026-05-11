-- ═══════════════════════════════════════════════════════════════
-- Migration 058 — sub_crew_members
--
-- Lets a parent subcontractor (Ryan) invite his own crew into the
-- sub portal. Each member gets a unique magic token that grants
-- access to the parent sub's assigned workorders, but with their
-- own identity attached to every photo / log entry for audit.
--
-- Parent sub-portal capabilities (approve work order, accept paysheet,
-- ask questions to Mac/AJ) are NOT inherited by crew members —
-- those stay scoped to the parent token. Members can:
--   - view assigned WOs
--   - upload photos (credited to them by name)
--   - log work entries (credited)
--   - send messages (sender_name = member name, routed same as parent)
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sub_crew_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sub_id      UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  magic_token TEXT UNIQUE NOT NULL,
  active      BOOLEAN DEFAULT true NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  archived_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  metadata    JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sub_crew_members_sub_id     ON sub_crew_members(sub_id);
CREATE INDEX IF NOT EXISTS idx_sub_crew_members_tenant_id  ON sub_crew_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sub_crew_members_active     ON sub_crew_members(active) WHERE active = true;

-- Audit columns on job_log_entries so photos / logs credit the actual
-- person who uploaded them (parent sub OR a specific crew member).
-- Both nullable; existing rows stay untouched.
ALTER TABLE job_log_entries
  ADD COLUMN IF NOT EXISTS sub_crew_member_id UUID REFERENCES sub_crew_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by_name   TEXT;

CREATE INDEX IF NOT EXISTS idx_job_log_entries_sub_crew_member_id ON job_log_entries(sub_crew_member_id);
