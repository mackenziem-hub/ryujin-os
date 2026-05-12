-- Migration 061 — users.magic_token + magic_expires_at
-- Lets admins generate one-tap magic-link URLs for crew members.
-- 2026-05-12 (Ryujin OS)

alter table users
  add column if not exists magic_token text unique,
  add column if not exists magic_expires_at timestamptz;

create index if not exists idx_users_magic_token on users(magic_token) where magic_token is not null;
