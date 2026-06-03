-- Ryujin OS - Migration 087: change_orders.totals_applied_at
--
-- Applied directly via the Management API on 2026-06-02; documents it for the
-- migration tracker (schema/ is documentation, not auto-run).
--
-- WHY: PR4 makes an approved change order roll its agreed deltas into the live
-- financials (customer delta -> estimate.final_accepted_total, sub delta ->
-- paysheet add_on + subtotal/hst/total). totals_applied_at is the once-only
-- idempotency guard: the accept handler claims the roll-up with
--   UPDATE change_orders SET totals_applied_at = now()
--   WHERE id = $1 AND totals_applied_at IS NULL
-- and only moves money if that claim returns the row. See api/change-order-accept.js.

ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS totals_applied_at timestamptz;
