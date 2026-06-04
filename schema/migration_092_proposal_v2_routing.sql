-- ═══════════════════════════════════════════════════════════════
-- Migration 092 · v2 proposal routing + frozen snapshot
--
-- Two additive columns that turn the v2 renderer from "explicit-URL only" into
-- a real, routed default:
--   1. tenant_settings.proposal_v2_enabled - when true, the legacy proposal
--      endpoint (api/proposal.js) redirects a customer to the v2 proposal IF a
--      sent v2 instance exists for their estimate. OFF by default; legacy
--      proposals are untouched until a tenant opts in.
--   2. proposal_instances.data_snapshot - the COMPLETE frozen ProposalData the
--      materializer (api/proposal-materialize.js) persists at send time.
--      api/proposal-v2.js serves it verbatim, so a sent proposal never changes
--      even if blocks/templates/pricing change later (no-edits-to-sent).
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS proposal_v2_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE proposal_instances
  ADD COLUMN IF NOT EXISTS data_snapshot JSONB;
