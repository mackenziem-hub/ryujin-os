-- ═══════════════════════════════════════════════════════════════
-- Migration 099: crm_interactions — the persistent interaction archive
--
-- The Customer 360 (api/customer-360.js) assembles each customer's interaction
-- timeline LIVE from GoHighLevel, which is always fresh and needs no table. This
-- table is the OPTIONAL owned archive: a future crm-sync cron writes every
-- captured interaction here so we (a) own the history independent of GHL, (b) can
-- capture what GHL does not surface well (form-submission detail, SMS delivery
-- status), and (c) can query/analyze across customers. The 360 read path does NOT
-- depend on this table; it is additive.
--
-- Applied by hand via the Supabase Management API (needs SUPABASE_PAT, which was
-- missing on the build machine — staged 2026-06-20, pending apply). Idempotent.
-- Apply: node --env-file=.env.local scripts/apply-migration.mjs schema/migration_099_crm_interactions.sql
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS crm_interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  ghl_contact_id  text,
  customer_id     uuid,
  kind            text NOT NULL,        -- message | note | call | appointment | stage_change | form_submission
  channel         text,                 -- sms | email | facebook | instagram | whatsapp | webchat | gmb (for kind=message)
  direction       text,                 -- inbound | outbound (for kind=message)
  body            text,
  occurred_at     timestamptz,
  source          text NOT NULL DEFAULT 'ghl',
  external_id     text,                 -- the source-system id (message id, note id, ...) for idempotency
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: the crm-sync cron upserts on (tenant_id, source, external_id) so
-- re-running never duplicates a captured interaction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_interactions_ext
  ON crm_interactions (tenant_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Per-customer timeline reads, newest first.
CREATE INDEX IF NOT EXISTS idx_crm_interactions_contact
  ON crm_interactions (tenant_id, ghl_contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_interactions_customer
  ON crm_interactions (tenant_id, customer_id, occurred_at DESC);

COMMENT ON TABLE crm_interactions IS
  'Optional owned archive of customer interactions (the live Customer 360 reads from GHL directly; a future crm-sync cron populates this for ownership + analytics + capturing what GHL drops). Idempotent upsert on (tenant_id, source, external_id).';
