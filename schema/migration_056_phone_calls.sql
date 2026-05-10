-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 056: Twilio voice routing + recording
--
-- Each operator gets a Ryujin (Twilio) phone number that customers
-- and other crew can dial. Inbound calls forward to the operator's
-- actual cell (users.phone) AND get recorded + transcribed via
-- Whisper. Outbound calls placed through the same number from the
-- ops UI behave identically.
--
-- Recordings reuse voice_memos (migration 055) for storage +
-- transcription so /messages.html renders them the same way as
-- async voice memos. phone_calls is the call log.
-- ═══════════════════════════════════════════════════════════════

-- 1. Operator's Ryujin (Twilio-routed) number.
alter table users
  add column if not exists ryujin_phone_number text;
create unique index if not exists users_ryujin_phone_unique
  on users (ryujin_phone_number) where ryujin_phone_number is not null;

-- 2. Call log.
create table if not exists phone_calls (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,

  -- Twilio identifiers (unique to dedupe webhook retries).
  twilio_call_sid     text unique,
  twilio_recording_sid text unique,

  direction           text not null check (direction in ('inbound', 'outbound', 'forwarded')),

  -- Parties.
  from_phone          text,                          -- caller's number (E.164)
  to_phone            text,                          -- callee's number (E.164)
  ryujin_phone        text,                          -- the Ryujin number that routed it

  -- Resolved entities (optional — populated when caller/callee match a customer or user).
  from_user_id        uuid references users(id) on delete set null,
  to_user_id          uuid references users(id) on delete set null,
  customer_id         uuid references customers(id) on delete set null,

  -- Lifecycle.
  status              text not null default 'initiated' check (status in (
                        'initiated','ringing','in-progress','completed',
                        'busy','no-answer','failed','canceled'
                      )),
  started_at          timestamptz default now(),
  answered_at         timestamptz,
  ended_at            timestamptz,
  duration_sec        integer,

  -- Recording (lives in voice_memos for storage; this is the link).
  voice_memo_id       uuid references voice_memos(id) on delete set null,
  recording_url       text,                          -- Twilio's URL (transient — voice_memos.blob_url is the durable copy)

  -- Cross-refs.
  ref_message_id      uuid references messages(id) on delete set null,
  ref_estimate_id     uuid references estimates(id) on delete set null,
  ref_service_ticket  uuid references service_tickets(id) on delete set null,

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists phone_calls_tenant_recent on phone_calls (tenant_id, started_at desc);
create index if not exists phone_calls_customer on phone_calls (tenant_id, customer_id, started_at desc) where customer_id is not null;
create index if not exists phone_calls_user on phone_calls (tenant_id, from_user_id, started_at desc) where from_user_id is not null;

comment on table phone_calls is
  'Twilio voice call log. Recordings are stored in voice_memos via voice_memo_id (durable Vercel Blob URL); recording_url is the transient Twilio URL kept for reference only.';
comment on column users.ryujin_phone_number is
  'E.164 Twilio number assigned to this operator. Calls to this number forward to users.phone (their actual cell) and get recorded.';
