-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 006: Expanded Product Catalog & Wall Assembly
-- VentiGrid, housewrap, siding variants, windows, contractor referrals
-- All regional pricing marked with confidence + source
-- ═══════════════════════════════════════════════════════════════

-- ─── NEW PRODUCT CATEGORIES ─────────────────────────────────
-- Exterior > Siding subtypes
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a2000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000014', 'Vinyl Siding', 'vinyl-siding', 'exterior/siding/vinyl', 2, 1),
  ('a2000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000014', 'Fiber Cement Siding', 'fiber-cement', 'exterior/siding/fiber-cement', 2, 2),
  ('a2000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000014', 'Metal Siding', 'metal-siding', 'exterior/siding/metal', 2, 3);

-- Exterior > Siding Accessories
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000002', 'Siding Accessories', 'siding-accessories', 'exterior/siding-accessories', 1, 6);

-- Structural > Housewrap (was a1000000-...-000000000018, already exists)
-- Structural > Rain Screen
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000003', 'Rain Screen', 'rain-screen', 'structural/rain-screen', 1, 5);

-- Windows (new top-level category)
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order, icon) values
  ('a0000000-0000-0000-0000-000000000006', null, 'Windows & Doors', 'windows-doors', 'windows-doors', 0, 6, '🪟');

insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000006', 'Vinyl Replacement Windows', 'vinyl-windows', 'windows-doors/vinyl-windows', 1, 1),
  ('a1000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000006', 'Window Installation', 'window-install', 'windows-doors/window-install', 1, 2);


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Housewrap
-- ═══════════════════════════════════════════════════════════════

insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  -- Tyvek HomeWrap (standard)
  ('b0000000-0000-0000-0000-000000000060', 'a1000000-0000-0000-0000-000000000018',
   'Tyvek HomeWrap 9x100', 'DuPont', 'roll', '900 sqft/roll',
   '{"width_ft": 9, "length_ft": 100, "coverage_sqft": 900, "type": "standard"}'),

  -- Tyvek DrainWrap (premium — grooved drainage surface)
  ('b0000000-0000-0000-0000-000000000061', 'a1000000-0000-0000-0000-000000000018',
   'Tyvek DrainWrap 9x125', 'DuPont', 'roll', '1125 sqft/roll',
   '{"width_ft": 9, "length_ft": 125, "coverage_sqft": 1125, "type": "premium_drainage", "note": "Grooved surface for enhanced drainage behind cladding"}');


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Rain Screen
-- ═══════════════════════════════════════════════════════════════

insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000062', 'a1000000-0000-0000-0000-000000000021',
   'VentiGrid 6mm Drainage Mat', null, 'sqft', '1 sqft/sqft',
   '{"thickness_mm": 6, "type": "polymer_drainage_mat", "note": "Rain screen layer between sheathing and cladding. Performance Shell mandatory component."}');


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Insulation Board
-- ═══════════════════════════════════════════════════════════════

insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000063', 'a1000000-0000-0000-0000-000000000019',
   'EPS Foam Board 1/2" Type 1 (4x8)', 'DuroSpan', 'sheet', '32 sqft/sheet',
   '{"thickness_in": 0.5, "r_value": 1.88, "width_ft": 4, "height_ft": 8, "coverage_sqft": 32, "type": "rigid_insulation"}'),

  ('b0000000-0000-0000-0000-000000000064', 'a1000000-0000-0000-0000-000000000019',
   'EPS Foam Board 1" Type 1 (4x8)', 'DuroSpan', 'sheet', '32 sqft/sheet',
   '{"thickness_in": 1.0, "r_value": 3.75, "width_ft": 4, "height_ft": 8, "coverage_sqft": 32, "type": "rigid_insulation"}');


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Siding
-- ═══════════════════════════════════════════════════════════════

-- Vinyl siding (Gentek lines)
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000070', 'a2000000-0000-0000-0000-000000000010',
   'Gentek Sovereign Select (Standard Vinyl)', 'Gentek', 'square', '100 sqft/square',
   '{"line": "Sovereign Select", "tier": "standard", "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000071', 'a2000000-0000-0000-0000-000000000010',
   'Gentek Sequoia Select (Premium Vinyl)', 'Gentek', 'square', '100 sqft/square',
   '{"line": "Sequoia Select", "tier": "premium", "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000072', 'a2000000-0000-0000-0000-000000000010',
   'Gentek Premium (Signature Vinyl)', 'Gentek', 'square', '100 sqft/square',
   '{"line": "Premium", "tier": "signature", "material": "vinyl"}');

-- Fiber cement siding (James Hardie)
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000073', 'a2000000-0000-0000-0000-000000000011',
   'HardiePlank Lap Siding 8.25" x 12''', 'James Hardie', 'sqft', '1 sqft/sqft',
   '{"plank_width_in": 8.25, "plank_length_ft": 12, "coverage_sqft_per_plank": 8.25, "type": "lap", "material": "fiber_cement", "note": "Price tracked per sqft for consistency with other siding"}');

-- Metal siding
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000074', 'a2000000-0000-0000-0000-000000000012',
   'Steel Corrugated/Ribbed Siding (26 ga)', null, 'sqft', '1 sqft/sqft',
   '{"gauge": 26, "profile": "ribbed", "material": "steel"}'),

  ('b0000000-0000-0000-0000-000000000075', 'a2000000-0000-0000-0000-000000000012',
   'Steel Board & Batten Siding', null, 'sqft', '1 sqft/sqft',
   '{"profile": "board_and_batten", "material": "steel"}'),

  ('b0000000-0000-0000-0000-000000000076', 'a2000000-0000-0000-0000-000000000012',
   'Aluminum Siding Panel', null, 'sqft', '1 sqft/sqft',
   '{"material": "aluminum"}');


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Siding Accessories
-- ═══════════════════════════════════════════════════════════════

insert into products (id, category_id, name, unit, specs) values
  ('b0000000-0000-0000-0000-000000000080', 'a1000000-0000-0000-0000-000000000020',
   'J-Channel (Vinyl)', 'piece', '{"length_ft": 12, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000081', 'a1000000-0000-0000-0000-000000000020',
   'F-Channel', 'piece', '{"length_ft": 12, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000082', 'a1000000-0000-0000-0000-000000000020',
   'H-Channel (Seam Trim)', 'piece', '{"length_ft": 12, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000083', 'a1000000-0000-0000-0000-000000000020',
   'Outside Corner Post', 'piece', '{"length_ft": 10, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000084', 'a1000000-0000-0000-0000-000000000020',
   'Inside Corner Post', 'piece', '{"length_ft": 10, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000085', 'a1000000-0000-0000-0000-000000000020',
   'Window/Door Trim (J-block)', 'piece', '{"material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000086', 'a1000000-0000-0000-0000-000000000020',
   'Undersill Trim', 'piece', '{"length_ft": 12, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000087', 'a1000000-0000-0000-0000-000000000020',
   'Siding Starter Strip', 'piece', '{"length_ft": 12, "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000088', 'a1000000-0000-0000-0000-000000000020',
   'Drip Cap (Window Head Flashing)', 'piece', '{"length_ft": 10, "material": "aluminum"}');


-- ═══════════════════════════════════════════════════════════════
-- NEW PRODUCTS — Windows
-- ═══════════════════════════════════════════════════════════════

insert into products (id, category_id, name, brand, unit, specs) values
  ('b0000000-0000-0000-0000-000000000090', 'a1000000-0000-0000-0000-000000000022',
   'Vinyl Replacement Window — Small (24x36)', null, 'each',
   '{"size": "small", "nominal_width_in": 24, "nominal_height_in": 36, "rough_opening": "24.5x36.5", "typical_use": "bathroom/basement", "type": "double_hung", "material": "vinyl"}'),

  ('b0000000-0000-0000-0000-000000000091', 'a1000000-0000-0000-0000-000000000022',
   'Vinyl Replacement Window — Medium (36x48)', null, 'each',
   '{"size": "medium", "nominal_width_in": 36, "nominal_height_in": 48, "rough_opening": "36.5x48.5", "typical_use": "bedroom", "type": "double_hung", "material": "vinyl", "egress_compliant": true}'),

  ('b0000000-0000-0000-0000-000000000092', 'a1000000-0000-0000-0000-000000000022',
   'Vinyl Replacement Window — Large (48x60)', null, 'each',
   '{"size": "large", "nominal_width_in": 48, "nominal_height_in": 60, "rough_opening": "48.5x60.5", "typical_use": "living_room", "type": "double_hung", "material": "vinyl"}');


-- ═══════════════════════════════════════════════════════════════
-- REGIONAL PRICING — Atlantic Canada defaults
-- For items without merchant-specific pricing yet
-- confidence: low/medium/high — source documented
-- ═══════════════════════════════════════════════════════════════

-- Housewrap
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000060', 'region', 'Atlantic', 210.00, 200.00, 220.00, 'roll',
   'research', 'medium', 'Tyvek HomeWrap 9x100 (~$0.23/sqft). Source: Stone''s Home Centers, IHL Canada. Apr 2026.'),

  ('b0000000-0000-0000-0000-000000000061', 'region', 'Atlantic', 385.00, 350.00, 420.00, 'roll',
   'research', 'medium', 'Tyvek DrainWrap 9x125. Estimated at ~1.5-2x HomeWrap. No exact CAD price confirmed.'),

  ('b0000000-0000-0000-0000-000000000062', 'region', 'Atlantic', 0.30, 0.25, 0.40, 'sqft',
   'manual', 'high', 'VentiGrid 6mm material cost. Source: pricing_formula_v2.md Section 9. Verified.'),

  ('b0000000-0000-0000-0000-000000000063', 'region', 'Atlantic', 15.00, 12.00, 18.00, 'sheet',
   'research', 'medium', 'EPS 1/2" Type 1 4x8 (~$0.47/sqft). Estimated from 3/4" and 1" pricing curve.'),

  ('b0000000-0000-0000-0000-000000000064', 'region', 'Atlantic', 26.00, 22.00, 30.00, 'sheet',
   'research', 'medium', 'EPS 1" Type 1 4x8. Home Depot Canada DuroSpan range.');

-- Siding — vinyl
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000070', 'region', 'Atlantic', 120.00, 100.00, 140.00, 'square',
   'manual', 'high', 'Gentek Sovereign Select. Source: material_pricing.md. Standard vinyl ~$1.20/sqft material.'),

  ('b0000000-0000-0000-0000-000000000071', 'region', 'Atlantic', 145.00, 130.00, 160.00, 'square',
   'manual', 'high', 'Gentek Sequoia Select. Source: material_pricing.md. $145/square confirmed.'),

  ('b0000000-0000-0000-0000-000000000072', 'region', 'Atlantic', 180.00, 160.00, 200.00, 'square',
   'manual', 'high', 'Gentek Premium. Source: material_pricing.md. $180/square confirmed.');

-- Siding — fiber cement
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, labor_rate, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000073', 'region', 'Atlantic', 3.75, 2.50, 5.00, 8.00, 'sqft',
   'research', 'medium', 'HardiePlank material ~$3.75/sqft CAD (US $2.50-$5 + 30%). Labor ~$8/sqft. Installed ~$12-$18/sqft total.');

-- Siding — metal
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, labor_rate, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000074', 'region', 'Atlantic', 3.00, 2.00, 4.00, 7.00, 'sqft',
   'research', 'high', 'Steel ribbed 26ga. Source: BarrierBoss (Canadian mfg). Installed $8-$12/sqft.'),

  ('b0000000-0000-0000-0000-000000000075', 'region', 'Atlantic', 4.00, 3.00, 5.00, 8.00, 'sqft',
   'research', 'medium', 'Steel board & batten. 10-20% premium over ribbed. Installed $10-$15/sqft.'),

  ('b0000000-0000-0000-0000-000000000076', 'region', 'Atlantic', 6.00, 4.00, 8.00, 8.50, 'sqft',
   'research', 'medium', 'Aluminum siding panels. Installed $9-$17/sqft.');

-- Siding accessories
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000080', 'region', 'Atlantic', 10.00, 8.00, 12.00, 'piece', 'manual', 'high', 'J-channel. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000081', 'region', 'Atlantic', 12.00, 10.00, 14.00, 'piece', 'manual', 'high', 'F-channel. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000082', 'region', 'Atlantic', 14.00, 12.00, 16.00, 'piece', 'manual', 'high', 'H-channel. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000083', 'region', 'Atlantic', 28.00, 24.00, 32.00, 'piece', 'manual', 'high', 'Outside corner. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000084', 'region', 'Atlantic', 22.00, 18.00, 26.00, 'piece', 'manual', 'high', 'Inside corner. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000085', 'region', 'Atlantic', 20.00, 16.00, 24.00, 'piece', 'manual', 'high', 'Window/door trim. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000086', 'region', 'Atlantic', 14.00, 12.00, 16.00, 'piece', 'manual', 'high', 'Undersill trim. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000087', 'region', 'Atlantic', 10.00, 8.00, 12.00, 'piece', 'manual', 'high', 'Siding starter strip. Source: material_pricing.md.'),
  ('b0000000-0000-0000-0000-000000000088', 'region', 'Atlantic', 8.00, 6.00, 10.00, 'piece', 'research', 'medium', 'Drip cap / window head flashing. Aluminum 10ft.');

-- Windows — supply only (labor is separate)
insert into regional_pricing (product_id, geo_level, geo_value, median_price, low_price, high_price, labor_rate, unit, source, confidence, notes) values
  ('b0000000-0000-0000-0000-000000000090', 'country', 'CA', 325.00, 250.00, 400.00, 200.00, 'each',
   'research', 'high', 'Small vinyl window 24x36. Supply $250-$400, labor $150-$250. Source: NorthShield, Ecoline, Vinyl Light 2026.'),

  ('b0000000-0000-0000-0000-000000000091', 'country', 'CA', 450.00, 350.00, 550.00, 250.00, 'each',
   'research', 'high', 'Medium vinyl window 36x48. Supply $350-$550, labor $200-$300. Source: NorthShield, Ecoline 2026.'),

  ('b0000000-0000-0000-0000-000000000092', 'country', 'CA', 700.00, 500.00, 900.00, 350.00, 'each',
   'research', 'high', 'Large vinyl window 48x60. Supply $500-$900, labor $250-$400. Source: NorthShield, Ecoline 2026.');


-- ═══════════════════════════════════════════════════════════════
-- CONTRACTOR REFERRALS TABLE
-- Access-controlled directory of subcontractors & specialists
-- ═══════════════════════════════════════════════════════════════

create table contractor_referrals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,

  -- Identity
  name text not null,                     -- 'Ben Crocker', 'Atlantic Windows Inc.'
  company text,                           -- company name if different from person
  trade text not null,                    -- 'carpenter', 'window_installer', 'electrician', 'plumber', etc.
  specialties text[],                     -- ['red_seal', 'GoNano_dealer', 'skylights']

  -- Contact
  phone text,
  email text,
  website text,
  address text,
  city text,
  province text,

  -- Relationship
  relationship text default 'referral' check (relationship in (
    'subcontractor', 'referral', 'partner', 'preferred'
  )),
  rate_info jsonb default '{}',           -- {"hourly": 55, "per_window": 200, "notes": "..."}
  notes text,

  -- Access control — who can see this referral
  visibility text default 'admin' check (visibility in (
    'admin', 'crew_lead', 'crew', 'public'
  )),

  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_referrals_tenant on contractor_referrals(tenant_id);
create index idx_referrals_trade on contractor_referrals(trade);

alter table contractor_referrals enable row level security;
create trigger trg_referrals_updated before update on contractor_referrals
  for each row execute function update_updated_at();

-- Seed: Ben Crocker (known referral)
insert into contractor_referrals (tenant_id, name, company, trade, specialties, email, relationship, rate_info, notes, visibility)
select t.id,
  'Ben Crocker', 'NanoSeal NB', 'carpenter',
  ARRAY['red_seal', 'GoNano_exclusive_NB_dealer'],
  'BenC@nanosealnb.ca',
  'referral',
  '{"notes": "Red Seal carpenter. GoNano exclusive NB dealer. Initial contact Apr 2026 via Facebook/Darcy."}',
  'Met through Darcy. Interested in partnership. Had call scheduled Apr 14.',
  'admin'
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- UPDATED OFFER — Performance Shell Plus (full wall assembly)
-- Replaces the flat scope_template with the real build stack
-- ═══════════════════════════════════════════════════════════════

update offers
set scope_template = '[
  {"key":"strip_existing","label":"Strip Existing Siding","category":"labor","required":true,"config":{"note":"Remove existing cladding to expose sheathing for inspection"}},
  {"key":"sheathing_inspection","label":"Sheathing Inspection & Assessment","category":"labor","required":true,"config":{"note":"Inspect for rot, damage, structural issues. Triggers remediation scope.","decision_point":true}},
  {"key":"osb_substrate","label":"OSB Substrate 7/16\" 4x8","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"note":"Mandatory — replaces damaged sheathing. Full coverage on Performance Shell.","labor_per_sheet":30,"material_per_sheet":20}},
  {"key":"housewrap","label":"Housewrap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000060","required":true,"config":{"default":"tyvek_standard","options":["tyvek_standard","tyvek_drainwrap"],"note":"Weather barrier over sheathing"}},
  {"key":"eps_foam","label":"EPS Foam Insulation 1/2\" Type 1","category":"materials","product_id":"b0000000-0000-0000-0000-000000000063","required":true,"config":{"note":"Rigid insulation layer. R-1.88. $0.85/sqft material + $0.40/sqft labor per v2 SOP.","material_per_sqft":0.85,"labor_per_sqft":0.40}},
  {"key":"ventigrid","label":"VentiGrid 6mm Rain Screen","category":"materials","product_id":"b0000000-0000-0000-0000-000000000062","required":true,"config":{"note":"Polymer drainage mat. Creates airspace behind cladding. $0.30/sqft material + $0.20/sqft labor.","material_per_sqft":0.30,"labor_per_sqft":0.20}},
  {"key":"siding","label":"Siding","category":"materials","required":true,"config":{"default":"vinyl_standard","options":["vinyl_standard","vinyl_premium","vinyl_signature","hardie_lap","steel_ribbed","steel_board_batten","aluminum"],"product_map":{"vinyl_standard":"b0000000-0000-0000-0000-000000000070","vinyl_premium":"b0000000-0000-0000-0000-000000000071","vinyl_signature":"b0000000-0000-0000-0000-000000000072","hardie_lap":"b0000000-0000-0000-0000-000000000073","steel_ribbed":"b0000000-0000-0000-0000-000000000074","steel_board_batten":"b0000000-0000-0000-0000-000000000075","aluminum":"b0000000-0000-0000-0000-000000000076"}}},
  {"key":"j_channel","label":"J-Channel","category":"materials","product_id":"b0000000-0000-0000-0000-000000000080","required":true,"config":{"note":"Around windows, doors, soffits"}},
  {"key":"corner_posts_outside","label":"Outside Corner Posts","category":"materials","product_id":"b0000000-0000-0000-0000-000000000083","required":true},
  {"key":"corner_posts_inside","label":"Inside Corner Posts","category":"materials","product_id":"b0000000-0000-0000-0000-000000000084","required":false},
  {"key":"window_trim","label":"Window & Door Trim","category":"materials","product_id":"b0000000-0000-0000-0000-000000000085","required":true},
  {"key":"undersill_trim","label":"Undersill Trim","category":"materials","product_id":"b0000000-0000-0000-0000-000000000086","required":true},
  {"key":"starter_strip_siding","label":"Siding Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000087","required":true},
  {"key":"drip_cap","label":"Drip Cap (Window Head Flashing)","category":"materials","product_id":"b0000000-0000-0000-0000-000000000088","required":true,"config":{"note":"Aluminum head flashing above windows/doors"}},
  {"key":"soffit","label":"Soffit","category":"materials","required":true,"config":{"material":"vinyl","type":"vented","removal":"strip_existing"}},
  {"key":"fascia","label":"Fascia","category":"materials","required":true,"config":{"material":"aluminum_cap"}},
  {"key":"gutters","label":"Gutters","category":"materials","required":false,"config":{"type":"5k","material":"aluminum","leaf_guard":false,"remove_existing":true}},
  {"key":"window_capping","label":"Window & Door Aluminum Capping","category":"materials","required":false,"config":{"type":"aluminum_wrap","note":"Wrap existing frames in aluminum. Alternative to full window replacement."}},
  {"key":"window_replacement","label":"Window Replacement","category":"materials","required":false,"config":{"note":"Full window replacement — priced per window by size. Requires contractor referral for install.","sizes":{"small":"b0000000-0000-0000-0000-000000000090","medium":"b0000000-0000-0000-0000-000000000091","large":"b0000000-0000-0000-0000-000000000092"}}},
  {"key":"remediation","label":"Remediation Allowance","category":"overhead","required":true,"config":{"note":"Mandatory — scales with project hard cost. Unused portion credited back to homeowner.","auto_calculate":true}},
  {"key":"disposal","label":"Disposal","category":"disposal","required":true}
]'::jsonb,
updated_at = now()
where slug = 'performance-shell-plus'
  and tenant_id = (select id from tenants where slug = 'plus-ultra');


-- ═══════════════════════════════════════════════════════════════
-- NEW OFFER — Hardie Shell (fiber cement Performance Shell)
-- Premium exterior with James Hardie + full wall assembly
-- ═══════════════════════════════════════════════════════════════

insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, badge, sort_order, scope_template)
select t.id,
  'Hardie Shell', 'hardie-shell',
  'Premium exterior renovation with James Hardie fiber cement siding. Full wall assembly: OSB substrate, Tyvek DrainWrap, VentiGrid rain screen, HardiePlank lap siding. 15-year workmanship warranty.',
  'exterior', 'multiplier',
  '{"local": 1.52, "dayTrip": 1.67, "extendedStay": 1.27}',
  18, 15, 'Premium', 11,
  '[
    {"key":"strip_existing","label":"Strip Existing Siding","category":"labor","required":true},
    {"key":"sheathing_inspection","label":"Sheathing Inspection","category":"labor","required":true,"config":{"decision_point":true}},
    {"key":"osb_substrate","label":"OSB Substrate 7/16\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"labor_per_sheet":30,"material_per_sheet":20}},
    {"key":"housewrap","label":"Tyvek DrainWrap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000061","required":true,"config":{"default":"tyvek_drainwrap","note":"Premium drainage housewrap — mandatory for Hardie"}},
    {"key":"eps_foam","label":"EPS Foam 1/2\" Type 1","category":"materials","product_id":"b0000000-0000-0000-0000-000000000063","required":true,"config":{"material_per_sqft":0.85,"labor_per_sqft":0.40}},
    {"key":"ventigrid","label":"VentiGrid Rain Screen","category":"materials","product_id":"b0000000-0000-0000-0000-000000000062","required":true,"config":{"material_per_sqft":0.30,"labor_per_sqft":0.20}},
    {"key":"siding","label":"HardiePlank Lap Siding","category":"materials","product_id":"b0000000-0000-0000-0000-000000000073","required":true,"config":{"material":"fiber_cement","note":"James Hardie fiber cement — primed, paint-ready"}},
    {"key":"j_channel","label":"J-Channel (Hardie Trim)","category":"materials","required":true},
    {"key":"corner_posts_outside","label":"Outside Corner Posts","category":"materials","required":true},
    {"key":"window_trim","label":"HardieTrim Window & Door","category":"materials","required":true},
    {"key":"drip_cap","label":"Drip Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000088","required":true},
    {"key":"soffit","label":"Soffit","category":"materials","required":true,"config":{"material":"vinyl","type":"vented"}},
    {"key":"fascia","label":"Fascia","category":"materials","required":true,"config":{"material":"aluminum_cap"}},
    {"key":"gutters","label":"Gutters","category":"materials","required":false},
    {"key":"window_capping","label":"Window Capping","category":"materials","required":false},
    {"key":"window_replacement","label":"Window Replacement","category":"materials","required":false},
    {"key":"remediation","label":"Remediation Allowance","category":"overhead","required":true,"config":{"auto_calculate":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';


-- ═══════════════════════════════════════════════════════════════
-- NEW OFFER — Metal Shell (steel siding Performance Shell)
-- ═══════════════════════════════════════════════════════════════

insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, sort_order, scope_template)
select t.id,
  'Metal Shell', 'metal-shell',
  'Industrial-grade exterior with steel siding. Full wall assembly: OSB substrate, Tyvek, VentiGrid, steel panel cladding. Low maintenance, high durability.',
  'exterior', 'multiplier',
  '{"local": 1.52, "dayTrip": 1.67, "extendedStay": 1.27}',
  15, 15, 12,
  '[
    {"key":"strip_existing","label":"Strip Existing Siding","category":"labor","required":true},
    {"key":"sheathing_inspection","label":"Sheathing Inspection","category":"labor","required":true,"config":{"decision_point":true}},
    {"key":"osb_substrate","label":"OSB Substrate 7/16\"","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"labor_per_sheet":30,"material_per_sheet":20}},
    {"key":"housewrap","label":"Tyvek HomeWrap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000060","required":true},
    {"key":"ventigrid","label":"VentiGrid Rain Screen","category":"materials","product_id":"b0000000-0000-0000-0000-000000000062","required":true,"config":{"material_per_sqft":0.30,"labor_per_sqft":0.20}},
    {"key":"siding","label":"Steel Siding Panels","category":"materials","required":true,"config":{"default":"steel_ribbed","options":["steel_ribbed","steel_board_batten"],"product_map":{"steel_ribbed":"b0000000-0000-0000-0000-000000000074","steel_board_batten":"b0000000-0000-0000-0000-000000000075"}}},
    {"key":"metal_trim","label":"Metal Trim Package","category":"materials","required":true,"config":{"note":"Corner trim, J-channel, base trim — all metal to match panels"}},
    {"key":"soffit","label":"Soffit","category":"materials","required":true},
    {"key":"fascia","label":"Fascia","category":"materials","required":true},
    {"key":"gutters","label":"Gutters","category":"materials","required":false},
    {"key":"window_capping","label":"Window Capping","category":"materials","required":false},
    {"key":"remediation","label":"Remediation Allowance","category":"overhead","required":true,"config":{"auto_calculate":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';
