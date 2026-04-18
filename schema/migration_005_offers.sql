-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 005: Offers & Scope Templates
-- Named packages with configurable scope, defaults, and pricing rules
-- ═══════════════════════════════════════════════════════════════

-- ─── OFFERS ──────────────────────────────────────────────────
-- Named packages/products a tenant sells. Each has a scope template.
-- e.g., "Gold Package", "Performance Shell Plus", "CRC Economy"
create table offers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null,
  name text not null,                     -- 'Gold Package', 'Performance Shell Plus'
  slug text not null,
  description text,                       -- client-facing description
  system text not null check (system in ('asphalt', 'metal', 'exterior', 'combined')),

  -- Scope template — defines which line items are included and their defaults
  -- Each line item: { key, label, category, product_id, default_config, required }
  scope_template jsonb not null default '[]',

  -- Pricing rules
  pricing_method text default 'multiplier' check (pricing_method in ('multiplier', 'divisor', 'fixed', 'cost_plus')),
  multipliers jsonb default '{}',         -- { local: 1.47, dayTrip: 1.62, extendedStay: 1.22 }
  margin_floor numeric(5,2),              -- minimum margin %
  warranty_years int,
  warranty_adder_per_sq numeric(10,2) default 0,

  -- Display
  badge text,                             -- 'Most Popular', 'Best Value', 'Premium'
  sort_order int default 0,
  is_default boolean default false,       -- pre-selected in UI
  active boolean default true,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(tenant_id, slug)
);

create index idx_offers_tenant on offers(tenant_id, system);

-- ─── QUOTE LINE ITEMS ────────────────────────────────────────
-- Actual resolved line items for a specific estimate/quote.
-- Each line traces back to its price source.
create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid references estimates(id) on delete cascade not null,
  tenant_id uuid references tenants(id) on delete cascade not null,
  offer_id uuid references offers(id),

  -- Item identity
  item_key text not null,                 -- 'shingles', 'underlayment', 'soffit_removal', etc.
  category text not null,                 -- 'materials', 'labor', 'disposal', 'overhead', 'warranty'
  label text not null,                    -- Human-readable: 'CertainTeed Landmark @ $49/bundle'

  -- Configuration (sub-options the user chose)
  config jsonb default '{}',              -- { material: 'vinyl', type: 'vented', removal: 'strip_wood' }

  -- Quantity & pricing
  quantity numeric(10,2) not null,
  unit text not null,                     -- 'bundle', 'SQ', 'LF', 'each', 'sheet'
  unit_cost numeric(10,2) not null,       -- cost per unit
  total_cost numeric(10,2) not null,      -- quantity * unit_cost

  -- Price source tracking
  price_source text default 'default' check (price_source in (
    'override', 'merchant', 'regional', 'fallback', 'default', 'calculated'
  )),
  source_merchant_id uuid references merchants(id),
  source_product_id uuid references products(id),
  source_detail text,                     -- 'Kent Riverview @ $49/bundle'

  -- Override
  is_override boolean default false,      -- user manually set this price
  original_cost numeric(10,2),            -- what it was before override

  -- Included/excluded
  included boolean default true,          -- false = excluded from total but shown as option
  sort_order int default 0,
  notes text,

  created_at timestamptz default now()
);

create index idx_qli_estimate on quote_line_items(estimate_id);
create index idx_qli_offer on quote_line_items(offer_id);

-- ─── RLS ─────────────────────────────────────────────────────
alter table offers enable row level security;
alter table quote_line_items enable row level security;

create trigger trg_offers_updated before update on offers for each row execute function update_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- SEED — Plus Ultra Offers
-- ═══════════════════════════════════════════════════════════════

-- Economy (CRC)
insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, scope_template)
select t.id,
  'Economy', 'economy',
  'Quality roofing at a competitive price. IKO Cambridge shingles with standard underlayment & ice shield.',
  'asphalt', 'multiplier',
  '{"local": 1.40, "dayTrip": 1.55, "extendedStay": 1.18}',
  8, 10, 0, 'Best Value', 0,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000004","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true,"config":{"action":"replace"}},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"rate_by_pitch":true}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true,"config":{"per_layer":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Gold
insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, warranty_adder_per_sq, sort_order, scope_template)
select t.id,
  'Gold', 'gold',
  'CertainTeed Landmark architectural shingles. Synthetic underlayment & standard ice shield. 15-year workmanship warranty.',
  'asphalt', 'multiplier',
  '{"local": 1.47, "dayTrip": 1.62, "extendedStay": 1.22}',
  10, 15, 0, 1,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000001","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000010","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000012","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true,"config":{"action":"replace"}},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"rate_by_pitch":true}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true,"config":{"per_layer":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Platinum
insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, scope_template)
select t.id,
  'Platinum', 'platinum',
  'CertainTeed Landmark PRO with premium synthetic underlayment & Grace ice shield. Metal valleys. 20-year workmanship warranty.',
  'asphalt', 'multiplier',
  '{"local": 1.52, "dayTrip": 1.67, "extendedStay": 1.27}',
  15, 20, 25, 'Most Popular', 2,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000002","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true,"config":{"action":"replace"}},
    {"key":"valley_metal","label":"Metal Valley Sheets","category":"materials","product_id":"b0000000-0000-0000-0000-000000000022","required":false},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"rate_by_pitch":true}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true,"config":{"per_layer":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Diamond
insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, warranty_adder_per_sq, badge, sort_order, scope_template)
select t.id,
  'Diamond', 'diamond',
  'CertainTeed Presidential luxury shingles (4 bundles/SQ). Premium underlayment & Grace ice shield. 25-year workmanship warranty.',
  'asphalt', 'multiplier',
  '{"local": 1.58, "dayTrip": 1.74, "extendedStay": 1.33}',
  20, 25, 50, 'Premium', 3,
  '[
    {"key":"shingles","label":"Shingles","category":"materials","product_id":"b0000000-0000-0000-0000-000000000003","required":true},
    {"key":"underlayment","label":"Underlayment","category":"materials","product_id":"b0000000-0000-0000-0000-000000000011","required":true},
    {"key":"ice_water","label":"Ice & Water Shield","category":"materials","product_id":"b0000000-0000-0000-0000-000000000013","required":true},
    {"key":"starter","label":"Starter Strip","category":"materials","product_id":"b0000000-0000-0000-0000-000000000032","required":true},
    {"key":"ridge_cap","label":"Hip & Ridge Cap","category":"materials","product_id":"b0000000-0000-0000-0000-000000000030","required":true},
    {"key":"drip_edge","label":"Drip Edge","category":"materials","product_id":"b0000000-0000-0000-0000-000000000033","required":true,"config":{"action":"replace"}},
    {"key":"valley_metal","label":"Metal Valley Sheets","category":"materials","product_id":"b0000000-0000-0000-0000-000000000022","required":false},
    {"key":"pipe_flashing","label":"Pipe Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000020","required":false},
    {"key":"step_flashing","label":"Step Flashing","category":"materials","product_id":"b0000000-0000-0000-0000-000000000021","required":false},
    {"key":"ridge_vent","label":"Ridge Vent","category":"materials","product_id":"b0000000-0000-0000-0000-000000000031","required":true},
    {"key":"nails","label":"Coil Nails","category":"materials","product_id":"b0000000-0000-0000-0000-000000000040","required":true},
    {"key":"caulking","label":"Caulking","category":"materials","product_id":"b0000000-0000-0000-0000-000000000041","required":true},
    {"key":"base_labor","label":"Install Labor","category":"labor","required":true,"config":{"rate_by_pitch":true}},
    {"key":"tearoff_labor","label":"Tear-Off Labor","category":"labor","required":true,"config":{"per_layer":true}},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';

-- Performance Shell Plus
insert into offers (tenant_id, name, slug, description, system, pricing_method, multipliers, margin_floor, warranty_years, sort_order, scope_template)
select t.id,
  'Performance Shell Plus', 'performance-shell-plus',
  'Complete exterior renovation — siding, soffit, fascia, gutters. Includes OSB substrate & remediation allowance. Pairs with any roofing package.',
  'exterior', 'multiplier',
  '{"local": 1.47, "dayTrip": 1.62, "extendedStay": 1.22}',
  15, 10, 10,
  '[
    {"key":"siding","label":"Siding","category":"materials","required":true,"config":{"material":"vinyl","brand":"Gentec","removal":"strip_existing","housewrap":true}},
    {"key":"osb_substrate","label":"OSB Substrate","category":"materials","product_id":"b0000000-0000-0000-0000-000000000050","required":true,"config":{"note":"Mandatory for Performance Shell"}},
    {"key":"soffit","label":"Soffit","category":"materials","required":true,"config":{"material":"vinyl","type":"vented","removal":"strip_existing","backing":false}},
    {"key":"fascia","label":"Fascia","category":"materials","required":true,"config":{"material":"aluminum_cap","strip_existing":false,"new_backing":false}},
    {"key":"gutters","label":"Gutters","category":"materials","required":false,"config":{"type":"5k","material":"aluminum","leaf_guard":false,"remove_existing":true}},
    {"key":"window_capping","label":"Window & Door Capping","category":"materials","required":false,"config":{"type":"aluminum_wrap"}},
    {"key":"remediation","label":"Remediation Allowance","category":"materials","required":true,"config":{"note":"Mandatory — scales with project hard cost","auto_calculate":true}},
    {"key":"exterior_labor","label":"Exterior Install Labor","category":"labor","required":true},
    {"key":"disposal","label":"Disposal","category":"disposal","required":true}
  ]'::jsonb
from tenants t where t.slug = 'plus-ultra';
