-- migration_039_change_orders.sql
-- Bible §5.3 — Change Order doctrine. Central ledger linking customer changes,
-- sub changes, margin impact, scope deltas, pricing deltas, approvals, timestamps.
--
-- A single change order can affect:
--   * customer side (price_delta_customer + customer accept token)
--   * sub side (rate_delta_sub + sub accept token)
--   * both (full duplex CO — common for scope expansions during install)

CREATE TABLE IF NOT EXISTS change_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Linkage (may be NULL if only one side affected)
  estimate_id              uuid REFERENCES estimates(id) ON DELETE SET NULL,
  paysheet_id              uuid REFERENCES paysheets(id) ON DELETE SET NULL,
  job_id                   text,                              -- text for now; many places already key off job_id strings

  -- Provenance
  requested_by             text NOT NULL
    CHECK (requested_by IN ('owner','customer','sub','admin','production','system')),
  source_surface           text
    CHECK (source_surface IN ('agent','interactive','advanced','sub_portal','proposal_page','admin','system')),
  created_by_user_id       uuid REFERENCES users(id),

  -- Scope
  reason                   text NOT NULL,
  scope_before             text,
  scope_after              text,

  -- Customer side
  price_delta_customer     int,                                -- cents
  customer_accept_token    text UNIQUE,
  customer_accept_status   text NOT NULL DEFAULT 'not_applicable'
    CHECK (customer_accept_status IN ('not_applicable','pending','accepted','declined','superseded')),
  customer_decided_at      timestamptz,
  customer_decision_note   text,

  -- Sub side
  rate_delta_sub           int,                                -- cents
  sub_accept_token         text UNIQUE,
  sub_accept_status        text NOT NULL DEFAULT 'not_applicable'
    CHECK (sub_accept_status IN ('not_applicable','pending','accepted','declined','superseded')),
  sub_decided_at           timestamptz,
  sub_decision_note        text,

  -- Margin protection (computed at CO creation, not live)
  margin_impact            int,                                -- cents; positive = margin gained, negative = lost

  -- Lifecycle
  status                   text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_customer','pending_sub','pending_both','approved','rejected','superseded','cancelled')),
  approved_at              timestamptz,
  rejected_at              timestamptz,
  superseded_by_id         uuid REFERENCES change_orders(id),  -- if a later CO replaced this one

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_orders_tenant_status_idx ON change_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS change_orders_estimate_idx ON change_orders (estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_orders_paysheet_idx ON change_orders (paysheet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_orders_pending_customer_idx ON change_orders (tenant_id, customer_accept_status)
  WHERE customer_accept_status = 'pending';
CREATE INDEX IF NOT EXISTS change_orders_pending_sub_idx ON change_orders (tenant_id, sub_accept_status)
  WHERE sub_accept_status = 'pending';

-- Auto bump updated_at
CREATE OR REPLACE FUNCTION change_orders_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS change_orders_updated_at_trg ON change_orders;
CREATE TRIGGER change_orders_updated_at_trg
  BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION change_orders_set_updated_at();

-- Audit log
CREATE TABLE IF NOT EXISTS change_order_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id uuid NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prev_status     text,
  new_status      text NOT NULL,
  triggered_by    text,
  actor_user_id   uuid REFERENCES users(id),
  reason          text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_order_log_co_idx ON change_order_log (change_order_id, changed_at DESC);

CREATE OR REPLACE FUNCTION change_order_log_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO change_order_log (change_order_id, tenant_id, prev_status, new_status)
    VALUES (NEW.id, NEW.tenant_id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS change_order_log_trg ON change_orders;
CREATE TRIGGER change_order_log_trg
  AFTER UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION change_order_log_transition();
