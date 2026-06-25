-- migration_102: enforce one work-order number per tenant.
--
-- wo_number was caller-supplied and unconstrained, so concurrent creates raced
-- and produced duplicate numbers (the WO-28 / WO-29 collision that resolved a
-- job-by-wo_number lookup to the wrong row and broke 15 Bissett's PDF). The
-- POST handler now server-assigns wo_number = max+1; this partial unique index
-- is the backstop that turns any residual race into a hard error instead of
-- silent corruption.
--
-- Partial (excludes cancelled): a cancelled WO may keep its old number without
-- blocking a re-use, and only live numbers must be unique.
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/apply-migration.mjs schema/migration_102_workorder_number_unique.sql
-- Prereq: the data must already be free of duplicate (tenant_id, wo_number)
-- among non-cancelled rows (done 2026-06-25 by renumbering the Jun-22 draft
-- scaffolds to WO-31/32/33).

CREATE UNIQUE INDEX IF NOT EXISTS workorders_tenant_wo_number_uniq
  ON workorders (tenant_id, wo_number)
  WHERE status <> 'cancelled';

-- Resync the serial sequence. wo_number is a serial (migration_013), but past
-- inserts supplied explicit numbers (the client-side max+1 that caused the
-- collisions), and an explicit insert does NOT advance the sequence. So nextval
-- may now sit BEHIND the real max and would hand a DB-assigned insert
-- (proposal-accept on signing, or the hardened POST) an already-used number,
-- which the unique index above would then reject. Bump the sequence past the
-- current max so DB-assigned numbers resume cleanly. Safe + idempotent (always
-- resyncs to the current max).
SELECT setval(
  pg_get_serial_sequence('workorders', 'wo_number'),
  COALESCE((SELECT MAX(wo_number) FROM workorders), 1),
  true
);
