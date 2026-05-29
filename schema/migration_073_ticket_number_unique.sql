-- Ryujin OS - Migration 073: Per-tenant uniqueness on tickets.ticket_number
--
-- Background: The base schema declared `ticket_number serial` but never
-- enforced uniqueness, neither globally nor per-tenant. On 2026-05-27 the
-- plus-ultra tenant was found with two pairs of duplicates: #77 (rows
-- 8fef9ba6 + ea518745) and #78 (rows 9a89920e + 6c6f3734). Both later rows
-- in each pair were created on 2026-05-26 within 1 second of each other,
-- pointing at either a setval rollback or a script that inserted with
-- explicit ticket_number values rather than relying on the sequence default.
--
-- This migration:
--   1. Renumbers any pre-existing per-tenant duplicates by keeping the
--      earliest-created row at its existing number and pushing later
--      duplicates past the current max. Deterministic, conservative
--      (external paper trails tend to reference the original/earliest
--      ticket so the earlier row keeps its number).
--   2. Advances the sequence past the current max so future nextval()
--      calls cannot collide with any manually inserted numbers.
--   3. Adds the UNIQUE (tenant_id, ticket_number) constraint that should
--      have existed from the start. After this constraint exists, any
--      future code path that tries to insert a duplicate will fail loudly
--      instead of silently collide.
--
-- Idempotent: re-running is a no-op once the constraint exists.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Renumber pre-existing duplicates (keep earliest, push the rest)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  next_num INT;
  dup_row RECORD;
BEGIN
  SELECT COALESCE(MAX(ticket_number), 0) + 1 INTO next_num FROM tickets;

  FOR dup_row IN
    SELECT id
    FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY tenant_id, ticket_number
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM tickets
    ) ranked
    WHERE rn > 1
    ORDER BY rn, id
  LOOP
    UPDATE tickets SET ticket_number = next_num WHERE id = dup_row.id;
    next_num := next_num + 1;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Advance the sequence past the current MAX
-- ─────────────────────────────────────────────────────────────────────
-- Guards against a setval rollback or a manual insert that bypassed the
-- default. setval(.., n, true) means nextval() will return n+1.
--
-- Empty-table case: skip the setval so a fresh tenant's first ticket
-- still gets ticket_number = 1 (the sequence's natural start value).
DO $$
DECLARE
  max_num INT;
BEGIN
  SELECT COALESCE(MAX(ticket_number), 0) INTO max_num FROM tickets;
  IF max_num > 0 THEN
    PERFORM setval(
      pg_get_serial_sequence('tickets', 'ticket_number'),
      max_num,
      true
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Enforce per-tenant uniqueness going forward
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tickets_tenant_number_unique'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_tenant_number_unique
      UNIQUE (tenant_id, ticket_number);
  END IF;
END $$;
