-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 052: Referrals
--
-- Replaces the tag-walking inference on customer-referrals.html with
-- a real referrals table. The existing convention — operators tag
-- estimates with `referred_by:<customer_id>` — stays as the WRITE
-- path (cheap, in-line). The backfill script + future cron migration
-- promotes those tags into referrals rows; the new /api/referrals
-- endpoint is the canonical READ path.
--
-- 5% override per Outside Sales Handbook §3.2.
-- ═══════════════════════════════════════════════════════════════

create table if not exists referrals (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,

  -- Who referred (a prior customer). Required.
  referrer_customer_id     uuid not null references customers(id) on delete restrict,

  -- Who was referred (new lead). May not be a customer yet on first capture.
  referred_customer_id     uuid references customers(id) on delete set null,
  referred_lead_name       text,                       -- denormalized fallback when no customer row

  -- The deal, once one exists. Nullable so we can record a referral
  -- before any estimate is built.
  estimate_id              uuid references estimates(id) on delete set null,

  -- Commission terms.
  commission_rate          numeric(4,3) not null default 0.050,    -- 5% default
  commission_amount        numeric(12,2),                            -- computed when status >= 'earned'

  status                   text not null default 'open' check (status in (
                             'open',     -- referral logged, no deal yet
                             'earned',   -- estimate closed_won, override is owed
                             'paid',     -- override has been paid out
                             'voided'    -- referral disqualified (duplicate, fraud, etc.)
                           )),
  earned_at                timestamptz,                              -- when estimate flipped closed_won
  paid_at                  timestamptz,                              -- when commission cleared

  notes                    text,
  raw_meta                 jsonb default '{}'::jsonb,                -- archival (e.g., source tag string)

  created_at               timestamptz not null default now(),
  created_by               uuid references users(id) on delete set null,
  updated_at               timestamptz not null default now()
);

-- One referral row per estimate (when estimate is set). Allows multiple
-- pre-estimate referrals for the same referrer→referred pair.
create unique index if not exists referrals_estimate_unique
  on referrals (tenant_id, estimate_id) where estimate_id is not null;

create index if not exists referrals_tenant_referrer
  on referrals (tenant_id, referrer_customer_id);

create index if not exists referrals_tenant_status
  on referrals (tenant_id, status, created_at desc);

-- Touch updated_at on every UPDATE.
create or replace function set_referrals_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists referrals_updated_at on referrals;
create trigger referrals_updated_at before update on referrals
for each row execute function set_referrals_updated_at();

-- ─── Backfill from existing `referred_by:<uuid>` tags on estimates ──
-- Idempotent — uses ON CONFLICT on the partial unique index.
do $$
declare
  est_row record;
  tag_val text;
  ref_uuid uuid;
  earned_ts timestamptz;
  status_val text;
begin
  for est_row in
    select id, tenant_id, customer_id, tags, state, status as est_status, closed_won_at
    from estimates
    where exists (select 1 from unnest(tags) t where t like 'referred_by:%')
  loop
    -- Pull the first referred_by: tag (if multiple, take first).
    select t into tag_val from unnest(est_row.tags) t where t like 'referred_by:%' limit 1;
    -- Extract the uuid suffix and validate.
    begin
      ref_uuid := substring(tag_val from 'referred_by:(.+)$')::uuid;
    exception when others then
      continue;  -- malformed tag, skip
    end;

    if est_row.state = 'closed_won' or est_row.est_status = 'signed' then
      status_val := 'earned';
      earned_ts := est_row.closed_won_at;
    else
      status_val := 'open';
      earned_ts := null;
    end if;

    insert into referrals (
      tenant_id, referrer_customer_id, referred_customer_id, estimate_id,
      status, earned_at, raw_meta
    )
    values (
      est_row.tenant_id, ref_uuid, est_row.customer_id, est_row.id,
      status_val, earned_ts, jsonb_build_object('source_tag', tag_val, 'backfilled_2026_05_10', true)
    )
    on conflict (tenant_id, estimate_id) where estimate_id is not null do nothing;
  end loop;
end $$;

comment on table referrals is
  '5% override tracking for second-gen sales (Outside Sales Handbook §3.2). Write path: operators tag estimates with referred_by:<customer_id>; this table is the canonical read path via /api/referrals.';
