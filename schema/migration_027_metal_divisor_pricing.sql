-- ═══════════════════════════════════════════════════════════════
-- Migration 027 — Metal Roofing Divisor Pricing (SOP-aligned)
--
-- Aligns metal offers with Plus Ultra/Sales/Metal_Roofing_Pricing_Logic_SOP.pdf
-- Replaces broken multiplier math (1.47/1.52) with divisor stack (0.53/0.50/0.48)
-- per Section 2 of the SOP.
--
-- Engine support: lib/quoteEngineV3.js — divisor branch added in pricing block.
--   pricing_method = 'divisor' → sellingPrice = hardCost / multipliers.divisor
--
-- Existing 2 metal offers updated in place (slugs preserved for historical
-- estimate references). Adds 3rd tier (metal-premium) for the full SOP ladder.
-- ═══════════════════════════════════════════════════════════════

-- 1. Metal Standard (formerly Americana Ribbed) — 0.53 divisor, 12% net target
update offers
set name = 'Metal Standard (Americana Ribbed)',
    description = 'Tear-off plus install of Americana ribbed metal panels. 15-year workmanship warranty. Entry-level metal — most economical, durable, low-maintenance.',
    pricing_method = 'divisor',
    multipliers = '{"divisor": 0.53}'::jsonb,
    margin_floor = 12,
    warranty_years = 15,
    warranty_adder_per_sq = 0,
    badge = null
where slug = 'metal-americana'
  and tenant_id = (select id from tenants where slug = 'plus-ultra');

-- 2. Metal Enhanced (formerly Standing Seam) — 0.50 divisor, 15% net target
update offers
set name = 'Metal Enhanced (Standing Seam)',
    description = 'Tear-off, deck seal (peel-and-stick), premium underlayment, then install of standing seam panels with concealed fasteners. 20-year workmanship warranty.',
    pricing_method = 'divisor',
    multipliers = '{"divisor": 0.50}'::jsonb,
    margin_floor = 15,
    warranty_years = 20,
    warranty_adder_per_sq = 25,
    badge = 'Mid-Tier',
    has_estimated_pricing = true
where slug = 'metal-standing-seam'
  and tenant_id = (select id from tenants where slug = 'plus-ultra');

-- 3. NEW — Metal Premium (Standing Seam + full OSB redeck + 25-yr warranty)
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Metal Premium (Standing Seam + Redeck)', 'metal-premium',
  'Tear-off, full 7/16 OSB redeck, deck seal, premium underlayment, Grace I&W, then install of standing seam panels. 25-year workmanship warranty — flagship metal system.',
  'metal', 'metal', 'divisor',
  '{"divisor": 0.48}'::jsonb,
  17, 25, 50, 'Premium', 42, true,
  '[
    {"key":"metal_panels","label":"Standing Seam Panels","category":"materials","product_id":"b0000000-0000-0000-0000-000000000111","required":true,"config":{"note":"* Estimated — verify with supplier"}},
    {"key":"underlayment","label":"Premium Synthetic Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Grace Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Metal Screws/Clips","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"redeck_labor","label":"OSB Redeck (full roof)","category":"labor","required":true,"config":{"note":"Set redeckSheets ≈ measuredSQ × 3.125 in measurements."}},
    {"key":"base_labor","label":"Metal Install Labor","category":"labor","required":true,"config":{"system":"metal"}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true,"config":{"system":"metal"}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- 4. Verify post-migration state
select slug, name, pricing_method, multipliers, warranty_years, warranty_adder_per_sq, sort_order
from offers
where system = 'metal'
  and tenant_id = (select id from tenants where slug = 'plus-ultra')
order by sort_order;
