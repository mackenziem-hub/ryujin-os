// Ryujin OS — Time Entries (Clock In/Out)
// GET    /api/time                  — List time entries (filterable by user, date range)
// POST   /api/time                  — Clock in
// PUT    /api/time                  — Clock out or update
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { user_id, from, to, limit = 50 } = req.query;

    let query = supabaseAdmin
      .from('time_entries')
      .select('*, user:users(id, name)')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false })
      .limit(parseInt(limit));

    if (user_id) query = query.eq('user_id', user_id);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entries: data });
  }

  // ── POST (Clock In) ──
  if (req.method === 'POST') {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    // Check if already clocked in today
    const { data: existing } = await supabaseAdmin
      .from('time_entries')
      .select('id, clock_in, clock_out')
      .eq('user_id', user_id)
      .eq('date', today)
      .maybeSingle();

    if (existing && !existing.clock_out) {
      return res.status(409).json({ error: 'Already clocked in today. Clock out first.', entry: existing });
    }

    if (existing && existing.clock_out) {
      return res.status(409).json({ error: 'Already have a complete entry for today.', entry: existing });
    }

    const { data, error } = await supabaseAdmin
      .from('time_entries')
      .insert({
        tenant_id: tenantId,
        user_id,
        date: today,
        clock_in: now,
        status: 'open'
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT (Clock Out or Update) ──
  if (req.method === 'PUT') {
    const { id, user_id, action, notes, approved_by } = req.body || {};

    // Clock out by user_id (find today's open entry)
    if (action === 'clock_out') {
      const uid = user_id || id;
      if (!uid) return res.status(400).json({ error: 'user_id required for clock_out' });

      const today = new Date().toISOString().split('T')[0];
      const { data: entry } = await supabaseAdmin
        .from('time_entries')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', uid)
        .eq('date', today)
        .eq('status', 'open')
        .maybeSingle();

      if (!entry) return res.status(404).json({ error: 'No open time entry found for today' });

      const clockOut = new Date();
      const clockIn = new Date(entry.clock_in);
      const totalHours = Math.round((clockOut - clockIn) / (1000 * 60 * 60) * 100) / 100;

      const { data, error } = await supabaseAdmin
        .from('time_entries')
        .update({
          clock_out: clockOut.toISOString(),
          total_hours: totalHours,
          status: 'closed',
          notes: notes || entry.notes
        })
        .eq('id', entry.id)
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Approve entry (admin/manager)
    if (action === 'approve' && id) {
      const { data, error } = await supabaseAdmin
        .from('time_entries')
        .update({ status: 'approved', approved_by: approved_by || null })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // Generic update
    if (id) {
      const updates = {};
      if (notes !== undefined) updates.notes = notes;
      const { data, error } = await supabaseAdmin
        .from('time_entries')
        .update(updates)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('*')
        .single();

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    return res.status(400).json({ error: 'Missing id or action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
