// /api/calendar-blocks - ad-hoc events on the unified calendar.
// Backed by calendar_blocks table (migration 075). Used by the + Add Event
// button on /calendar.html for items that aren't workorders, inspections,
// service tickets, or Google Cal events: supply yard runs, training blocks,
// owner day-off blocks, etc.
//
//   GET    /api/calendar-blocks?days=14    - list blocks in the window
//   POST   /api/calendar-blocks            - create a new block
//   PATCH  /api/calendar-blocks?id=X       - update a block
//   DELETE /api/calendar-blocks?id=X       - delete a block
//
// All routes require a portal session. Reads open to any tenant member;
// writes/deletes gated to owner/admin via isPrivileged.
import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const ALLOWED_CREW = new Set(['plus-ultra', 'atlantic', 'other']);
const ALLOWED_SERVICE_TYPE = new Set(['roof-inspection', 'service-call', 'site-inspection']);
const SAFE_UPDATE_FIELDS = new Set(['title', 'starts_at', 'ends_at', 'crew_label', 'notes', 'service_type', 'assigned_to']);

async function handler(req, res){
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });
  const tenantId = session.tenant_id;

  if (req.method === 'GET'){
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 14));
    const now = new Date();
    const startIso = now.toISOString();
    const endIso = new Date(now.getTime() + days * 86400000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('calendar_blocks')
      .select('id, title, starts_at, ends_at, crew_label, notes, service_type, assigned_to, created_by, created_at')
      .eq('tenant_id', tenantId)
      .gte('starts_at', startIso)
      .lte('starts_at', endIso)
      .order('starts_at', { ascending: true })
      .limit(200);

    if (error){
      // Table doesn't exist yet (migration 075 not applied). Return empty
      // so the calendar UI still renders; Mac applies the SQL via Supabase
      // Dashboard when ready.
      if (error.code === '42P01' || /does not exist/i.test(error.message)){
        return res.status(200).json({ blocks: [], total: 0, migration_pending: true });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ blocks: data || [], total: (data || []).length });
  }

  if (req.method === 'POST'){
    if (!isPrivileged(session)) return res.status(403).json({ error: 'forbidden' });

    const body = req.body || {};
    if (!body.title || typeof body.title !== 'string') return res.status(400).json({ error: 'title required' });
    if (!body.starts_at) return res.status(400).json({ error: 'starts_at required' });
    if (body.crew_label && !ALLOWED_CREW.has(body.crew_label)){
      return res.status(400).json({ error: 'invalid crew_label', allowed: [...ALLOWED_CREW] });
    }
    if (body.service_type && !ALLOWED_SERVICE_TYPE.has(body.service_type)){
      return res.status(400).json({ error: 'invalid service_type', allowed: [...ALLOWED_SERVICE_TYPE] });
    }

    const insert = {
      tenant_id: tenantId,
      title: body.title.trim().slice(0, 200),
      starts_at: body.starts_at,
      ends_at: body.ends_at || null,
      crew_label: body.crew_label || null,
      service_type: body.service_type || null,
      assigned_to: body.assigned_to ? String(body.assigned_to).slice(0, 120) : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      created_by: session.user_id !== 'service-internal' ? session.user_id : null,
    };

    const { data, error } = await supabaseAdmin
      .from('calendar_blocks')
      .insert(insert)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PATCH'){
    if (!isPrivileged(session)) return res.status(403).json({ error: 'forbidden' });

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const body = req.body || {};
    const updates = {};
    for (const [k, v] of Object.entries(body)){
      if (SAFE_UPDATE_FIELDS.has(k)) updates[k] = v;
    }
    if (updates.crew_label && !ALLOWED_CREW.has(updates.crew_label)){
      return res.status(400).json({ error: 'invalid crew_label', allowed: [...ALLOWED_CREW] });
    }
    if (typeof updates.title === 'string') updates.title = updates.title.trim().slice(0, 200);
    if (typeof updates.notes === 'string') updates.notes = updates.notes.slice(0, 2000);

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'no updatable fields supplied' });

    const { data, error } = await supabaseAdmin
      .from('calendar_blocks')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE'){
    if (!isPrivileged(session)) return res.status(403).json({ error: 'forbidden' });

    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabaseAdmin
      .from('calendar_blocks')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: id });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}

export default handler;
