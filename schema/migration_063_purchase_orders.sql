-- migration_063_purchase_orders
--
-- Phase 3 Inventory pillar build: purchase order tracking. Replaces
-- Catherine's spreadsheet + email + WhatsApp material-coordination
-- workflow with a real table.
--
-- v1 schema decision: line items stored as JSONB array on the PO row.
-- Avoids the extra join in the common "show me this PO with lines" query
-- and keeps the CRUD simple. Normalize to a po_line_items table if/when
-- we need per-line aggregation across all POs (e.g., supplier scorecards).
--
-- Status lifecycle:
--   draft     → being built, not yet sent to supplier
--   sent      → emailed/called to supplier, awaiting confirmation
--   confirmed → supplier confirmed price + delivery date
--   partial   → some items received, others outstanding
--   received  → all items delivered + verified
--   cancelled → won't proceed

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,

  -- Identification
  po_number text not null,                  -- 'PO-2026-001', human-readable
  merchant_id uuid references merchants(id) on delete restrict not null,
  estimate_id uuid references estimates(id) on delete set null,  -- optional job link

  -- Lifecycle
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'confirmed', 'partial', 'received', 'cancelled'
  )),
  ordered_at timestamptz,                   -- when status moved to 'sent'
  confirmed_at timestamptz,
  expected_delivery_date date,
  actual_delivery_date date,

  -- Money
  subtotal numeric(10,2) default 0,         -- sum of line totals before tax
  tax_amount numeric(10,2) default 0,
  total_amount numeric(10,2) default 0,
  currency text default 'CAD',

  -- Line items as JSONB array
  -- Each item: { description, product_id?, qty, unit, unit_price, line_total, received_qty? }
  line_items jsonb not null default '[]'::jsonb,

  -- Notes + audit
  notes text,
  created_by uuid references users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_purchase_orders_tenant on purchase_orders(tenant_id);
create index if not exists idx_purchase_orders_merchant on purchase_orders(merchant_id);
create index if not exists idx_purchase_orders_estimate on purchase_orders(estimate_id);
create index if not exists idx_purchase_orders_status on purchase_orders(tenant_id, status);
create unique index if not exists ux_purchase_orders_tenant_po_number on purchase_orders(tenant_id, po_number);

-- Touch trigger for updated_at
create or replace function purchase_orders_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_touch on purchase_orders;
create trigger trg_purchase_orders_touch
  before update on purchase_orders
  for each row execute function purchase_orders_touch_updated_at();

-- RLS
alter table purchase_orders enable row level security;

drop policy if exists purchase_orders_tenant_isolation on purchase_orders;
create policy purchase_orders_tenant_isolation on purchase_orders
  for all using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);
