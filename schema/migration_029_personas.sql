-- Phase 6A: Persona customization
-- Per-user persona (overrides tenant default) + per-tenant default persona.
-- Persona shape: { name: text, style: text, avatar_url: text|null, voice_id: text|null }
-- voice_id is reserved for future ElevenLabs/OpenAI TTS voice selection (Phase 6B+ uses browser-native by default)

alter table users add column if not exists persona jsonb default '{}'::jsonb;
alter table tenants add column if not exists default_persona jsonb default '{}'::jsonb;

comment on column users.persona is 'Per-user AI persona override. {name, style, avatar_url, voice_id}. Falls back to tenant default_persona, then to role prompt baseline.';
comment on column tenants.default_persona is 'Tenant-wide AI persona default. Applied when user has no override. {name, style, avatar_url, voice_id}.';
