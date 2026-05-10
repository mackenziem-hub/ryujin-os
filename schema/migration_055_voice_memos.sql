-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 055: Voice memos
--
-- Browser-recorded voice memos (operator → operator) with Whisper
-- transcription so disputes have an audit trail. Attached to a
-- message_id (the thread bubble) and optionally a customer / estimate
-- so the memo lands on that record's history too.
-- ═══════════════════════════════════════════════════════════════

create table if not exists voice_memos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  uploader_user_id      uuid references users(id) on delete set null,

  blob_url              text not null,                -- Vercel Blob public URL
  mime_type             text,                          -- audio/webm | audio/mp4 | audio/mpeg
  duration_sec          numeric(7,2),
  size_bytes            integer,

  -- Transcription
  transcription         text,
  transcription_status  text not null default 'pending' check (transcription_status in (
                          'pending','transcribing','complete','failed','skipped'
                        )),
  transcription_lang    text,                          -- ISO 639-1
  transcribed_at        timestamptz,

  -- Cross-references
  ref_message_id        uuid references messages(id) on delete set null,
  ref_customer_id       uuid references customers(id) on delete set null,
  ref_estimate_id       uuid references estimates(id) on delete set null,
  ref_service_ticket    uuid references service_tickets(id) on delete set null,

  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists voice_memos_tenant_recent on voice_memos (tenant_id, created_at desc);
create index if not exists voice_memos_uploader on voice_memos (tenant_id, uploader_user_id, created_at desc);
create index if not exists voice_memos_message on voice_memos (ref_message_id) where ref_message_id is not null;

comment on table voice_memos is
  'Operator voice memos with Whisper transcription. Attached to a message thread via ref_message_id; optionally linked to customer / estimate / service_ticket for history.';
