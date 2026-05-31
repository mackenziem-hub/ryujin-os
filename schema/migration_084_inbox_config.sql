-- Ryujin OS — Migration 084: Inbox config column
-- Adds tenant_settings.inbox_config (jsonb) for the inbox agent's owner-tunable
-- settings. First use: a NOTIFY allow-list of watched contacts whose inbound
-- ALWAYS fires the owner SMS, layered ON TOP of the leak/lead triage gate
-- (never downgrades a notify). Built for "I'm waiting to hear back from a
-- vendor on pricing, ping me when they reply" without re-tuning the prompt.
--
-- Mirrors the *_config column convention (migration_044/045/046/048/049).
--
-- Shape:
--   { "notify_allowlist": [ { "match": "jessica", "note": "pricing" }, ... ] }
--     match: case-insensitive WHOLE-WORD token tested against the GHL contact
--            name (the agent uses a \b...\b regex so "ben" hits "Ben Carter"
--            but not "Bensen Roofing").
--     note:  optional label surfaced in the SMS reason line.
-- Entries may also be bare strings (treated as { match: "<string>" }).
--
-- Additive only. Re-runnable without error.

alter table tenant_settings
  add column if not exists inbox_config jsonb not null default '{}'::jsonb;
