-- ═══════════════════════════════════════════════════════════════
-- Migration 070 · companycam_archive_projects + companycam_archive_photos
--
-- Backing tables for the Archives folder in admin. Loads the manifest
-- + projects.json from the CompanyCam scrape so the 13,198-photo
-- archive is browsable from prod admin without needing the original
-- 9.4 GB to live in Vercel Blob. Thumbnail URLs come from CompanyCam's
-- public img CDN; if those expire later, a follow-up job can mass-upload
-- to Blob and update url_archived. Until then, url_source is the live URL.
--
-- Idempotent: safe to re-run. Import script upserts on (tenant_id,
-- companycam_project_id) and (tenant_id, companycam_photo_id).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS companycam_archive_projects (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  companycam_project_id    TEXT NOT NULL,
  name                     TEXT,
  status                   TEXT,
  archived                 BOOLEAN DEFAULT false,
  address                  TEXT,
  city                     TEXT,
  state                    TEXT,
  postal_code              TEXT,
  lat                      DOUBLE PRECISION,
  lng                      DOUBLE PRECISION,
  creator_name             TEXT,
  photo_count              INTEGER DEFAULT 0,
  cover_url                TEXT,
  project_url              TEXT,
  created_at_companycam    TIMESTAMPTZ,
  updated_at_companycam    TIMESTAMPTZ,
  imported_at              TIMESTAMPTZ DEFAULT now(),
  raw                      JSONB,
  UNIQUE (tenant_id, companycam_project_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_archive_projects_tenant_addr
  ON companycam_archive_projects (tenant_id, address);
CREATE INDEX IF NOT EXISTS idx_cc_archive_projects_tenant_name
  ON companycam_archive_projects (tenant_id, name);

CREATE TABLE IF NOT EXISTS companycam_archive_photos (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  archive_project_id       UUID NOT NULL REFERENCES companycam_archive_projects(id) ON DELETE CASCADE,
  companycam_photo_id      TEXT NOT NULL,
  filename                 TEXT,
  url_source               TEXT NOT NULL,
  url_archived             TEXT,
  bytes                    BIGINT,
  captured_at              TIMESTAMPTZ,
  creator_name             TEXT,
  lat                      DOUBLE PRECISION,
  lng                      DOUBLE PRECISION,
  caption                  TEXT,
  tags                     TEXT,
  local_path               TEXT,
  imported_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, companycam_photo_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_archive_photos_project
  ON companycam_archive_photos (archive_project_id);
CREATE INDEX IF NOT EXISTS idx_cc_archive_photos_tenant_captured
  ON companycam_archive_photos (tenant_id, captured_at DESC);
