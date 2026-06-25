// Ryujin OS — Cross-machine context store (Claude Code session brain + durable memory)
//
// GET  /api/context-store?kind=session&limit=N&since=ISO   — recent session_entries (newest first)
// GET  /api/context-store?kind=principles                  — active context_principles
// POST /api/context-store?kind=session    {entry_key,machine,terminal,title,body}      — upsert one session row
// POST /api/context-store?kind=principle  {slug,kind,title,body,source_machine}        — upsert one principle row
// POST /api/context-store?kind=principle&deactivate=1 {slug}                            — soft-delete (is_active=false)
//
// Every write is ONE supabaseAdmin record op — the classifier-permitted per-record
// path, NOT a bulk RLS-bypass PATCH/DELETE. Gated by requirePortalSessionAndTenant,
// so scripts/context-push.mjs authenticates with RYUJIN_SERVICE_TOKEN + x-tenant-id
// (resolveSession returns a synthetic admin scoped to that tenant).
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;
  const kind = (req.query.kind || '').toString();

  // ── GET ──
  if (req.method === 'GET') {
    if (kind === 'session') {
      const limit = Math.min(parseInt(req.query.limit) || 25, 200);
      let query = supabaseAdmin
        .from('session_entries')
        .select('entry_key, machine, terminal, title, body, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (req.query.since) query = query.gte('created_at', req.query.since);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ entries: data || [] });
    }

    if (kind === 'principles') {
      const { data, error } = await supabaseAdmin
        .from('context_principles')
        .select('slug, kind, title, body, source_machine, updated_at')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ principles: data || [] });
    }

    return res.status(400).json({ error: 'kind must be session|principles' });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // Session handoff entry (append; upsert-by-entry_key makes a retry idempotent)
    if (kind === 'session') {
      if (!body.entry_key || !body.body) {
        return res.status(400).json({ error: 'entry_key and body required' });
      }
      const { data, error } = await supabaseAdmin
        .from('session_entries')
        .upsert({
          tenant_id: tenantId,
          entry_key: body.entry_key,
          machine: body.machine || 'unknown',
          terminal: body.terminal || null,
          title: body.title || null,
          body: body.body,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,entry_key' })
        .select('id, entry_key')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    // Durable principle (upsert-by-slug, or soft-delete)
    if (kind === 'principle') {
      if (!body.slug) return res.status(400).json({ error: 'slug required' });

      if (req.query.deactivate) {
        const { data, error } = await supabaseAdmin
          .from('context_principles')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('slug', body.slug)
          .select('slug, is_active')
          .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
      }

      if (!body.body) return res.status(400).json({ error: 'body required' });
      const { data, error } = await supabaseAdmin
        .from('context_principles')
        .upsert({
          tenant_id: tenantId,
          slug: body.slug,
          kind: body.kind || 'reference',
          title: body.title || null,
          body: body.body,
          source_machine: body.source_machine || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,slug' })
        .select('slug, kind')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json(data);
    }

    return res.status(400).json({ error: 'kind must be session|principle' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
