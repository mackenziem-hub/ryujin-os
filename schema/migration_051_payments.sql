-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 051: Payments table
--
-- The payments table that finance-state.js (line 108-122) and
-- finance-payments.html have been silently soft-failing on. After
-- this lands, /api/payments serves the canonical payment ledger
-- and the Cashflow agent + Stripe webhook + manual operator entry
-- all write here.
--
-- Sources:
--   stripe  — Stripe Checkout / Payment Intent webhook (deposits + balances)
--   gmail   — api/agents/cashflow.js parses "Invoice payment successful"
--             notifications from Automator/GHL
--   manual  — operator-entered payment (cash, e-transfer, cheque)
--
-- Dedupe via payment_intent_id (Stripe) and email_message_id (Gmail).
-- ═══════════════════════════════════════════════════════════════

create table if not exists payments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,

  -- When the payment cleared / was recorded.
  payment_date          timestamptz not null,

  -- Customer + estimate links (nullable so unmatched payments still record).
  customer_id           uuid references customers(id) on delete set null,
  customer_name         text,                          -- denormalized for fast render
  matched_estimate_id   uuid references estimates(id) on delete set null,

  -- Money + description.
  amount                numeric(12,2) not null,
  invoice_description   text,                          -- "Roof Deposit Invoice", "Final Invoice", etc.
  payment_method        text,                          -- 'card','etransfer','cheque','cash','other'

  -- Source tracking + dedupe keys.
  source                text not null check (source in ('stripe','gmail','manual')),
  payment_intent_id     text unique,                   -- Stripe pi_*; null for non-Stripe
  email_message_id      text unique,                   -- Gmail msg id for cashflow source dedupe

  -- Lifecycle status.
  status                text not null default 'matched' check (status in (
                          'matched','unmatched','voided','refunded'
                        )),

  raw_meta              jsonb default '{}'::jsonb,     -- full Stripe / email payload archive

  created_at            timestamptz not null default now(),
  created_by            uuid references users(id) on delete set null
);

create index if not exists payments_tenant_date on payments (tenant_id, payment_date desc);
create index if not exists payments_tenant_estimate on payments (tenant_id, matched_estimate_id) where matched_estimate_id is not null;
create index if not exists payments_tenant_unmatched on payments (tenant_id, payment_date desc) where status = 'unmatched';

-- Helpful comment for future-Claude / future-Mac.
comment on table payments is
  'Canonical payment ledger. Sources: stripe (webhook), gmail (cashflow agent parses Automator notifications), manual (operator entry). Dedupe via payment_intent_id and email_message_id unique constraints.';
