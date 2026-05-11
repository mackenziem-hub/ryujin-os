// ═══════════════════════════════════════════════════════════════
// /api/schedule — admin view of scheduled installs + service tickets
// across the next N days. Powers /admin-dispatch.html.
//
//   GET /api/schedule?days=14
//   Headers: Authorization: Bearer <session token>, x-tenant-id
//
// Returns:
//   {
//     days: [
//       { date: '2026-05-12', installs: [...], service: [...] }
//     ],
//     total_installs: N,
//     total_service: N,
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });
  if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only' });

  const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 14));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + days * 86400000);

  const todayIso = today.toISOString();
  const todayDay = todayIso.slice(0, 10);
  const horizonIso = horizon.toISOString();
  const horizonDay = horizonIso.slice(0, 10);

  // Estimates with a scheduled start in the window.
  const ests = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, scheduled_start_date, scheduled_end_date, state, total_price, customer:customers(full_name, phone, address)')
    .eq('tenant_id', req.tenant.id)
    .not('scheduled_start_date', 'is', null)
    .gte('scheduled_start_date', todayDay)
    .lte('scheduled_start_date', horizonDay)
    .order('scheduled_start_date', { ascending: true })
    .limit(120);

  // Service tickets with a scheduled_at in the window.
  const tix = await supabaseAdmin
    .from('service_tickets')
    .select('id, title, scheduled_at, priority, status, customer:customers(full_name, phone)')
    .eq('tenant_id', req.tenant.id)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', todayIso)
    .lte('scheduled_at', horizonIso)
    .order('scheduled_at', { ascending: true })
    .limit(120);

  // Bucket by day. Estimates use scheduled_start_date (date-only).
  // Service tickets use scheduled_at (timestamp) — bucket by its day.
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    byDay.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), installs: [], service: [] });
  }

  for (const e of ests.data || []) {
    const key = (e.scheduled_start_date || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    byDay.get(key).installs.push({
      id: e.id,
      label: e.customer?.full_name || 'Unnamed customer',
      ref: e.estimate_number || `est-${e.id.slice(0, 6)}`,
      state: e.state || null,
      address: e.customer?.address || null,
      phone: e.customer?.phone || null,
      value: e.total_price || null,
      end_date: e.scheduled_end_date || null,
    });
  }

  for (const t of tix.data || []) {
    const key = (t.scheduled_at || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    byDay.get(key).service.push({
      id: t.id,
      label: t.customer?.full_name || 'Unnamed customer',
      title: t.title,
      priority: t.priority || 'normal',
      status: t.status || 'open',
      phone: t.customer?.phone || null,
      time: (t.scheduled_at || '').slice(11, 16),  // HH:MM
    });
  }

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    days: [...byDay.values()],
    total_installs: (ests.data || []).length,
    total_service: (tix.data || []).length,
  });
}

export default requireTenant(handler);
