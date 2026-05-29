-- migration_076_team_coverage.sql
-- Adds a jsonb store for the Roles & Coverage tool (admin pillar).
-- Holds the team roster with primary/secondary objectives + per-function
-- coverage roles (primary/backup), driving the Matrix / Map / Simulator views.
-- Owner-tunable in-UI; persisted per tenant. No new table — rides tenant_settings
-- like other configurable per-tenant values (migration 007 philosophy).
-- Read via GET /api/settings; written via PUT /api/settings { team_coverage: {...} }.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS team_coverage jsonb;

COMMENT ON COLUMN tenant_settings.team_coverage IS
  'Roles & Coverage config: { functions:[], people:[{id,name,nick,title,pillar,primaryObjective,secondaryObjective,external,roles:{<function>:primary|backup}}], updatedAt }';
