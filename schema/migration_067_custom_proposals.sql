-- ═══════════════════════════════════════════════════════════════
-- Migration 067 · custom_proposals
--
-- Backing table for the Custom Scope Proposal Generator.
-- Replaces the hand-edited public/proposals/custom/index.json + per-slug
-- static HTML model with a DB row + a single dynamic renderer page.
--
-- Flow:
--   1. Admin opens /custom-proposal-new.html, fills the form
--   2. POST /api/custom-proposals inserts a row, returns the slug
--   3. Public renderer at /proposals/custom/<slug> (rewritten to
--      /custom-proposal.html?slug=X) reads the row and renders the
--      proposal HTML client-side from the same format template
--   4. Customer clicks Accept → POST /api/custom-proposal-accept
--      looks up by slug, fires gmailSend, flips status to 'signed'
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS custom_proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  slug              TEXT UNIQUE NOT NULL,
  quote_id          TEXT NOT NULL,

  -- Customer
  customer_name     TEXT NOT NULL,
  customer_email    TEXT,
  customer_phone    TEXT,
  address           TEXT NOT NULL,
  ghl_contact_id    TEXT,

  -- Sales rep
  sales_rep         TEXT NOT NULL DEFAULT 'Mackenzie Mazerolle',
  sales_rep_phone   TEXT NOT NULL DEFAULT '(506) 616-4607',
  sales_rep_email   TEXT NOT NULL DEFAULT 'mackenzie.m@plusultraroofing.com',

  -- Scope
  scope_title       TEXT NOT NULL DEFAULT 'Custom Partial Reroof',
  scope_long        TEXT,
  scope_grid        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- scope_grid shape: [{ "label": "Main section (front)", "value": "32 ft x 18 ft hip" }, ...]

  deliverables      JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- deliverables shape: ["Full tear-off ...", "CertainTeed Landmark ...", ...]

  exclusions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- exclusions shape: ["Additional shingle layers ...", "Work on roof sections ..."]

  -- Re-decking risk notice
  redecking_risk           BOOLEAN NOT NULL DEFAULT false,
  redecking_sheet_price    NUMERIC(10,2) NOT NULL DEFAULT 85.00,
  redecking_notice_text    TEXT,
  -- when null, renderer falls back to default text about home age + pitch + transparent pricing

  -- Pricing (CAD pre-HST)
  subtotal          NUMERIC(10,2) NOT NULL,
  hst_pct           NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  hst_amount        NUMERIC(10,2) NOT NULL,
  total_incl_hst    NUMERIC(10,2) NOT NULL,
  deposit_pct       NUMERIC(5,2) NOT NULL DEFAULT 30.00,
  deposit           NUMERIC(10,2) NOT NULL,
  balance           NUMERIC(10,2) NOT NULL,

  -- Warranty
  warranty_years    INTEGER NOT NULL DEFAULT 15,
  warranty_text     TEXT,

  -- Assets
  cover_url         TEXT,
  -- absolute path or full URL to cover image (used by renderer hero strip)

  -- Lifecycle
  issued_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_days        INTEGER NOT NULL DEFAULT 30,
  status            TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','sent','signed','expired','archived')),

  -- Acceptance
  accepted_by       TEXT,
  accepted_at       TIMESTAMPTZ,
  accepted_payload  JSONB,

  -- Audit
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_proposals_tenant_id ON custom_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_proposals_status    ON custom_proposals(status);
CREATE INDEX IF NOT EXISTS idx_custom_proposals_ghl       ON custom_proposals(ghl_contact_id) WHERE ghl_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_proposals_issued    ON custom_proposals(issued_date DESC);

-- Seed: Rick Schella / 330 Cameron St (already live as static HTML; mirror into DB so
-- the dynamic listing on the admin page picks it up + the new Accept endpoint can
-- look it up by slug from the same table).
INSERT INTO custom_proposals (
  tenant_id, slug, quote_id,
  customer_name, customer_phone, address, ghl_contact_id,
  scope_title, scope_long, scope_grid,
  deliverables, exclusions,
  redecking_risk, redecking_sheet_price,
  subtotal, hst_amount, total_incl_hst, deposit, balance,
  warranty_years,
  cover_url,
  issued_date, valid_days,
  status
)
SELECT
  (SELECT id FROM tenants WHERE slug = 'plus-ultra' LIMIT 1),
  '330-cameron-rick-schella',
  'PU-2026-RS330',
  'Rick Schella',
  '+1 506-856-7070',
  '330 Cameron St, Moncton, NB',
  'AM32cJqDlLmAYY711xzX',
  'Custom Partial Reroof',
  'Complete tear-off and reroof of the front main hip section and both dormers as detailed below. All workmanship to current building code and CertainTeed installation standards.',
  '[
    {"label":"Main section (front)","value":"32 ft x 18 ft hip"},
    {"label":"Roof pitch","value":"8/12"},
    {"label":"Dormer 1 (rake-style)","value":"10 ft x 8 ft"},
    {"label":"Dormer 2 (two pigeon brows)","value":"10 ft x 8 ft"},
    {"label":"Ridges","value":"24 LF"},
    {"label":"Hips","value":"50 LF"},
    {"label":"Rakes","value":"30 LF"},
    {"label":"Eaves","value":"33 LF"},
    {"label":"Total measured roof area","value":"~8.85 SQ (885 sq ft)"},
    {"label":"Waste allowance","value":"20% (complex)"}
  ]'::jsonb,
  '[
    "Full tear-off of existing shingles down to deck (1 layer assumed)",
    "CertainTeed Landmark architectural shingles, customer''s choice of color",
    "Synthetic underlayment over entire roof field",
    "Ice & water shield along all 33 LF of eaves",
    "Aluminum drip edge along all rakes and eaves",
    "Hip & ridge cap shingles (50 LF hips + 24 LF ridges)",
    "Continuous ridge vent on 24 LF main ridge",
    "Full step + counter flashing at both dormers",
    "Pigeon brow flashing detail on second dormer (2 brows)",
    "Pipe flashings (up to 2 standard penetrations)",
    "Job-site cleanup with magnetic nail sweep",
    "Full disposal of tear-off debris",
    "15-year manufacturer + workmanship warranty"
  ]'::jsonb,
  '[
    "Additional shingle layers beyond the first (+$40/SQ per added layer)",
    "Work on roof sections outside the front hip + two dormers described above"
  ]'::jsonb,
  true,
  85.00,
  7500.00, 1125.00, 8625.00, 2587.50, 6037.50,
  15,
  '/proposals/custom/330-cameron-rick-schella/cover.png',
  '2026-05-18', 30,
  'draft'
WHERE EXISTS (SELECT 1 FROM tenants WHERE slug = 'plus-ultra')
  AND NOT EXISTS (SELECT 1 FROM custom_proposals WHERE slug = '330-cameron-rick-schella');
