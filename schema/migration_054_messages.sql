-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 054: Internal messages
--
-- Operator-to-operator (and agent-to-operator) messaging within
-- Ryujin. Mac → Darcy / Diego / AJ. Catherine reading anything.
-- Agents may post (from_user_id = null marks a system message).
--
-- MVP scope:
--   - 1:1 messages (single to_user_id; channels/groups deferred)
--   - threads via thread_id; replies link back to root
--   - read_at marks operator-side read
--   - metadata jsonb so messages can attach to estimates / tickets /
--     customers without a dedicated FK each
--
-- Read path: GET /api/messages
-- Write path: POST /api/messages
-- Mark read: PATCH /api/messages?id=<uuid>
-- ═══════════════════════════════════════════════════════════════

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- Threading. Root message has thread_id = id; replies set thread_id
  -- to the root's id.
  thread_id       uuid not null default gen_random_uuid(),
  reply_to        uuid references messages(id) on delete set null,

  -- from_user_id null = system / agent message. Useful for letting
  -- the customer/sales/service agent post nudges into an operator's
  -- inbox without needing a fake user row.
  from_user_id    uuid references users(id) on delete set null,
  from_label      text,          -- denormalized name for system / archetype senders

  to_user_id      uuid references users(id) on delete cascade not null,

  subject         text,
  body            text not null,

  read_at         timestamptz,
  archived_at     timestamptz,

  -- Optional cross-references so a message can be "about" something.
  ref_estimate_id    uuid references estimates(id) on delete set null,
  ref_customer_id    uuid references customers(id) on delete set null,
  ref_service_ticket uuid references service_tickets(id) on delete set null,
  ref_workorder_id   uuid,        -- workorders FK exists but loose to avoid coupling

  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

create index if not exists messages_to_user_unread
  on messages (tenant_id, to_user_id, created_at desc)
  where read_at is null and archived_at is null;

create index if not exists messages_thread
  on messages (tenant_id, thread_id, created_at);

create index if not exists messages_from_user
  on messages (tenant_id, from_user_id, created_at desc);

-- Trigger to default thread_id = id on root messages so replies can
-- reliably point at thread_id.
create or replace function set_message_thread_id() returns trigger as $$
begin
  if new.thread_id is null then new.thread_id := new.id; end if;
  -- If reply_to is set and thread_id wasn't explicitly provided,
  -- inherit from the parent.
  if new.reply_to is not null then
    select thread_id into new.thread_id from messages where id = new.reply_to;
    if new.thread_id is null then new.thread_id := new.id; end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists messages_set_thread on messages;
create trigger messages_set_thread before insert on messages
for each row execute function set_message_thread_id();

comment on table messages is
  'Internal Ryujin messaging. Operator-to-operator + agent-to-operator. 1:1 only in MVP; channels deferred. Threads via thread_id; references via ref_* columns + metadata jsonb.';
