-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 003: Custom Roles & Auth
-- Replaces hardcoded roles with tenant-configurable role system
-- ═══════════════════════════════════════════════════════════════

-- ─── ROLES ───────────────────────────────────────────────────
-- Each tenant defines their own roles with custom permissions.
create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  name text not null,                     -- 'Owner', 'Foreman', 'Outside Sales Rep', etc.
  slug text not null,                     -- 'owner', 'foreman', 'outside-sales-rep'
  description text,
  permissions text[] default '{}',        -- array of permission keys
  is_system boolean default false,        -- system roles (owner) can't be deleted
  sort_order int default 0,
  created_at timestamptz default now(),
  unique(tenant_id, slug)
);

create index idx_roles_tenant on roles(tenant_id);

-- ─── LINK USERS TO ROLES ────────────────────────────────────
-- Add role_id to users table (nullable for migration — existing users keep old 'role' text field)
alter table users add column role_id uuid references roles(id);
create index idx_users_role on users(role_id);

-- ─── INVITES ─────────────────────────────────────────────────
-- Admin invites a user via link. They sign up and land in the right tenant + role.
create table invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  token text unique not null,             -- unique invite token in the URL
  email text,                             -- optional — lock invite to specific email
  role_id uuid references roles(id) not null,
  invited_by uuid references users(id),
  expires_at timestamptz not null,        -- default 7 days from creation
  used_at timestamptz,                    -- null until used
  used_by uuid references users(id),      -- who signed up with this invite
  created_at timestamptz default now()
);

create index idx_invites_token on invites(token);
create index idx_invites_tenant on invites(tenant_id);

-- ─── RLS ─────────────────────────────────────────────────────
alter table roles enable row level security;
alter table invites enable row level security;

-- ─── SEED DEFAULT PERMISSIONS LIST ──────────────────────────
-- This is a reference — the actual list is enforced in code.
-- Permissions are grouped by category for the admin UI.
comment on table roles is 'Available permissions:
-- DASHBOARD
view_dashboard

-- USERS & ROLES
manage_users, manage_roles, invite_users

-- ESTIMATES & PRICING
view_estimates, create_estimates, edit_estimates, delete_estimates, view_pricing

-- PROPOSALS
view_proposals, create_proposals, edit_proposals, share_proposals

-- PROJECTS
view_all_projects, view_own_projects, create_projects, edit_projects, manage_client_portal

-- TICKETS
view_all_tickets, view_own_tickets, create_tickets, assign_tickets, complete_tickets

-- FILES & PHOTOS
upload_files, edit_files, delete_files, set_client_visible

-- INSPECTIONS
create_inspections, edit_inspections, share_inspections

-- TIME TRACKING
clock_in_out, view_own_time, view_all_time, approve_time

-- SOPS
view_sops, create_sops, edit_sops, delete_sops

-- BRANDING & SETTINGS
edit_branding, edit_settings

-- AI & CHAT
use_chat, use_sop_search
';

-- ─── SEED OWNER ROLE FOR PLUS ULTRA ─────────────────────────
-- (Run after migration — seeds the owner role and links Mackenzie to it)
insert into roles (tenant_id, name, slug, description, permissions, is_system, sort_order)
select
  t.id,
  'Owner',
  'owner',
  'Full access to everything. Cannot be deleted.',
  ARRAY[
    'view_dashboard',
    'manage_users', 'manage_roles', 'invite_users',
    'view_estimates', 'create_estimates', 'edit_estimates', 'delete_estimates', 'view_pricing',
    'view_proposals', 'create_proposals', 'edit_proposals', 'share_proposals',
    'view_all_projects', 'create_projects', 'edit_projects', 'manage_client_portal',
    'view_all_tickets', 'create_tickets', 'assign_tickets', 'complete_tickets',
    'upload_files', 'edit_files', 'delete_files', 'set_client_visible',
    'create_inspections', 'edit_inspections', 'share_inspections',
    'clock_in_out', 'view_own_time', 'view_all_time', 'approve_time',
    'view_sops', 'create_sops', 'edit_sops', 'delete_sops',
    'edit_branding', 'edit_settings',
    'use_chat', 'use_sop_search'
  ],
  true,
  0
from tenants t where t.slug = 'plus-ultra';

-- Seed Admin role
insert into roles (tenant_id, name, slug, description, permissions, is_system, sort_order)
select t.id, 'Admin', 'admin', 'Full access except system settings.',
  ARRAY[
    'view_dashboard',
    'manage_users', 'invite_users',
    'view_estimates', 'create_estimates', 'edit_estimates', 'view_pricing',
    'view_proposals', 'create_proposals', 'edit_proposals', 'share_proposals',
    'view_all_projects', 'create_projects', 'edit_projects', 'manage_client_portal',
    'view_all_tickets', 'create_tickets', 'assign_tickets', 'complete_tickets',
    'upload_files', 'edit_files', 'delete_files', 'set_client_visible',
    'create_inspections', 'edit_inspections', 'share_inspections',
    'clock_in_out', 'view_own_time', 'view_all_time', 'approve_time',
    'view_sops', 'create_sops', 'edit_sops',
    'edit_branding',
    'use_chat', 'use_sop_search'
  ],
  true, 1
from tenants t where t.slug = 'plus-ultra';

-- Seed Estimator role (e.g., Darcy)
insert into roles (tenant_id, name, slug, description, permissions, sort_order)
select t.id, 'Estimator', 'estimator', 'Creates estimates, proposals, manages client pipeline.',
  ARRAY[
    'view_dashboard',
    'view_estimates', 'create_estimates', 'edit_estimates', 'view_pricing',
    'view_proposals', 'create_proposals', 'edit_proposals', 'share_proposals',
    'view_all_projects', 'create_projects', 'edit_projects', 'manage_client_portal',
    'view_all_tickets', 'create_tickets', 'assign_tickets',
    'upload_files', 'edit_files', 'set_client_visible',
    'create_inspections', 'share_inspections',
    'clock_in_out', 'view_own_time',
    'view_sops',
    'use_chat', 'use_sop_search'
  ],
  2
from tenants t where t.slug = 'plus-ultra';

-- Seed Crew role (e.g., Diego, AJ)
insert into roles (tenant_id, name, slug, description, permissions, sort_order)
select t.id, 'Crew', 'crew', 'Field crew — tickets, photos, clock in/out.',
  ARRAY[
    'view_own_tickets', 'complete_tickets',
    'view_own_projects', 'upload_files',
    'clock_in_out', 'view_own_time',
    'view_sops',
    'use_chat', 'use_sop_search'
  ],
  3
from tenants t where t.slug = 'plus-ultra';

-- Link existing users to their roles
update users set role_id = (
  select r.id from roles r
  where r.tenant_id = users.tenant_id
  and r.slug = users.role
)
where role_id is null;
