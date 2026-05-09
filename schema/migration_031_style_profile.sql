-- Phase 8: Style profile (team profiles + style learning)
-- Per-user accumulated style profile that the AI uses to adapt communication patterns.
-- Schema: { length_pref, vocab_signals, formality, decision_style, recurring_asks, last_updated, source_count }
--   length_pref: 'brief' | 'detailed' | 'mixed'
--   formality: 'casual' | 'professional' | 'mixed'
--   decision_style: 'fast' | 'deliberative' | 'mixed'
--   vocab_signals: array of phrases the user uses repeatedly
--   recurring_asks: array of topics they bring up often
--   last_updated: ISO timestamp
--   source_count: number of conversations the profile is built from
-- Populated initially by manual entry or first /onboard interview, refreshed nightly via Haiku summarization (Phase 8.5).

alter table users add column if not exists style_profile jsonb default '{}'::jsonb;

comment on column users.style_profile is 'Per-user accumulated communication style profile. Layered into system prompt at chat assembly. Built from /onboard interview + nightly Haiku summarization of recent conversations.';
