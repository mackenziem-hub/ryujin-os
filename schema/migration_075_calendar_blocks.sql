-- Ryujin OS - Migration 075: calendar_blocks
--
-- Ad-hoc events on the unified calendar that aren't workorders, inspections,
-- service tickets, or Google Cal items. Examples: "Mac at supply yard 8 AM",
-- "crew lunch", "Atlantic in-house training". Created via the + FAB on
-- /calendar.html.
--
-- crew_label is text (not FK) because Mac's crew model has two buckets that
-- don't cleanly map to existing subcontractor rows: 'plus-ultra' and
-- 'atlantic'. Leaving it as text means the UI can rename the buckets
-- without a schema change.

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  crew_label text CHECK (crew_label IS NULL OR crew_label IN ('plus-ultra', 'atlantic', 'other')),
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_blocks_tenant_starts_idx
  ON calendar_blocks (tenant_id, starts_at);

CREATE OR REPLACE FUNCTION trg_calendar_blocks_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calendar_blocks_set_updated_at ON calendar_blocks;
CREATE TRIGGER calendar_blocks_set_updated_at
  BEFORE UPDATE ON calendar_blocks
  FOR EACH ROW EXECUTE FUNCTION trg_calendar_blocks_updated_at();

ALTER TABLE calendar_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_blocks_tenant_isolation ON calendar_blocks;
CREATE POLICY calendar_blocks_tenant_isolation ON calendar_blocks
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
