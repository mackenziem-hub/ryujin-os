-- migration_036_claims_library.sql
-- Centralized trust-claim library. Replaces hardcoded claims scattered across
-- proposal-client.html, metalProposalCopy.js, marketing site, contract template.
-- Manus state-machine priority #3 (P0 — currently bleeding via live GL/WCB
-- claim on proposal page despite GL cancelled Feb 21 + WCB not in good standing).
--
-- Pattern: every customer-facing claim is a row. UI renders only rows where
-- status='active'. Status transitions are auditable. New claims default to
-- 'soft' until owner explicitly activates.

CREATE TABLE IF NOT EXISTS claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key             text NOT NULL,                  -- machine slug, e.g. 'gl_2m_liability'
  category        text NOT NULL,                  -- 'insurance' | 'warranty' | 'certification' | 'reviews' | 'workmanship' | 'documentation' | 'local'
  copy            text NOT NULL,                  -- canonical customer-facing phrasing
  status          text NOT NULL DEFAULT 'soft'    -- 'active' (use everywhere) | 'soft' (do not surface) | 'disabled' (explicitly retracted)
                  CHECK (status IN ('active', 'soft', 'disabled')),
  proof_source    text,                           -- where the truth lives: cert id, policy #, internal doc path
  notes           text,                           -- internal context (why soft/disabled, what unblocks)
  last_reviewed_at timestamptz,
  review_due_at   timestamptz,                    -- when to re-verify (e.g. policy renewal date)
  retracted_at    timestamptz,                    -- set when status flipped to 'disabled'
  retracted_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS claims_tenant_status_idx ON claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS claims_tenant_category_status_idx ON claims (tenant_id, category, status);

-- Audit trail for status changes — useful for compliance defensibility
-- ("this claim was active from X to Y, retracted Y to Z because reason R")
CREATE TABLE IF NOT EXISTS claims_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  prev_status  text,
  new_status   text NOT NULL,
  changed_by   uuid REFERENCES users(id),
  reason       text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS claims_audit_claim_idx ON claims_audit (claim_id, changed_at DESC);

-- Trigger: bump updated_at on row update
CREATE OR REPLACE FUNCTION claims_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claims_updated_at_trg ON claims;
CREATE TRIGGER claims_updated_at_trg
  BEFORE UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_set_updated_at();

-- Trigger: write audit row whenever status changes
CREATE OR REPLACE FUNCTION claims_audit_status_change() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO claims_audit (claim_id, tenant_id, prev_status, new_status, reason)
    VALUES (NEW.id, NEW.tenant_id, OLD.status, NEW.status, NEW.retracted_reason);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS claims_audit_status_trg ON claims;
CREATE TRIGGER claims_audit_status_trg
  AFTER UPDATE ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_audit_status_change();
