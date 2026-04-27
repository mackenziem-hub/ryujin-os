-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 024: Pricing SOP Alignment (Apr 27 2026)
-- Aligns the engine + merchant catalog to Plus Ultra's canonical
-- v2 pricing SOP (Plus Ultra/Sales/pricing_formula_v2.md and
-- material_pricing.md).
--
-- Three things in this migration:
--   1. Tenant settings: min_custom_multiplier, real_loading_pct,
--      apply_waste_to_bundles. Drops loading_pct + min_net_per_workday
--      (those drove the double-counting layer that Phase 1 ripped out).
--   2. Merchant price corrections to match the internal sheet exactly.
--      Two known mismatches: Starter Strip $52→$72, Hip & Ridge $55→$67.
--   3. Coastal Drywall Supplies merchant + remap of bundle items
--      (shingles, starter, ridge cap) from Kent → Coastal.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. Tenant settings: SOP-aligned controls ──────────────────

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS min_custom_multiplier numeric(5,4) DEFAULT 1.35,
  ADD COLUMN IF NOT EXISTS real_loading_pct numeric(5,4) DEFAULT 0.12,
  ADD COLUMN IF NOT EXISTS apply_waste_to_bundles boolean DEFAULT false;

-- Plus Ultra explicit defaults (per pricing_formula_v2.md + project_plus_ultra_economics.md)
UPDATE tenant_settings ts
   SET min_custom_multiplier  = COALESCE(ts.min_custom_multiplier,  1.35),
       real_loading_pct       = COALESCE(ts.real_loading_pct,       0.12),
       apply_waste_to_bundles = COALESCE(ts.apply_waste_to_bundles, false)
  FROM tenants t
 WHERE t.id = ts.tenant_id
   AND t.slug = 'plus-ultra';

COMMENT ON COLUMN tenant_settings.min_custom_multiplier IS
  'Floor for custom multipliers — below this is structurally a loss (1.35 = exact breakeven on 35% S+M+O loading). Quotes below this are flagged but not auto-bumped.';
COMMENT ON COLUMN tenant_settings.real_loading_pct IS
  'Lean real-cash overhead allocation (Plus Ultra: 0.12). Used for realCashNet reporting alongside SOP profit.';
COMMENT ON COLUMN tenant_settings.apply_waste_to_bundles IS
  'When true, shingle bundle quantities multiply by complexity waste factor (default false — Mac orders bundles flat at 3/SQ no waste).';

-- ─── 2. Merchant price corrections vs Internal Material Sheet ──

-- Starter Strip: engine $52 → sheet $72
UPDATE merchant_products
   SET price = 72.00, last_verified_at = now(), update_notes = 'Aligned to Internal Material Pricing Sheet (Apr 27)'
 WHERE product_id = 'b0000000-0000-0000-0000-000000000032'
   AND tenant_id = (SELECT id FROM tenants WHERE slug = 'plus-ultra');

-- Hip & Ridge Cap: engine $55 → sheet $67
UPDATE merchant_products
   SET price = 67.00, last_verified_at = now(), update_notes = 'Aligned to Internal Material Pricing Sheet (Apr 27)'
 WHERE product_id = 'b0000000-0000-0000-0000-000000000030'
   AND tenant_id = (SELECT id FROM tenants WHERE slug = 'plus-ultra');

-- ─── 3. Coastal Drywall Supplies merchant + bundle remap ───────

-- Add Coastal Drywall Supplies (where Mac actually orders bundles)
INSERT INTO merchants (id, tenant_id, name, slug, type, city, province, country, active)
SELECT
  gen_random_uuid(),
  t.id,
  'Coastal Drywall Supplies',
  'coastal-drywall',
  'distributor',
  'Moncton',
  'NB',
  'CA',
  true
  FROM tenants t
 WHERE t.slug = 'plus-ultra'
   AND NOT EXISTS (
     SELECT 1 FROM merchants m
      WHERE m.tenant_id = t.id AND m.slug = 'coastal-drywall'
   );

-- Remap bundle items (shingles, starter, ridge cap) Kent → Coastal.
-- Per Apr 27 verbal alignment: bundle products come from Coastal.
-- Other materials (underlayment, IWS, drip edge, valley, vents, flashings, nails,
-- caulking, OSB) stay at Kent for now — Mac to confirm separately.
UPDATE merchant_products mp
   SET merchant_id = (
        SELECT m.id FROM merchants m
         WHERE m.tenant_id = mp.tenant_id AND m.slug = 'coastal-drywall'
       ),
       last_verified_at = now(),
       update_notes = 'Remapped Kent → Coastal Drywall (Apr 27 — bundle vendor of record)'
 WHERE mp.tenant_id = (SELECT id FROM tenants WHERE slug = 'plus-ultra')
   AND mp.product_id IN (
     'b0000000-0000-0000-0000-000000000001', -- CertainTeed Landmark
     'b0000000-0000-0000-0000-000000000002', -- CertainTeed Landmark PRO
     'b0000000-0000-0000-0000-000000000003', -- CertainTeed Presidential
     'b0000000-0000-0000-0000-000000000032', -- Starter Strip
     'b0000000-0000-0000-0000-000000000030'  -- Hip & Ridge Cap
   );
