-- Migration 095: enforce per-tenant uniqueness on estimates.estimate_number
-- Applied to prod 2026-06-09 via Management API (with the data fix below).
--
-- Root cause: estimate_number is a plain serial with no unique constraint
-- (base schema migrations.sql line ~88). Bulk imports on 2026-05-11 and
-- 2026-05-30 wrote rows carrying explicit numbers (62, 77-81) without
-- advancing the sequence, so organic inserts re-issued the same numbers.
-- Six duplicate pairs existed in prod; the imported rows were renumbered
-- 83-88 (organic sequence-assigned rows kept their numbers):
--   Shelley Hope     62 -> 83   Richard Seyeau   77 -> 84
--   Bukola Sikirra   78 -> 85   Brian Northrup   79 -> 86
--   Gary+Karen Pardy 80 -> 87   Korey Fram       81 -> 88
-- Data fix script: scripts/_oneshot/_fix_dup_estimate_numbers_2026-06-09.sql
--
-- Idempotent: safe to re-run in any environment. In a fresh environment with
-- duplicate rows, resolve duplicates first or this raises (by design).

-- Keep the sequence ahead of the data so the next insert cannot collide.
select setval(
  pg_get_serial_sequence('estimates', 'estimate_number'),
  greatest(
    (select coalesce(max(estimate_number), 1) from estimates),
    (select last_value from pg_sequences
      where schemaname = 'public'
        and sequencename = 'estimates_estimate_number_seq')
  )
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estimates_tenant_estimate_number_unique'
  ) then
    alter table estimates
      add constraint estimates_tenant_estimate_number_unique
      unique (tenant_id, estimate_number);
  end if;
end $$;
