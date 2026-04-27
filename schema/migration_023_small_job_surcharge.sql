-- Apr 27 2026: small-job mobilization surcharge
-- Captures the structural cost of opening a job that can't carry full
-- overhead allocation. $500 flat on jobs under 15 SQ.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS small_job_threshold_sq numeric DEFAULT 15,
  ADD COLUMN IF NOT EXISTS small_job_surcharge_amount numeric DEFAULT 500;

UPDATE tenant_settings
SET small_job_threshold_sq = COALESCE(small_job_threshold_sq, 15),
    small_job_surcharge_amount = COALESCE(small_job_surcharge_amount, 500)
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'plus-ultra');
