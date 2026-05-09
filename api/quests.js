// ═══════════════════════════════════════════════════════════════
// QUESTS — list/create/update/delete quests for the admin Quest Board.
//
// GET    /api/quests                — list, filterable
//        ?assigned_to=<user_id>     — filter to one user
//        ?status=open|completed|... — filter by status
//        ?category=sales|...        — filter by category
//        ?type=daily|campaign|optional
//        ?limit=N (default 100)
// POST   /api/quests                — create
//        body: { title, description?, category, type, xp_reward?, assigned_to?, due_at?, metadata? }
// PUT    /api/quests?id=<uuid>      — update (typically mark completed)
//        body: { status?, completed_at?, completed_by?, title?, description?, ... }
//        When status transitions to 'completed', xp_ledger row is written automatically.
// DELETE /api/quests?id=<uuid>      — delete
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { assigned_to, status, category, type, limit } = req.query;
    let q = supabaseAdmin
      .from('quests')
      .select('*')
      .eq('tenant_id', tenantId);
    if (assigned_to) q = q.eq('assigned_to', assigned_to);
    if (status) q = q.eq('status', status);
    if (category) q = q.eq('category', category);
    if (type) q = q.eq('type', type);
    q = q.order('created_at', { ascending: false }).limit(parseInt(limit) || 100);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ quests: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.title) return res.status(400).json({ error: 'title required' });
    if (!body.category) return res.status(400).json({ error: 'category required' });
    if (!body.type) return res.status(400).json({ error: 'type required' });
    const { data, error } = await supabaseAdmin
      .from('quests')
      .insert({
        tenant_id: tenantId,
        title: body.title,
        description: body.description || null,
        category: body.category,
        type: body.type,
        xp_reward: body.xp_reward ?? 10,
        assigned_to: body.assigned_to || null,
        due_at: body.due_at || null,
        metadata: body.metadata || {},
        created_by: body.created_by || null
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ quest: data });
  }

  if (req.method === 'PUT') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const body = req.body || {};

    // Fetch current state to detect status transition to 'completed'
    const cur = await supabaseAdmin
      .from('quests')
      .select('status, xp_reward, assigned_to')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (cur.error || !cur.data) return res.status(404).json({ error: 'quest not found' });

    const update = {};
    for (const k of ['status','completed_at','completed_by','title','description','xp_reward','assigned_to','due_at','metadata']) {
      if (body[k] !== undefined) update[k] = body[k];
    }
    if (update.status === 'completed' && !update.completed_at) update.completed_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('quests')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // Award XP on transition to completed (only if not already awarded)
    const becameCompleted = cur.data.status !== 'completed' && data.status === 'completed';
    if (becameCompleted && data.assigned_to) {
      await supabaseAdmin.from('xp_ledger').insert({
        tenant_id: tenantId,
        user_id: data.assigned_to,
        source_type: 'quest',
        source_id: data.id,
        xp: data.xp_reward || 0,
        note: `Completed: ${data.title}`
      });
    }

    return res.status(200).json({ quest: data, xp_awarded: becameCompleted ? (data.xp_reward || 0) : 0 });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabaseAdmin
      .from('quests')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
