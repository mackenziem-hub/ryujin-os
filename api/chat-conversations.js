// Ryujin OS — Chat Conversations CRUD
//
// GET    /api/chat-conversations            list newest 50, no messages payload (lightweight)
// GET    /api/chat-conversations?id=X       full conversation including messages array
// POST   /api/chat-conversations            upsert: { id?, title?, messages } — id given → update, else create
// DELETE /api/chat-conversations?id=X       hard delete
//
// Tenant-scoped via requireTenant middleware. Until migration_021 is applied
// the queries 500 — that's expected; the sidebar UI gates on response.ok.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id } = req.query || {};

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('chat_conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();
      if (error) return res.status(404).json({ error: 'Conversation not found' });
      return res.json(data);
    }

    // List view — lightweight, no messages payload
    const { data, error } = await supabaseAdmin
      .from('chat_conversations')
      .select('id, title, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ conversations: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { id, title, messages } = body;
    const safeMessages = Array.isArray(messages) ? messages : [];

    if (id) {
      // Update existing — must belong to this tenant
      const updates = { messages: safeMessages, updated_at: new Date().toISOString() };
      if (title !== undefined && title !== null) updates.title = String(title).slice(0, 200);

      const { data, error } = await supabaseAdmin
        .from('chat_conversations')
        .update(updates)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Create new
    const insert = {
      tenant_id: tenantId,
      title: title ? String(title).slice(0, 200) : null,
      messages: safeMessages,
    };
    const { data, error } = await supabaseAdmin
      .from('chat_conversations')
      .insert(insert)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await supabaseAdmin
      .from('chat_conversations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
