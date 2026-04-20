-- ═══════════════════════════════════════════════════════════════
-- RYUJIN OS — Migration 012: Crew checklist sync
-- Adds checklist_state JSONB to tickets so crew app checklists
-- persist to DB + sync across devices (was localStorage-only).
-- Shape: { [itemId]: { done: bool, photoUrl: string, updatedAt: iso } }
-- ═══════════════════════════════════════════════════════════════

alter table tickets add column if not exists checklist_state jsonb default '{}'::jsonb;
