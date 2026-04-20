-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 011: Password reset tokens
-- Adds reset_token + expiry to users so the forgot-password flow
-- can issue + validate single-use reset links.
-- ═══════════════════════════════════════════════════════════════

alter table users add column if not exists reset_token text;
alter table users add column if not exists reset_token_expires_at timestamptz;

create index if not exists idx_users_reset_token on users(reset_token) where reset_token is not null;
