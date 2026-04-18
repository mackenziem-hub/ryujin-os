-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 004: Merchant Database & Regional Pricing
-- Material intelligence layer — real costs feed pricing engine
-- ═══════════════════════════════════════════════════════════════

-- ─── MERCHANTS ───────────────────────────────────────────────
-- Stores and suppliers. Can be tenant-specific or platform-shared.
create table merchants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,  -- null = platform-wide
  name text not null,                     -- 'Home Depot Moncton', 'Kent Riverview', 'Birdstairs'
  slug text not null,
  type text default 'retail' check (type in (
    'big_box', 'retail', 'specialty', 'distributor', 'manufacturer', 'online'
  )),
  address text,
  city text,
  province text,
  postal_code text,
  country text default 'CA',
  latitude numeric(10,7),
  longitude numeric(10,7),
  phone text,
  website text,                           -- base URL for product lookups
  product_url_pattern text,               -- e.g., 'https://homedepot.ca/product/{sku}'
  notes text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_merchants_tenant on merchants(tenant_id);
create index idx_merchants_city on merchants(city, province);

-- ─── PRODUCT CATEGORIES ──────────────────────────────────────
-- Hierarchical: Roofing > Shingles > Asphalt > CertainTeed
create table product_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references product_categories(id),
  name text not null,                     -- 'Shingles', 'Asphalt', 'CertainTeed'
  slug text not null,
  path text not null,                     -- 'roofing/shingles/asphalt/certainteed' (materialized path)
  depth int default 0,
  sort_order int default 0,
  icon text,                              -- emoji or icon name
  created_at timestamptz default now(),
  unique(parent_id, slug)
);

create index idx_categories_parent on product_categories(parent_id);
create index idx_categories_path on product_categories(path);

-- ─── PRODUCTS ────────────────────────────────────────────────
-- Master product catalog. A product can exist at multiple merchants at different prices.
create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id),
  name text not null,                     -- 'CertainTeed Landmark — Weathered Wood'
  description text,
  unit text not null default 'each',      -- 'bundle', 'roll', 'sheet', 'piece', 'LF', 'sqft', 'each', 'box', 'tube'
  units_per_coverage text,                -- '3 bundles/SQ', '10 SQ/roll', '10 LF/piece'
  brand text,
  model text,                             -- product line or model name
  specs jsonb default '{}',               -- { color, thickness, warranty_years, coverage_sqft, etc. }
  photo_url text,
  tags text[] default '{}',
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_products_category on products(category_id);
create index idx_products_brand on products(brand);
create index idx_products_name on products using gin(to_tsvector('english', name));

-- ─── MERCHANT PRODUCTS ───────────────────────────────────────
-- Price and availability of a product at a specific merchant.
-- Same product can be at multiple merchants with different prices.
create table merchant_products (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references merchants(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  tenant_id uuid references tenants(id) on delete cascade,  -- null = platform-wide pricing

  -- Pricing
  price numeric(10,2) not null,           -- current price per unit
  price_currency text default 'CAD',
  bulk_price numeric(10,2),               -- discounted price for bulk orders
  bulk_min_qty int,                       -- minimum qty for bulk price

  -- Store location
  sku text,                               -- store's SKU/product code
  aisle text,                             -- 'Aisle 23, Bay 4'
  product_url text,                       -- direct link to product page

  -- Availability
  in_stock boolean default true,
  stock_qty int,                          -- null = unknown
  lead_time_days int,                     -- for special order items

  -- Verification
  last_verified_at timestamptz default now(),
  verified_by text default 'manual',      -- 'manual', 'auto', 'scrape', 'api'
  auto_update boolean default true,       -- attempt quarterly refresh
  update_notes text,                      -- 'Auto-updates not available; manual entry required'

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(merchant_id, product_id, tenant_id)
);

create index idx_mp_merchant on merchant_products(merchant_id);
create index idx_mp_product on merchant_products(product_id);
create index idx_mp_tenant on merchant_products(tenant_id);
create index idx_mp_verified on merchant_products(last_verified_at);

-- ─── REGIONAL PRICING ───────────────────────────────────────
-- Median/default costs by category and geographic level.
-- Used when no merchant-specific price exists.
-- Geographic fallback: postal → city → province → region → country
create table regional_pricing (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id),
  product_id uuid references products(id),           -- null = category-level default

  -- Geographic scope (most specific wins)
  geo_level text not null check (geo_level in (
    'postal', 'city', 'province', 'region', 'country', 'continent'
  )),
  geo_value text not null,                -- 'E1B', 'Moncton', 'NB', 'Atlantic', 'CA', 'NA'

  -- Pricing
  median_price numeric(10,2),             -- material cost per unit
  low_price numeric(10,2),                -- budget end
  high_price numeric(10,2),               -- premium end
  labor_rate numeric(10,2),               -- labor cost per unit (if applicable)
  unit text,                              -- matches product unit

  -- Source
  source text,                            -- 'research', 'survey', 'statscan', 'manual'
  confidence text default 'medium' check (confidence in ('low', 'medium', 'high')),
  last_researched_at timestamptz default now(),
  notes text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_regional_geo on regional_pricing(geo_level, geo_value);
create index idx_regional_category on regional_pricing(category_id);
create index idx_regional_product on regional_pricing(product_id);

-- ─── PRICE AUDIT LOG ─────────────────────────────────────────
-- Tracks where each price in a quote came from. Audit trail.
create table price_audit (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references estimates(id),
  tenant_id uuid references tenants(id) on delete cascade not null,
  line_item text not null,                -- 'shingles', 'underlayment', etc.
  resolved_price numeric(10,2),
  price_source text not null check (price_source in (
    'override', 'merchant', 'regional', 'fallback', 'default'
  )),
  source_id uuid,                         -- merchant_product.id or regional_pricing.id
  source_detail text,                     -- 'Kent Riverview @ $49/bundle' or 'NB median'
  created_at timestamptz default now()
);

create index idx_audit_estimate on price_audit(estimate_id);

-- ─── RLS ─────────────────────────────────────────────────────
alter table merchants enable row level security;
alter table product_categories enable row level security;
alter table products enable row level security;
alter table merchant_products enable row level security;
alter table regional_pricing enable row level security;
alter table price_audit enable row level security;

-- ─── TRIGGERS ────────────────────────────────────────────────
create trigger trg_merchants_updated before update on merchants for each row execute function update_updated_at();
create trigger trg_products_updated before update on products for each row execute function update_updated_at();
create trigger trg_mp_updated before update on merchant_products for each row execute function update_updated_at();
create trigger trg_regional_updated before update on regional_pricing for each row execute function update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Product Categories
-- ═══════════════════════════════════════════════════════════════

-- Level 0: Top categories
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order, icon) values
  ('a0000000-0000-0000-0000-000000000001', null, 'Roofing', 'roofing', 'roofing', 0, 1, '🏠'),
  ('a0000000-0000-0000-0000-000000000002', null, 'Exterior', 'exterior', 'exterior', 0, 2, '🏗️'),
  ('a0000000-0000-0000-0000-000000000003', null, 'Structural', 'structural', 'structural', 0, 3, '🪵'),
  ('a0000000-0000-0000-0000-000000000004', null, 'Fasteners & Adhesives', 'fasteners', 'fasteners', 0, 4, '🔩'),
  ('a0000000-0000-0000-0000-000000000005', null, 'Safety & Equipment', 'safety', 'safety', 0, 5, '🦺');

-- Level 1: Roofing subcategories
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Shingles', 'shingles', 'roofing/shingles', 1, 1),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Underlayment', 'underlayment', 'roofing/underlayment', 1, 2),
  ('a1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Ice & Water Shield', 'ice-water', 'roofing/ice-water', 1, 3),
  ('a1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Flashing', 'flashing', 'roofing/flashing', 1, 4),
  ('a1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Ridge & Hip', 'ridge-hip', 'roofing/ridge-hip', 1, 5),
  ('a1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Ventilation', 'ventilation', 'roofing/ventilation', 1, 6),
  ('a1000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Starter Strip', 'starter', 'roofing/starter', 1, 7),
  ('a1000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Drip Edge', 'drip-edge', 'roofing/drip-edge', 1, 8),
  ('a1000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Metal Panels', 'metal-panels', 'roofing/metal-panels', 1, 9),
  ('a1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Skylights', 'skylights', 'roofing/skylights', 1, 10);

-- Level 2: Shingle brands
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'CertainTeed', 'certainteed', 'roofing/shingles/certainteed', 2, 1),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'IKO / CRC', 'iko-crc', 'roofing/shingles/iko-crc', 2, 2),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'GAF', 'gaf', 'roofing/shingles/gaf', 2, 3),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'BP', 'bp', 'roofing/shingles/bp', 2, 4);

-- Level 1: Exterior subcategories
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000002', 'Soffit', 'soffit', 'exterior/soffit', 1, 1),
  ('a1000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000002', 'Fascia', 'fascia', 'exterior/fascia', 1, 2),
  ('a1000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000002', 'Gutters', 'gutters', 'exterior/gutters', 1, 3),
  ('a1000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000002', 'Siding', 'siding', 'exterior/siding', 1, 4),
  ('a1000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000002', 'Window & Door Capping', 'capping', 'exterior/capping', 1, 5);

-- Level 1: Structural subcategories
insert into product_categories (id, parent_id, name, slug, path, depth, sort_order) values
  ('a1000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000003', 'OSB / Plywood', 'osb-plywood', 'structural/osb-plywood', 1, 1),
  ('a1000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000003', 'Lumber', 'lumber', 'structural/lumber', 1, 2),
  ('a1000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000003', 'Housewrap', 'housewrap', 'structural/housewrap', 1, 3),
  ('a1000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000003', 'Insulation Board', 'insulation', 'structural/insulation', 1, 4);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Products (Plus Ultra's actual materials)
-- ═══════════════════════════════════════════════════════════════

-- CertainTeed Shingles
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'CertainTeed Landmark', 'CertainTeed', 'bundle', '3 bundles/SQ', '{"warranty_years": 30, "type": "architectural", "line": "Landmark"}'),
  ('b0000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'CertainTeed Landmark PRO', 'CertainTeed', 'bundle', '3 bundles/SQ', '{"warranty_years": 40, "type": "architectural", "line": "Landmark PRO"}'),
  ('b0000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'CertainTeed Presidential', 'CertainTeed', 'bundle', '4 bundles/SQ', '{"warranty_years": 50, "type": "luxury", "line": "Presidential"}');

-- CRC / IKO
insert into products (id, category_id, name, brand, unit, units_per_coverage, specs) values
  ('b0000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'CRC Cambridge (IKO)', 'IKO', 'bundle', '3 bundles/SQ', '{"warranty_years": 25, "type": "architectural", "line": "Cambridge", "note": "Sold as CRC through Birdstairs"}');

-- Underlayment
insert into products (id, category_id, name, brand, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000002', 'Synthetic Underlayment (Standard)', null, 'roll', '10 SQ/roll'),
  ('b0000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'Premium Synthetic Underlayment', null, 'roll', '10 SQ/roll');

-- Ice & Water
insert into products (id, category_id, name, brand, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000003', 'Standard Ice & Water Shield', null, 'roll', '2 SQ/roll'),
  ('b0000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-000000000003', 'Grace Ice & Water Shield', 'Grace', 'roll', '2 SQ/roll');

-- Flashing
insert into products (id, category_id, name, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000020', 'a1000000-0000-0000-0000-000000000004', 'Pipe Flashing', 'each', '1 per penetration'),
  ('b0000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000004', 'Step Flashing Bundle', 'bundle', '50 LF/bundle'),
  ('b0000000-0000-0000-0000-000000000022', 'a1000000-0000-0000-0000-000000000004', 'Metal Valley Sheet', 'sheet', '10 LF/sheet');

-- Ridge & Hip
insert into products (id, category_id, name, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000030', 'a1000000-0000-0000-0000-000000000005', 'Hip & Ridge Cap', 'bundle', '30 LF/bundle'),
  ('b0000000-0000-0000-0000-000000000031', 'a1000000-0000-0000-0000-000000000006', 'Ridge Vent (4ft)', 'each', null);

-- Starter, Drip Edge
insert into products (id, category_id, name, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000032', 'a1000000-0000-0000-0000-000000000007', 'Starter Strip', 'bundle', '120 LF/bundle'),
  ('b0000000-0000-0000-0000-000000000033', 'a1000000-0000-0000-0000-000000000008', 'Aluminum Drip Edge 3"', 'piece', '10 LF/piece');

-- Ventilation
insert into products (id, category_id, name, unit) values
  ('b0000000-0000-0000-0000-000000000034', 'a1000000-0000-0000-0000-000000000006', 'Maximum Vent (Roof Vent)', 'each'),
  ('b0000000-0000-0000-0000-000000000035', 'a1000000-0000-0000-0000-000000000006', 'Soffit Vent', 'each');

-- Fasteners
insert into products (id, category_id, name, unit, units_per_coverage) values
  ('b0000000-0000-0000-0000-000000000040', 'a0000000-0000-0000-0000-000000000004', 'Roofing Coil Nails', 'box', '~15 SQ/box'),
  ('b0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-000000000004', 'Roofing Caulking', 'tube', null);

-- Structural
insert into products (id, category_id, name, unit) values
  ('b0000000-0000-0000-0000-000000000050', 'a1000000-0000-0000-0000-000000000016', 'OSB Sheathing 7/16" 4x8', 'sheet'),
  ('b0000000-0000-0000-0000-000000000051', 'a1000000-0000-0000-0000-000000000016', 'Plywood Sheathing 1/2" 4x8', 'sheet');

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Merchants (Plus Ultra's suppliers)
-- ═══════════════════════════════════════════════════════════════

insert into merchants (id, tenant_id, name, slug, type, address, city, province, website) values
  ('c0000000-0000-0000-0000-000000000001',
   (select id from tenants where slug = 'plus-ultra'),
   'Kent Building Supplies — Riverview', 'kent-riverview', 'big_box',
   '477 Coverdale Rd', 'Riverview', 'NB', 'https://kent.ca'),

  ('c0000000-0000-0000-0000-000000000002',
   (select id from tenants where slug = 'plus-ultra'),
   'Home Depot — Moncton', 'home-depot-moncton', 'big_box',
   '55 Plaza Blvd', 'Moncton', 'NB', 'https://homedepot.ca'),

  ('c0000000-0000-0000-0000-000000000003',
   (select id from tenants where slug = 'plus-ultra'),
   'Birdstairs (IKO/CRC Distributor)', 'birdstairs', 'distributor',
   null, 'Moncton', 'NB', null),

  ('c0000000-0000-0000-0000-000000000004',
   (select id from tenants where slug = 'plus-ultra'),
   'Castle Building Centres', 'castle', 'retail',
   null, 'Moncton', 'NB', 'https://castle.ca');

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA — Merchant Products (Plus Ultra's known prices)
-- ═══════════════════════════════════════════════════════════════

-- Kent prices
insert into merchant_products (merchant_id, product_id, tenant_id, price, verified_by, update_notes) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   (select id from tenants where slug = 'plus-ultra'), 49.00, 'manual', 'CertainTeed Landmark — verified Apr 2026'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002',
   (select id from tenants where slug = 'plus-ultra'), 55.00, 'manual', 'CertainTeed Landmark PRO — verified Apr 2026'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003',
   (select id from tenants where slug = 'plus-ultra'), 90.00, 'manual', 'CertainTeed Presidential — verified Apr 2026'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000010',
   (select id from tenants where slug = 'plus-ultra'), 125.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011',
   (select id from tenants where slug = 'plus-ultra'), 167.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000012',
   (select id from tenants where slug = 'plus-ultra'), 116.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000013',
   (select id from tenants where slug = 'plus-ultra'), 178.00, 'manual', 'Grace I&W'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000032',
   (select id from tenants where slug = 'plus-ultra'), 52.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000030',
   (select id from tenants where slug = 'plus-ultra'), 55.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000033',
   (select id from tenants where slug = 'plus-ultra'), 17.99, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000020',
   (select id from tenants where slug = 'plus-ultra'), 20.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000021',
   (select id from tenants where slug = 'plus-ultra'), 100.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000022',
   (select id from tenants where slug = 'plus-ultra'), 32.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000031',
   (select id from tenants where slug = 'plus-ultra'), 125.00, 'manual', 'Ridge vent 4ft section'),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000040',
   (select id from tenants where slug = 'plus-ultra'), 57.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000041',
   (select id from tenants where slug = 'plus-ultra'), 12.00, 'manual', null),
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000050',
   (select id from tenants where slug = 'plus-ultra'), 20.00, 'manual', 'OSB 7/16 sheet');

-- Birdstairs CRC price
insert into merchant_products (merchant_id, product_id, tenant_id, price, verified_by, update_notes) values
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004',
   (select id from tenants where slug = 'plus-ultra'), 35.00, 'manual', 'CRC Cambridge — IKO via Birdstairs. Verified Mar 2026');
