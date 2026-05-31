-- Ryujin OS · Migration 083: Quest priority
--
-- Adds an explicit priority to quests so the Task Board can rank High / Medium /
-- Low independent of type (daily/campaign/optional) or due date. Drives the card
-- colour edge and the in-bucket sort on admin-quests.html + admin-overview.html.
--
-- Default 'medium' so every existing quest keeps working with no backfill.
-- Idempotent: safe to re-run.

alter table quests
  add column if not exists priority text not null default 'medium';

-- Constrain to the three levels. Guard the add so re-running does not error.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quests_priority_check'
  ) then
    alter table quests
      add constraint quests_priority_check
      check (priority in ('high','medium','low'));
  end if;
end $$;

-- Board sorts within a time bucket by priority then due date; index the common path.
create index if not exists quests_tenant_priority
  on quests (tenant_id, priority, due_at);
