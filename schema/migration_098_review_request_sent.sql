-- ═══════════════════════════════════════════════════════════════
-- Migration 098: review-ask dedupe stamp (Batch D, data integrity)
--
-- The review-ask queue (customer-reviews.html, customer_scan agent,
-- api/customer-state.js review_asks_pending) had no record of which
-- customers were already asked, so the same customer surfaced forever.
-- This adds the per-customer stamp. Consumers exclude customers whose
-- stamp is within the last 90 days and write the stamp when an ask is
-- sent. NULL = never asked.
--
-- The no-ask-without-positive-signal rule is unchanged: this column only
-- dedupes; it does not decide who gets asked.
--
-- Applied by hand via the Supabase Management API. Idempotent.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS review_request_sent_at timestamptz;

COMMENT ON COLUMN customers.review_request_sent_at IS
  'Last review ask (Google/Facebook) sent to this customer. Review-ask surfaces hide customers stamped within 90 days. NULL = never asked.';

-- Partial index: the dedupe scan only cares about stamped customers.
CREATE INDEX IF NOT EXISTS idx_customers_review_request_sent_at
  ON customers (tenant_id, review_request_sent_at)
  WHERE review_request_sent_at IS NOT NULL;
