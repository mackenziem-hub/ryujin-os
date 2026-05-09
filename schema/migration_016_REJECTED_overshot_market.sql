-- ============================================================
-- REJECTED — DO NOT RUN
-- ============================================================
-- This migration was applied 2026-04-24 evening session and immediately
-- reverted same day (see migration_017_revert_multipliers.sql + commit
-- e069272). The reasoning below double-counts overhead — the v1
-- multipliers (1.47/1.52/1.58) already embed S+M+O load.
--
-- Real-world disprove: 42 Patricia Gold quoted at $33,100 under these
-- multipliers vs. comparable Cornhill Gold accepted at $19,336 for
-- similar-complexity 34 SQ roof.
--
-- KEPT IN-TREE as audit trail. If you renumber/replay migrations,
-- skip this file. See docs/pricing_formula_v2.md for the SOP.
-- ============================================================
--
-- Migration 016 — Plus Ultra multiplier correction + kill Economy
--
-- Context: Current multipliers produce 28-37% GROSS margin (pre-S+M+O).
-- After 10% sales + 5% marketing + 20% overhead load (industry-standard
-- pricing discipline per Roofing Business School), net margins come in
-- at -3% to +1.7%. Correcting multipliers to hit target NET margins
-- of 12/17/23% on Gold/Platinum/Diamond.
--
-- Math: multiplier = 1 / (1 - (target_net + 0.35))
--   Gold     12% net  → 47% gross → 1.89×
--   Platinum 17% net  → 52% gross → 2.08×
--   Diamond  23% net  → 58% gross → 2.38×
--
-- Economy deactivated — Plus Ultra positions above sub-Landmark commodity.

-- Gold
UPDATE offers
SET multipliers = jsonb_set(
      COALESCE(multipliers, '{}'::jsonb),
      '{local}', to_jsonb(1.89::numeric)
    )
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND slug = 'gold';

-- Platinum
UPDATE offers
SET multipliers = jsonb_set(
      COALESCE(multipliers, '{}'::jsonb),
      '{local}', to_jsonb(2.08::numeric)
    )
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND slug = 'platinum';

-- Diamond
UPDATE offers
SET multipliers = jsonb_set(
      COALESCE(multipliers, '{}'::jsonb),
      '{local}', to_jsonb(2.38::numeric)
    )
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND slug = 'diamond';

-- Deactivate Economy (rationale: Plus Ultra is CertainTeed ShingleMaster —
-- Gold/Landmark is the entry-level in-brand. Economy was a commercial placeholder.)
UPDATE offers
SET active = false
WHERE tenant_id = '84c91cb9-df07-4424-8938-075e9c50cb3b'
  AND slug = 'economy';
