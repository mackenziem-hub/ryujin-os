-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 064: Auto-create project when estimate accepted
--
-- Background: migration_002 created projects with the comment
-- "Auto-created when estimate hits 'scheduled'", but the actual auto-create
-- behavior was never implemented. As of 2026-05-17 there are 5 accepted
-- estimates with no linked project, which means the photo capture +
-- customer share flow (S1/S2/S3, deployed today) silently fails for those
-- jobs — the mobile photo button stays disabled because there's no
-- project_id to attach photos to.
--
-- This migration installs a DB-level trigger so every path that flips
-- estimates.status to 'accepted' (API, dashboard, GHL sync, future cron
-- workflows) gets the same auto-project behavior. Idempotent — skips if
-- a project already exists with this estimate_id, and tries to link to
-- an existing orphan project on the same customer before creating a new
-- one (avoids duplicates on customers Mac already manually built a
-- project for).
--
-- Status value: 'accepted' is the post-sale state in current data
-- (verified 2026-05-17 prod query — 5 rows). The original schema comment
-- said 'scheduled' but no such value is in use.
-- ═══════════════════════════════════════════════════════════════

create or replace function fn_auto_create_project_from_estimate()
returns trigger language plpgsql as $$
declare
  v_customer record;
  v_tenant_slug text;
  v_existing_project_id uuid;
  v_new_project_id uuid;
  v_share_token text;
  v_proj_name text;
begin
  -- Skip if a project is already linked to this estimate
  select id into v_existing_project_id from projects where estimate_id = NEW.id limit 1;
  if v_existing_project_id is not null then return NEW; end if;

  -- Require a linked customer
  if NEW.customer_id is null then return NEW; end if;
  select id, full_name, address, city, province
    into v_customer
    from customers where id = NEW.customer_id;
  if v_customer is null then return NEW; end if;

  -- Try to link to an existing orphan project for the same customer (avoids
  -- the duplicate that Mark Arzaga's row would otherwise produce).
  select id into v_existing_project_id
  from projects
  where customer_id = NEW.customer_id
    and tenant_id = NEW.tenant_id
    and estimate_id is null
  order by created_at desc
  limit 1;

  if v_existing_project_id is not null then
    update projects set estimate_id = NEW.id, updated_at = now()
    where id = v_existing_project_id;

    insert into activity_log (tenant_id, entity_type, entity_id, action, details)
    values (NEW.tenant_id, 'project', v_existing_project_id, 'estimate_linked',
            jsonb_build_object(
              'estimate_id', NEW.id,
              'estimate_number', NEW.estimate_number,
              'trigger', 'fn_auto_create_project_from_estimate'
            ));
    return NEW;
  end if;

  -- Otherwise create a fresh project
  select slug into v_tenant_slug from tenants where id = NEW.tenant_id;
  if v_tenant_slug is null then return NEW; end if;

  -- 8-char hex of epoch ms + 4-char id slice keeps token collision-resistant
  -- even if two estimates are accepted in the same millisecond.
  v_share_token := v_tenant_slug
    || '-proj-'
    || to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint)
    || '-'
    || substring(NEW.id::text, 1, 4);

  v_proj_name := coalesce(nullif(trim(v_customer.address), ''), 'Project')
    || coalesce(' — ' || nullif(split_part(v_customer.full_name, ' ', -1), ''), '');

  insert into projects (
    tenant_id, estimate_id, customer_id,
    name, address, city, province, status,
    share_token, tags
  ) values (
    NEW.tenant_id, NEW.id, NEW.customer_id,
    v_proj_name,
    v_customer.address,
    v_customer.city,
    coalesce(v_customer.province, 'NB'),
    'not_started',
    v_share_token,
    array[]::text[]
  )
  returning id into v_new_project_id;

  insert into activity_log (tenant_id, entity_type, entity_id, action, details)
  values (NEW.tenant_id, 'project', v_new_project_id, 'created',
          jsonb_build_object(
            'estimate_id', NEW.id,
            'estimate_number', NEW.estimate_number,
            'share_token', v_share_token,
            'trigger', 'fn_auto_create_project_from_estimate'
          ));

  return NEW;
end;
$$;

drop trigger if exists trg_auto_create_project_on_estimate_update on estimates;
create trigger trg_auto_create_project_on_estimate_update
after update on estimates
for each row
when (NEW.status = 'accepted' and (OLD.status is null or OLD.status <> 'accepted'))
execute function fn_auto_create_project_from_estimate();

drop trigger if exists trg_auto_create_project_on_estimate_insert on estimates;
create trigger trg_auto_create_project_on_estimate_insert
after insert on estimates
for each row
when (NEW.status = 'accepted')
execute function fn_auto_create_project_from_estimate();

-- ─── BACKFILL ─────────────────────────────────────────────────────
-- Apply the same logic to every existing accepted estimate that doesn't
-- have a linked project. Runs once, idempotent on re-runs.
-- ──────────────────────────────────────────────────────────────────
do $backfill$
declare
  rec record;
  v_customer record;
  v_tenant_slug text;
  v_existing_project_id uuid;
  v_new_project_id uuid;
  v_share_token text;
  v_proj_name text;
  v_count int := 0;
  v_linked int := 0;
  v_created int := 0;
begin
  for rec in
    select e.* from estimates e
    where e.status = 'accepted'
      and not exists (select 1 from projects p where p.estimate_id = e.id)
      and e.customer_id is not null
    order by e.created_at asc
  loop
    v_count := v_count + 1;
    select id, full_name, address, city, province
      into v_customer
      from customers where id = rec.customer_id;
    if v_customer is null then continue; end if;

    select id into v_existing_project_id
    from projects
    where customer_id = rec.customer_id
      and tenant_id = rec.tenant_id
      and estimate_id is null
    order by created_at desc
    limit 1;

    if v_existing_project_id is not null then
      update projects set estimate_id = rec.id, updated_at = now()
      where id = v_existing_project_id;
      insert into activity_log (tenant_id, entity_type, entity_id, action, details)
      values (rec.tenant_id, 'project', v_existing_project_id, 'estimate_linked',
              jsonb_build_object(
                'estimate_id', rec.id,
                'estimate_number', rec.estimate_number,
                'trigger', 'backfill-migration-064'
              ));
      v_linked := v_linked + 1;
      continue;
    end if;

    select slug into v_tenant_slug from tenants where id = rec.tenant_id;
    if v_tenant_slug is null then continue; end if;

    v_share_token := v_tenant_slug
      || '-proj-'
      || to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint)
      || '-'
      || substring(rec.id::text, 1, 4);

    v_proj_name := coalesce(nullif(trim(v_customer.address), ''), 'Project')
      || coalesce(' — ' || nullif(split_part(v_customer.full_name, ' ', -1), ''), '');

    insert into projects (
      tenant_id, estimate_id, customer_id,
      name, address, city, province, status,
      share_token, tags
    ) values (
      rec.tenant_id, rec.id, rec.customer_id,
      v_proj_name,
      v_customer.address,
      v_customer.city,
      coalesce(v_customer.province, 'NB'),
      'not_started',
      v_share_token,
      array[]::text[]
    )
    returning id into v_new_project_id;

    insert into activity_log (tenant_id, entity_type, entity_id, action, details)
    values (rec.tenant_id, 'project', v_new_project_id, 'created',
            jsonb_build_object(
              'estimate_id', rec.id,
              'estimate_number', rec.estimate_number,
              'share_token', v_share_token,
              'trigger', 'backfill-migration-064'
            ));
    v_created := v_created + 1;

    -- One-ms sleep prevents collision on the epoch-ms token across the loop.
    perform pg_sleep(0.001);
  end loop;

  raise notice 'migration_064 backfill: % accepted estimates scanned, % linked to existing project, % new projects created',
    v_count, v_linked, v_created;
end;
$backfill$;
