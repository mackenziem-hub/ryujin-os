-- Ryujin OS — Migration 042: Sandbox Flag (architecture-only)
--
-- Adds `tenants.is_sandbox` so the architecture is in place. Per the
-- May 9 2026 plan, full sandbox/prod data isolation is post-July —
-- this column lets future-us add API-layer routing without another
-- migration round-trip.
--
-- The existing localStorage `ry_mode` toggle (now exposed in
-- admin-advanced.html as a UI affordance) reads/writes client-side only.
-- It does NOT yet flip behavior server-side; that wiring lands when
-- demo/broadcast tenants get split off post-launch.

alter table tenants
  add column if not exists is_sandbox boolean not null default false;

create index if not exists tenants_is_sandbox on tenants (is_sandbox) where is_sandbox = true;

comment on column tenants.is_sandbox is
  'Architecture flag for future demo/broadcast tenants. As of 2026-05-09 not yet enforced server-side — sandbox is UI-only via ry_mode localStorage. Set to true ONLY for tenants whose data should be excluded from real-money flows once isolation lands.';
