-- Phase 9: Approvals queue (replaces Shenron's Vercel Blob approval storage)
-- Persistent approval codes + scoping per tenant + per requester/approver.

create table if not exists pending_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  code text not null unique,
  requested_by_user_id uuid references users(id) on delete set null,
  requested_by_role text,
  assigned_to_user_id uuid references users(id) on delete set null,
  agent text,
  action_type text not null,
  target text,
  summary text,
  execute_payload jsonb default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','expired','executed','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  decided_at timestamptz,
  decided_by_user_id uuid references users(id) on delete set null,
  decision_note text,
  execution_result jsonb
);

create index if not exists idx_pending_approvals_tenant_status on pending_approvals(tenant_id, status, created_at desc);
create index if not exists idx_pending_approvals_assignee on pending_approvals(assigned_to_user_id, status) where status = 'pending';
create index if not exists idx_pending_approvals_code on pending_approvals(code);

comment on table pending_approvals is 'Phase 9: write-action approval queue. Replaces the Shenron Vercel Blob approval storage. Codes (e.g. KRI-726) are short-lived references for chat-based confirmation.';
