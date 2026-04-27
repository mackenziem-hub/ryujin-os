-- Migration 021 — Chat conversations (ChatGPT-style sidebar)
--
-- Persists the Ryujin chat thread per tenant so the slide-in sidebar can
-- list past conversations and resume them. Each row holds the full message
-- log as a JSONB array — same shape the chat widget already streams.
--
-- Format of `messages`: [{ role: 'user'|'assistant', content: '...', ts?: number }, ...]
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID,
  title TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_tenant_updated
  ON chat_conversations(tenant_id, updated_at DESC);

COMMENT ON TABLE chat_conversations IS
  'Ryujin chat history per tenant. Sidebar reads from here, chat.js auto-saves on each assistant turn. Title is auto-generated from the first user message via Claude Haiku.';
