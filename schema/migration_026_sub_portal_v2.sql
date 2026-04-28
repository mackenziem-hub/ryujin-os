-- Ryujin OS — Migration 026: Subcontractor Portal v2
--
-- Adds:
--   * portal_visibility flags on subcontractors (Mac toggles per sub)
--   * auto_approve_threshold_cad on subcontractors
--   * rate_suggestion + change_order entry types on job_log_entries
--   * rate_suggestion_* fields for suggested rate changes
--   * auto_approved_at audit field
--
-- Backward-compatible: all additive. Existing entries keep their entry_type,
-- existing rows get default visibility (everything visible).

-- ─── Per-sub portal visibility flags ────────────────────────────
alter table subcontractors
  add column if not exists portal_visibility jsonb default '{"show_pay":true,"show_materials":true,"show_photos":true,"show_full_scope":true,"show_schedule":true,"show_contingencies":true,"show_rates":true}'::jsonb;

-- ─── Per-sub auto-approval threshold ────────────────────────────
alter table subcontractors
  add column if not exists auto_approve_threshold_cad numeric default 250;

-- ─── New entry types: rate_suggestion + change_order ────────────
alter table job_log_entries
  drop constraint if exists job_log_entries_entry_type_check;
alter table job_log_entries
  add constraint job_log_entries_entry_type_check
    check (entry_type in (
      'material_purchase',
      'scope_change',
      'additional_fee',
      'advance_payout',
      'note',
      'rate_suggestion',
      'change_order'
    ));

-- ─── Rate suggestion fields (only used when entry_type='rate_suggestion') ──
alter table job_log_entries
  add column if not exists rate_suggestion_item text,
  add column if not exists rate_suggestion_current numeric,
  add column if not exists rate_suggestion_proposed numeric;

-- ─── Auto-approval audit trail ──────────────────────────────────
alter table job_log_entries
  add column if not exists auto_approved_at timestamptz;

-- ─── Backfill: ensure Atlantic Roofing has explicit visibility ──
update subcontractors
   set portal_visibility = '{"show_pay":true,"show_materials":true,"show_photos":true,"show_full_scope":true,"show_schedule":true,"show_contingencies":true,"show_rates":true}'::jsonb
 where portal_visibility is null
    or portal_visibility = '{}'::jsonb;

update subcontractors
   set auto_approve_threshold_cad = 250
 where auto_approve_threshold_cad is null;
