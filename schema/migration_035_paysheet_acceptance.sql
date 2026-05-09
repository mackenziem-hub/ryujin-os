-- Ryujin OS — Migration 035: Paysheet Sub Acceptance
-- Adds sub-facing acceptance flow to the paysheets table:
--   * sub_acceptance_token  — random share token for /paysheet.html?token=X
--   * sub_acceptance_status — 'pending' | 'accepted' | 'declined'
--   * sub_decision_at       — timestamptz of accept/decline
--   * sub_decision_note     — optional note from sub when declining
--
-- Backward-compatible: all additive. Existing paysheets default to 'pending' with NULL token.
-- Mac generates token on insert via gen_random_uuid() in the application layer.

alter table paysheets
  add column if not exists sub_acceptance_token text unique,
  add column if not exists sub_acceptance_status text default 'pending'
    check (sub_acceptance_status in ('pending','accepted','declined')),
  add column if not exists sub_decision_at timestamptz,
  add column if not exists sub_decision_note text;

create index if not exists idx_paysheets_sub_token on paysheets(sub_acceptance_token)
  where sub_acceptance_token is not null;
create index if not exists idx_paysheets_sub_status on paysheets(tenant_id, sub_acceptance_status);

-- Backfill: existing rows stay pending (Mac can manually flip if already accepted offline)
update paysheets
   set sub_acceptance_status = 'pending'
 where sub_acceptance_status is null;
