-- Migration 079: calendar_blocks service_type + assigned_to
--
-- Backs the booking-modal service-type dropdown (Roof Inspection / Service Call
-- / Site Inspection) and the round-robin "assigned to" field. Both nullable so
-- existing ad-hoc blocks (general events) keep working unchanged. service_type
-- is guarded to the three booking types (NULL = general/block).

BEGIN;

ALTER TABLE calendar_blocks ADD COLUMN IF NOT EXISTS service_type text;
ALTER TABLE calendar_blocks ADD COLUMN IF NOT EXISTS assigned_to text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calendar_blocks_service_type_chk'
  ) THEN
    ALTER TABLE calendar_blocks
      ADD CONSTRAINT calendar_blocks_service_type_chk
      CHECK (service_type IS NULL OR service_type IN ('roof-inspection', 'service-call', 'site-inspection'));
  END IF;
END $$;

COMMIT;
