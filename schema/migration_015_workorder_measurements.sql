-- Ryujin OS — Migration 015: Work Order Measurements
-- Adds edge LF columns to workorders so the crew-side material list
-- (production-materials.html) can compute quantities without needing a linked estimate.
-- Root cause: 95 Cornhill WO had no linked_estimate_id, so computeMaterials() fell back
-- to sqft-only and produced 4 sticks of drip edge + 1 roll of I&W for an 18.4 SQ job.

alter table workorders
  add column if not exists eaves_lf numeric(10,2) default 0,
  add column if not exists rakes_lf numeric(10,2) default 0,
  add column if not exists ridges_lf numeric(10,2) default 0,
  add column if not exists hips_lf numeric(10,2) default 0,
  add column if not exists valleys_lf numeric(10,2) default 0,
  add column if not exists walls_lf numeric(10,2) default 0,
  add column if not exists pipes int default 0,
  add column if not exists vents int default 0,
  add column if not exists chimneys int default 0,
  add column if not exists osb_sheets int default 0;
