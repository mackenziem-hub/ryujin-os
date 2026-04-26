-- Migration 018 — workorder waste_pct
--
-- Reason: until tonight, public/production-materials.html hardcoded WASTE=10%
-- while the quote engine uses 10/15/20% by complexity. Crew was under-ordering
-- shingles for medium/complex jobs.
--
-- Tonight's code-only fix has computeMaterials() resolve waste from:
--   wo.waste_pct  →  wo.complexity (not yet a column)  →  wo.estimate.complexity  →  default 0.15
--
-- This migration adds wo.waste_pct so a WO can be self-describing — useful for
-- WOs without a linked estimate (e.g. 95 Cornhill case from 2026-04-24).
--
-- See docs/pricing_formula_v2.md §7a.
-- Idempotent.

ALTER TABLE workorders
  ADD COLUMN IF NOT EXISTS waste_pct numeric(4,3);

COMMENT ON COLUMN workorders.waste_pct IS
  'Material waste factor (0.10/0.15/0.20). Stamped at quote-export so production-materials.html does not have to reason about complexity. Falls back to estimate.complexity then default 0.15 if null.';
