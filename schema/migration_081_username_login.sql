-- Migration 081: username-based login + email-optional users (workforce app)
--
-- Lower-entry workforce roles (crew) sign in with a USERNAME + password, no email.
-- This adds the username column, relaxes the email NOT NULL constraint, and adds a
-- per-tenant case-insensitive unique index on username (only where present).
-- Login (api/auth.js) is extended to look users up by username OR email.

alter table users add column if not exists username text;

-- Email is no longer required (crew accounts may have only a username).
alter table users alter column email drop not null;

-- Case-insensitive unique username per tenant, only enforced when a username is set.
create unique index if not exists users_tenant_username_uniq
  on users (tenant_id, lower(username))
  where username is not null;
