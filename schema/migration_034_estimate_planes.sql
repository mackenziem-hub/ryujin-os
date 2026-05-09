-- Migration 034 — multi-pitch plane breakdown on estimates
-- Adds an optional planes JSONB column to capture per-section pitch/sqft pairs
-- for jobs where a single roof_pitch value can't represent reality (e.g. 5/12
-- main + 12/12 rakes). Quote engine v3 (lib/quoteEngineV3.js) reads this when
-- present and routes per-plane SQ through computeSubPaysheet so each section
-- gets the correct labor band rate.
--
-- Shape:
--   [
--     { "sqft": 960, "pitch": "5/12", "label": "Upper main" },
--     { "sqft": 80,  "pitch": "12/12", "label": "Front rake" }
--   ]
--
-- NULL = legacy single-pitch estimate (use roof_pitch + roof_area_sqft only).

alter table estimates
  add column if not exists planes jsonb;

comment on column estimates.planes is 'Optional multi-plane breakdown for mixed-pitch roofs. Array of {sqft, pitch, label?}. When set, the quote engine splits sub-paysheet labor per-plane at each plane''s pitch band rate. NULL = single-pitch estimate.';

-- Lightweight GIN index for ad-hoc queries ("how many estimates use multi-pitch")
create index if not exists idx_estimates_planes on estimates using gin (planes);
