-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 009: Simple Auth
-- Password hashes + session tokens for login flow
-- ═══════════════════════════════════════════════════════════════

-- Add password hash to users (nullable — not all users need login)
alter table users add column if not exists password_hash text;

-- Sessions table
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create index if not exists idx_sessions_token on sessions(token);
create index if not exists idx_sessions_user on sessions(user_id);

alter table sessions enable row level security;

-- Seed: admin user for Plus Ultra (password will be set via API)
-- The actual password hash is set through the /api/auth?action=register endpoint
