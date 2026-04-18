-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 008: Offer Restructure
-- Adds: Commercial offers, combined roof+shell, flat roofing,
--       metal roofing, offer categories, estimated pricing flags
-- ═══════════════════════════════════════════════════════════════

-- ─── Add offer_category to offers table ─────────────────────
alter table offers add column if not exists offer_category text
  default 'residential'
  check (offer_category in ('residential', 'commercial', 'custom', 'metal', 'flat'));

-- ─── Add estimated flag to offers ───────────────────────────
-- Marks offers where pricing has not been fully verified
alter table offers add column if not exists has_estimated_pricing boolean default false;

-- ─── Update existing offers with categories ─────────────────
update offers set offer_category = 'residential' where slug in ('economy', 'gold', 'platinum', 'diamond');
update offers set offer_category = 'custom' where slug in ('performance-shell-plus', 'hardie-shell', 'metal-shell');

-- ─── Flat Roofing Products ──────────────────────────────────
-- All estimated pricing — flagged for review

insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000001', 'Flat Roofing', 'flat-roofing', 'roofing/flat-roofing', 1, 11);

insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000100', 'a1000000-0000-0000-0000-000000000030',
   'TPO Membrane 60 mil', null, 'sqft', '1 sqft/sqft',
   '{"thickness_mil": 60, "type": "tpo", "note": "* Estimated pricing — verify with supplier"}'),

  ('b0000000-0000-0000-0000-000000000101', 'a1000000-0000-0000-0000-000000000030',
   'EPDM Rubber Membrane 60 mil', null, 'sqft', '1 sqft/sqft',
   '{"thickness_mil": 60, "type": "epdm", "note": "* Estimated pricing"}'),

  ('b0000000-0000-0000-0000-000000000102', 'a1000000-0000-0000-0000-000000000030',
   'Modified Bitumen (2-ply)', null, 'sqft', '1 sqft/sqft',
   '{"plies": 2, "type": "mod_bit", "note": "* Estimated pricing"}'),

  ('b0000000-0000-0000-0000-000000000103', 'a1000000-0000-0000-0000-000000000030',
   'Flat Roof Insulation (Polyiso 2")', null, 'sheet', '32 sqft/sheet',
   '{"thickness_in": 2, "r_value": 13, "type": "polyiso", "note": "* Estimated pricing"}'),

  ('b0000000-0000-0000-0000-000000000104', 'a1000000-0000-0000-0000-000000000030',
   'Bonding Adhesive (flat roof)', null, 'pail', '~500 sqft/pail',
   '{"type": "adhesive", "note": "* Estimated pricing"}');

-- Metal roofing products (already have panels in v2, add to new system)
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000110', 'a1000000-0000-0000-0000-000000000009',
   'Americana Ribbed Metal Panel', null, 'sqft', '1 sqft/sqft',
   '{"profile": "ribbed", "material": "steel", "rate_per_sqft": 2.80}'),

  ('b0000000-0000-0000-0000-000000000111', 'a1000000-0000-0000-0000-000000000009',
   'Standing Seam Metal Panel', null, 'sqft', '1 sqft/sqft',
   '{"profile": "standing_seam", "material": "steel", "rate_per_sqft": 6.00}'),

  ('b0000000-0000-0000-0000-000000000112', 'a1000000-0000-0000-0000-000000000009',
   'Metal Strapping (1x3)', null, 'SQ', '1 SQ/SQ',
   '{"note": "Horizontal strapping for Americana ribbed panels"}');

-- Regional pricing for flat + metal
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, labor_rate, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000100', 'country', 'CA', 1.80, 1.50, 2.50, 3.50, 'sqft',
   'research', 'medium', '* TPO membrane material + labor. Verify with flat roof supplier.'),
  ('b0000000-0000-0000-0000-000000000101', 'country', 'CA', 1.50, 1.20, 2.00, 3.00, 'sqft',
   'research', 'medium', '* EPDM rubber material + labor. Verify.'),
  ('b0000000-0000-0000-0000-000000000102', 'country', 'CA', 2.00, 1.60, 2.80, 4.00, 'sqft',
   'research', 'medium', '* Mod bit 2-ply material + labor. Verify.'),
  ('b0000000-0000-0000-0000-000000000103', 'country', 'CA', 45.00, 35.00, 55.00, null, 'sheet',
   'research', 'medium', '* Polyiso 2" 4x8 sheet. Verify.'),
  ('b0000000-0000-0000-0000-000000000104', 'country', 'CA', 85.00, 70.00, 100.00, null, 'pail',
   'research', 'low', '* Bonding adhesive ~500sqft/pail. Verify.'),
  ('b0000000-0000-0000-0000-000000000110', 'region', 'Atlantic', 2.80, 2.50, 3.50, null, 'sqft',
   'manual', 'high', 'Americana ribbed panel. Source: existing pricing SOP.'),
  ('b0000000-0000-0000-0000-000000000111', 'region', 'Atlantic', 6.00, 5.00, 7.50, null, 'sqft',
   'research', 'medium', '* Standing seam. Verify with supplier.'),
  ('b0000000-0000-0000-0000-000000000112', 'region', 'Atlantic', 45.00, 40.00, 55.00, null, 'SQ',
   'manual', 'high', 'Metal strapping for Americana. Source: existing pricing SOP.');


-- ═══════════════════════════════════════════════════════════════
-- COMMERCIAL OFFERS
-- Economy Commercial / Commercial Standard / Commercial Premium
-- ═══════════════════════════════════════════════════════════════

-- Commercial Economy (pitched roof — CRC/IKO, lower margins, higher volume)
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Economy', 'commercial-economy',
  'Cost-effective commercial roofing for pitched structures. IKO Cambridge shingles, standard materials. 5-year workmanship warranty.',
  'asphalt', 'commercial', 'multiplier',
  '{"local": 1.35, "dayTrip": 1.48, "extendedStay": 1.15}',
  8, 5, 0, 'Best Value', 20, false,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000004","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Commercial Standard (pitched — CertainTeed Landmark, mid margin)
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Standard', 'commercial-standard',
  'Professional commercial roofing. CertainTeed Landmark, synthetic underlayment. 10-year workmanship warranty.',
  'asphalt', 'commercial', 'multiplier',
  '{"local": 1.42, "dayTrip": 1.55, "extendedStay": 1.20}',
  12, 10, 0, 21, false,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000001","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Commercial Premium (pitched — CertainTeed Landmark PRO, premium materials)
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Premium', 'commercial-premium',
  'Premium commercial roofing. CertainTeed Landmark PRO, Grace ice shield, metal valleys. 15-year workmanship warranty.',
  'asphalt', 'commercial', 'multiplier',
  '{"local": 1.50, "dayTrip": 1.65, "extendedStay": 1.28}',
  18, 15, 25, 'Premium', 22, false,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000002","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"valley_metal","label":"Metal Valleys","category":"materials","product_id":"b0000000-0000-0000-0000-000000000022","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- FLAT ROOFING OFFERS
-- All marked has_estimated_pricing = true
-- ═══════════════════════════════════════════════════════════════

-- Commercial Flat — TPO
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Flat — TPO', 'commercial-flat-tpo',
  '* TPO single-ply membrane system. Estimated pricing — verify with flat roof supplier before quoting.',
  'asphalt', 'flat', 'multiplier',
  '{"local": 1.42, "dayTrip": 1.55, "extendedStay": 1.20}',
  12, 10, 30, true,
  '[
    {"key":"flat_membrane","label":"TPO Membrane 60 mil","category":"materials","product_id":"b0000000-0000-0000-0000-000000000100","required":true,"config":{"note":"* Estimated — verify with supplier"}},
    {"key":"flat_insulation","label":"Polyiso Insulation 2\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000103","required":true,"config":{"note":"* Estimated"}},
    {"key":"flat_adhesive","label":"Bonding Adhesive","category":"materials","product_id":"b0000000-0000-0000-0000-000000000104","required":true,"config":{"note":"* Estimated"}},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"system":"flat"}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Commercial Flat — EPDM
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Flat — EPDM', 'commercial-flat-epdm',
  '* EPDM rubber membrane system. Estimated pricing — verify with supplier.',
  'asphalt', 'flat', 'multiplier',
  '{"local": 1.42, "dayTrip": 1.55, "extendedStay": 1.20}',
  12, 10, 31, true,
  '[
    {"key":"flat_membrane","label":"EPDM Rubber 60 mil","category":"materials","product_id":"b0000000-0000-0000-0000-000000000101","required":true,"config":{"note":"* Estimated — verify with supplier"}},
    {"key":"flat_insulation","label":"Polyiso Insulation 2\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000103","required":true},
    {"key":"flat_adhesive","label":"Bonding Adhesive","category":"materials","product_id":"b0000000-0000-0000-0000-000000000104","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"system":"flat"}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Commercial Flat — Modified Bitumen
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Commercial Flat — Mod Bit', 'commercial-flat-modbit',
  '* Modified bitumen 2-ply torch-down system. Estimated pricing — verify with supplier.',
  'asphalt', 'flat', 'multiplier',
  '{"local": 1.45, "dayTrip": 1.58, "extendedStay": 1.22}',
  15, 10, 32, true,
  '[
    {"key":"flat_membrane","label":"Modified Bitumen 2-Ply","category":"materials","product_id":"b0000000-0000-0000-0000-000000000102","required":true,"config":{"note":"* Estimated — verify with supplier"}},
    {"key":"flat_insulation","label":"Polyiso Insulation 2\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000103","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"system":"flat"}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- METAL ROOFING OFFERS (now using unified multiplier method)
-- ═══════════════════════════════════════════════════════════════

-- Metal — Americana Ribbed
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Metal — Americana Ribbed', 'metal-americana',
  'Steel ribbed metal roofing (Americana profile). Includes strapping. Durable, low-maintenance.',
  'metal', 'metal', 'multiplier',
  '{"local": 1.47, "dayTrip": 1.62, "extendedStay": 1.22}',
  12, 25, 40, false,
  '[
    {"key":"metal_panels","label":"Americana Ribbed Panels","category":"materials","product_id":"b0000000-0000-0000-0000-000000000110","required":true},
    {"key":"metal_strapping","label":"Strapping (1x3)","category":"materials","product_id":"b0000000-0000-0000-0000-000000000112","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Metal Screws","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Metal Install Labor","category":"labor","required":true,"config":{"system":"metal"}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Metal — Standing Seam
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, badge, sort_order, has_estimated_pricing, scope_template)
select t.id,
  'Metal — Standing Seam', 'metal-standing-seam',
  '* Premium standing seam metal roof. Concealed fasteners, clean lines. Estimated panel pricing — verify with supplier.',
  'metal', 'metal', 'multiplier',
  '{"local": 1.52, "dayTrip": 1.67, "extendedStay": 1.27}',
  18, 30, 'Premium', 41, true,
  '[
    {"key":"metal_panels","label":"Standing Seam Panels","category":"materials","product_id":"b0000000-0000-0000-0000-000000000111","required":true,"config":{"note":"* Estimated — verify with supplier"}},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Metal Screws/Clips","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Metal Install Labor","category":"labor","required":true,"config":{"system":"metal"}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- COMBINED OFFERS — Roof + Performance Shell
-- These pair a roofing package with the full exterior shell
-- ═══════════════════════════════════════════════════════════════

-- Gold + Performance Shell
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, sort_order, scope_template)
select t.id,
  'Gold + Shell', 'gold-shell',
  'Complete exterior renovation: Gold roofing package (CertainTeed Landmark) plus full Performance Shell wall assembly. 15-year workmanship warranty.',
  'combined', 'custom', 'multiplier',
  '{"local": 1.47, "dayTrip": 1.62, "extendedStay": 1.22}',
  12, 15, 0, 50,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000001","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Roof Install Labor","category":"labor","required":true},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"strip_existing","label":"Strip Existing Siding","category":"labor","required":true},
    {"key":"sheathing_inspection","label":"Sheathing Inspection","category":"labor","required":true,"config":{"decision_point":true}},
    {"key":"osb_substrate","label":"OSB Substrate","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"labor_per_sheet":30,"material_per_sheet":20}},
    {"key":"housewrap","label":"Housewrap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000060","required":true,"config":{"default":"tyvek_standard","options":["tyvek_standard","tyvek_drainwrap"]}},
    {"key":"eps_foam","label":"EPS Foam 1/2\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000063","required":true,"config":{"material_per_sqft":0.85,"labor_per_sqft":0.40}},
    {"key":"ventigrid","label":"VentiGrid Rain Screen","category":"materials","product_id":"b0000000-0000-0000-0000-000000000062","required":true,"config":{"material_per_sqft":0.30,"labor_per_sqft":0.20}},
    {"key":"siding","label":"Siding","category":"materials","required":true,"config":{"default":"vinyl_standard","options":["vinyl_standard","vinyl_premium","vinyl_signature","hardie_lap","steel_ribbed","steel_board_batten","aluminum"],"product_map":{"vinyl_standard":"b0000000-0000-0000-0000-000000000070","vinyl_premium":"b0000000-0000-0000-0000-000000000071","vinyl_signature":"b0000000-0000-0000-0000-000000000072","hardie_lap":"b0000000-0000-0000-0000-000000000073","steel_ribbed":"b0000000-0000-0000-0000-000000000074","steel_board_batten":"b0000000-0000-0000-0000-000000000075","aluminum":"b0000000-0000-0000-0000-000000000076"}}},
    {"key":"j_channel","label":"J-Channel","category":"materials","product_id":"b0000000-0000-0000-0000-000000000080","required":true},
    {"key":"corner_posts_outside","label":"Outside Corners","category":"materials","product_id":"b0000000-0000-0000-0000-000000000083","required":true},
    {"key":"window_trim","label":"Window Trim","category":"materials","product_id":"b0000000-0000-0000-0000-000000000085","required":true},
    {"key":"drip_cap","label":"Drip Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000088","required":true},
    {"key":"soffit","label":"Soffit","category":"materials","required":true,"config":{"material":"vinyl","type":"vented"}},
    {"key":"fascia","label":"Fascia","category":"materials","required":true},
    {"key":"gutters","label":"Gutters","category":"materials","required":false},
    {"key":"window_capping","label":"Window Capping","category":"materials","required":false},
    {"key":"remediation","label":"Remediation Allowance","category":"overhead","required":true,"config":{"auto_calculate":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Platinum + Performance Shell
insert into offers (tenant_id, name, slug, description, system, offer_category, pricing_method,
  multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, scope_template)
select t.id,
  'Platinum + Shell', 'platinum-shell',
  'Premium complete exterior: Platinum roofing (CertainTeed Landmark PRO) plus full Performance Shell. 20-year workmanship warranty.',
  'combined', 'custom', 'multiplier',
  '{"local": 1.52, "dayTrip": 1.67, "extendedStay": 1.27}',
  15, 20, 25, 'Most Popular', 51,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000002","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true},
    {"key":"valley_metal","label":"Metal Valleys","category":"materials","product_id":"b0000000-0000-0000-0000-000000000022","required":false},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Roof Install Labor","category":"labor","required":true},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true},
    {"key":"strip_existing","label":"Strip Existing Siding","category":"labor","required":true},
    {"key":"sheathing_inspection","label":"Sheathing Inspection","category":"labor","required":true,"config":{"decision_point":true}},
    {"key":"osb_substrate","label":"OSB Substrate","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"labor_per_sheet":30,"material_per_sheet":20}},
    {"key":"housewrap","label":"Tyvek DrainWrap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000061","required":true,"config":{"default":"tyvek_drainwrap"}},
    {"key":"eps_foam","label":"EPS Foam 1/2\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000063","required":true,"config":{"material_per_sqft":0.85,"labor_per_sqft":0.40}},
    {"key":"ventigrid","label":"VentiGrid Rain Screen","category":"materials","product_id":"b0000000-0000-0000-0000-000000000062","required":true,"config":{"material_per_sqft":0.30,"labor_per_sqft":0.20}},
    {"key":"siding","label":"Siding","category":"materials","required":true,"config":{"default":"vinyl_premium","options":["vinyl_standard","vinyl_premium","vinyl_signature","hardie_lap","steel_ribbed","steel_board_batten","aluminum"],"product_map":{"vinyl_standard":"b0000000-0000-0000-0000-000000000070","vinyl_premium":"b0000000-0000-0000-0000-000000000071","vinyl_signature":"b0000000-0000-0000-0000-000000000072","hardie_lap":"b0000000-0000-0000-0000-000000000073","steel_ribbed":"b0000000-0000-0000-0000-000000000074","steel_board_batten":"b0000000-0000-0000-0000-000000000075","aluminum":"b0000000-0000-0000-0000-000000000076"}}},
    {"key":"j_channel","label":"J-Channel","category":"materials","product_id":"b0000000-0000-0000-0000-000000000080","required":true},
    {"key":"corner_posts_outside","label":"Outside Corners","category":"materials","product_id":"b0000000-0000-0000-0000-000000000083","required":true},
    {"key":"window_trim","label":"Window Trim","category":"materials","product_id":"b0000000-0000-0000-0000-000000000085","required":true},
    {"key":"drip_cap","label":"Drip Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000088","required":true},
    {"key":"soffit","label":"Soffit","category":"materials","required":true,"config":{"material":"vinyl","type":"vented"}},
    {"key":"fascia","label":"Fascia","category":"materials","required":true},
    {"key":"gutters","label":"Gutters","category":"materials","required":false,"config":{"leaf_guard":true}},
    {"key":"leaf_guard","label":"Leaf Guard","category":"materials","required":false},
    {"key":"window_capping","label":"Window Capping","category":"materials","required":false},
    {"key":"window_replacement","label":"Window Replacement","category":"materials","required":false},
    {"key":"remediation","label":"Remediation Allowance","category":"overhead","required":true,"config":{"auto_calculate":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- Update old metal offers to use multiplier instead of divisor
-- ═══════════════════════════════════════════════════════════════
update offers
set pricing_method = 'multiplier'
where pricing_method = 'divisor';
