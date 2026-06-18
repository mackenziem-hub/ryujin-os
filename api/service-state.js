// ═══════════════════════════════════════════════════════════════
// SERVICE-STATE — bundled payload for /service.html (panel dashboard).
//
// Service is AJ's domain: ongoing repair/callback/warranty-claim work
// post-install. Separate from production (which is closeout of the
// original job).
//
// GET /api/service-state[?user_id=<uuid>]
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = req.tenant.id;
  const userId = req.query.user_id || null;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

  // ── Briefing items: filter to source_agent='service' if any agent emits there;
  //    otherwise empty (no service-specific agent yet, so this stays empty).
  let briefingQ = supabaseAdmin
    .from('briefing_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_agent', 'service')
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(40);
  if (userId) briefingQ = briefingQ.or(`for_user_id.eq.${userId},for_user_id.is.null`);
  const briefing = await briefingQ;

  // ── KPIs prefixed 'service.' ──
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('key', 'service.%')
    .order('sort_order', { ascending: true });

  // ── Service-domain stats ──
  const stats = {
    tickets_open: 0, tickets_scheduled: 0, tickets_in_progress: 0,
    tickets_complete_30d: 0,
    tickets_complete_12mo: 0, callbacks_complete_12mo: 0, callback_rate_pct: 0,
    callbacks_open: 0, repairs_open: 0,
    warranty_claims_open: 0, warranty_claims_filed_30d: 0,
    tickets_overdue: 0    // open + scheduled_at in past
  };

  try {
    const ts = await supabaseAdmin
      .from('service_tickets')
      .select('id, ticket_type, status, scheduled_at, completed_at')
      .eq('tenant_id', tenantId)
      .order('reported_at', { ascending: false })
      .limit(2000);
    if (!ts.error) {
      const now = Date.now();
      for (const t of ts.data || []) {
        if (t.status === 'open') {
          stats.tickets_open++;
          if (t.ticket_type === 'callback') stats.callbacks_open++;
          if (t.ticket_type === 'repair') stats.repairs_open++;
        } else if (t.status === 'scheduled') {
          stats.tickets_scheduled++;
          if (t.scheduled_at && new Date(t.scheduled_at).getTime() < now) stats.tickets_overdue++;
        } else if (t.status === 'in_progress') {
          stats.tickets_in_progress++;
        } else if (t.status === 'complete') {
          if (t.completed_at && t.completed_at >= thirtyDaysAgo) stats.tickets_complete_30d++;
          if (t.completed_at && t.completed_at >= oneYearAgo) {
            stats.tickets_complete_12mo++;
            if (t.ticket_type === 'callback') stats.callbacks_complete_12mo++;
          }
        }
      }
      stats.callback_rate_pct = stats.tickets_complete_12mo > 0
        ? Math.round((stats.callbacks_complete_12mo / stats.tickets_complete_12mo) * 1000) / 10
        : 0;
    }
  } catch { /* table missing — soft-fail */ }

  try {
    const wc = await supabaseAdmin
      .from('warranty_claims')
      .select('id, status, filed_at')
      .eq('tenant_id', tenantId)
      .limit(500);
    if (!wc.error) {
      for (const c of wc.data || []) {
        if (['open','documenting','filed'].includes(c.status)) stats.warranty_claims_open++;
        if (c.filed_at && c.filed_at >= thirtyDaysAgo) stats.warranty_claims_filed_30d++;
      }
    }
  } catch { /* soft-fail */ }

  // ── Activity timeline ──
  const activity = [];
  try {
    const recentTickets = await supabaseAdmin
      .from('service_tickets')
      .select('id, title, ticket_type, status, customer:customers(full_name), reported_at, completed_at')
      .eq('tenant_id', tenantId)
      .order('reported_at', { ascending: false })
      .limit(10);
    for (const t of recentTickets.data || []) {
      activity.push({
        at: t.completed_at || t.reported_at,
        kind: 'ticket',
        label: `${t.customer?.full_name || 'unknown'} · ${t.title} · ${t.status}`,
        ref_id: t.id
      });
    }
  } catch { /* soft-fail */ }

  try {
    const recentClaims = await supabaseAdmin
      .from('warranty_claims')
      .select('id, title, status, claim_type, customer:customers(full_name), updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(5);
    for (const c of recentClaims.data || []) {
      activity.push({
        at: c.updated_at,
        kind: 'warranty',
        label: `${c.customer?.full_name || 'unknown'} · ${c.title} · ${c.status}`,
        ref_id: c.id
      });
    }
  } catch { /* soft-fail */ }

  activity.sort((a, b) => new Date(b.at) - new Date(a.at));

  return res.status(200).json({
    date: today,
    briefing: briefing.data || [],
    kpis: kpis.data || [],
    activity: activity.slice(0, 20),
    stats,
    last_updated_at: new Date().toISOString()
  });
}

export default requirePortalSessionAndTenant(handler);
