-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 007: Tenant Settings
-- Makes everything configurable per tenant — labor rates, tax,
-- overhead, crew capacity, branding, multipliers, margins
-- ═══════════════════════════════════════════════════════════════

create table tenant_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade not null unique,

  -- ─── Tax & Region ──────────────────────────────────────────
  tax_rate numeric(5,4) default 0.15,        -- HST 15% NB default
  tax_label text default 'HST',              -- 'HST', 'GST+PST', 'GST'
  currency text default 'CAD',
  province text default 'NB',
  country text default 'CA',

  -- ─── Overhead & Crew ──────────────────────────────────────
  daily_overhead numeric(10,2) default 90,   -- per-day job cost (fuel, insurance, etc.)
  crew_sq_per_day numeric(5,1) default 12,   -- roofing: SQ installed per crew per day
  crew_exterior_sqft_per_day numeric(7,1) default 500, -- exterior: sqft per crew per day
  default_crew_size int default 4,

  -- ─── Rounding ─────────────────────────────────────────────
  price_rounding int default 25,             -- round selling price to nearest $X

  -- ─── Labor Rates — Roofing ────────────────────────────────
  -- JSON so it's fully flexible without schema changes
  labor_rates_roofing jsonb default '{
    "asphalt": {"low": 130, "moderate": 160, "steep": 190},
    "metal": {"low": 250, "moderate": 300, "steep": 350},
    "flat": {"low": 100, "moderate": 130, "steep": 160},
    "extra_layer": 40,
    "cedar_tearoff": 70,
    "redecking": 30,
    "valley_install": 1.50,
    "ridge_vent_install": 2.00,
    "pipe_flashing": 20,
    "small_chimney_flashing": 125,
    "large_chimney_flashing": 350,
    "cricket_construction": 150,
    "max_vent_install": 50
  }',

  -- ─── Labor Rates — Exterior ───────────────────────────────
  labor_rates_exterior jsonb default '{
    "strip_existing": 1.50,
    "sheathing_inspection": 0.25,
    "housewrap_install": 0.15,
    "eps_foam_install": 0.40,
    "ventigrid_install": 0.20,
    "osb_substrate": 30,
    "soffit": {"low": 30, "mid": 35, "high": 40},
    "fascia": {"low": 20, "mid": 25, "high": 30},
    "gutter": {"low": 22, "mid": 26, "high": 30},
    "leaf_guard": 6,
    "siding_install": {
      "vinyl": {"low": 4, "mid": 5, "high": 6},
      "fiber_cement": {"low": 6, "mid": 8, "high": 10},
      "steel": {"low": 5, "mid": 7, "high": 9},
      "aluminum": {"low": 6, "mid": 8.50, "high": 11}
    },
    "window_capping": 75,
    "door_capping": 100,
    "window_install": {"small": 200, "medium": 250, "large": 350}
  }',

  -- ─── Distance & Disposal ──────────────────────────────────
  distance_tiers jsonb default '{
    "local_max_km": 20,
    "day_trip_max_km": 60,
    "adders": {"local": 0, "day_trip": 20, "extended": 40},
    "disposal": {"local": 350, "day_trip": 450, "extended": 550}
  }',

  -- ─── Multipliers (default per system — offers override) ───
  default_multipliers jsonb default '{
    "residential": {
      "local": {"economy": 1.40, "gold": 1.47, "platinum": 1.52, "diamond": 1.58},
      "dayTrip": {"economy": 1.55, "gold": 1.62, "platinum": 1.67, "diamond": 1.74},
      "extendedStay": {"economy": 1.18, "gold": 1.22, "platinum": 1.27, "diamond": 1.33}
    },
    "commercial": {
      "local": {"economy": 1.35, "standard": 1.42, "premium": 1.50},
      "dayTrip": {"economy": 1.48, "standard": 1.55, "premium": 1.65},
      "extendedStay": {"economy": 1.15, "standard": 1.20, "premium": 1.28}
    },
    "exterior": {
      "local": 1.47,
      "dayTrip": 1.62,
      "extendedStay": 1.22
    }
  }',

  -- ─── Margin Floors ────────────────────────────────────────
  margin_floors jsonb default '{
    "economy": 8,
    "gold": 10,
    "platinum": 15,
    "diamond": 20,
    "commercial_economy": 8,
    "commercial_standard": 12,
    "commercial_premium": 18,
    "exterior": 15
  }',

  -- ─── Warranty Defaults ────────────────────────────────────
  warranty_adders jsonb default '{
    "economy": {"years": 10, "adder_per_sq": 0},
    "gold": {"years": 15, "adder_per_sq": 0},
    "platinum": {"years": 20, "adder_per_sq": 25},
    "diamond": {"years": 25, "adder_per_sq": 50}
  }',

  -- ─── Remediation Tiers ────────────────────────────────────
  remediation_tiers jsonb default '[
    {"max_hard_cost": 20000, "allowance": 1500},
    {"max_hard_cost": 35000, "allowance": 2000},
    {"max_hard_cost": 50000, "allowance": 2500},
    {"max_hard_cost": 80000, "allowance": 3500},
    {"max_hard_cost": null, "allowance": 5000}
  ]',

  -- ─── Mobilization / Discount Rules ────────────────────────
  mobilization_rules jsonb default '{
    "enabled": true,
    "discount_label": "Already-On-Site Savings",
    "tiers": [
      {"add_on_min": 2000, "add_on_max": 5000, "discount_pct": 5, "note": "Small add-on while crew is mobilized"},
      {"add_on_min": 5000, "add_on_max": 15000, "discount_pct": 8, "note": "Mid-size add-on — significant mobilization savings"},
      {"add_on_min": 15000, "add_on_max": null, "discount_pct": 10, "note": "Major add-on — full mobilization discount"}
    ],
    "framing": "While we are already here with the crew and equipment on-site, we can offer you significant savings on additional work."
  }',

  -- ─── Branding ─────────────────────────────────────────────
  company_name text,
  company_phone text,
  company_email text,
  company_website text,
  logo_url text,
  accent_color text default '#FF6B00',       -- brand color for proposals/sales pages
  tagline text,

  -- ─── Proposal Defaults ────────────────────────────────────
  proposal_header text,                      -- "Your Roof. Your Way."
  proposal_footer text,                      -- warranty info, fine print
  include_sales_page boolean default true,   -- generate visual sales page by default
  include_material_list boolean default false,-- internal only by default

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger trg_tenant_settings_updated before update on tenant_settings
  for each row execute function update_updated_at();

alter table tenant_settings enable row level security;

-- ═══════════════════════════════════════════════════════════════
-- SEED — Plus Ultra Roofing settings
-- ═══════════════════════════════════════════════════════════════

insert into tenant_settings (
  tenant_id, tax_rate, tax_label, province, country,
  daily_overhead, crew_sq_per_day, default_crew_size,
  company_name, company_phone, company_email, company_website,
  accent_color, tagline, proposal_header
)
select t.id,
  0.15, 'HST', 'NB', 'CA',
  90, 12, 4,
  'Plus Ultra Roofing', '(506) 540-1052', 'plusultraroofing@gmail.com', 'https://plusultraroofing.com',
  '#FF6B00', 'Go Beyond.', 'Your Roof. Your Way.'
from tenants t where t.slug = 'plus-ultra';
