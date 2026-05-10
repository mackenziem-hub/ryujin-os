// ═══════════════════════════════════════════════════════════════
// SERVICE AGENT — AJ's pillar. Repair / callback / warranty work.
//
// Returns the same { agent, role, timestamp, findings, tasks, stats }
// shape as the rest of the agent fleet so it slots into persistAgentRun
// alongside customer_scan / strategy_scan.
//
// Reads from service_tickets + warranty_claims (migration 047).
// Plain function name per project_archetypal_agents_rename.md — no
// anime aliasing on new agents.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../supabase.js';

const OVERDUE_HOURS = 24;             // scheduled_at past + open status
const AGING_CALLBACK_DAYS = 30;       // open callback older than this
const WARRANTY_PENDING_DAYS = 30;     // claim filed but no manufacturer response
const HIGH_VALUE_WARRANTY = 5000;     // dollar threshold

export async function runServiceScan({ tenantSlug = 'plus-ultra' } = {}) {
  const report = {
    agent: 'Service',
    role: 'Repair / callback / warranty (AJ\'s pillar)',
    timestamp: new Date().toISOString(),
    findings: [],
    tasks: [],
    stats: {}
  };

  // Resolve tenant
  const t = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (t.error || !t.data) {
    report.findings.push(`Tenant lookup failed for slug=${tenantSlug}: ${t.error?.message || 'not found'}`);
    return report;
  }
  const tenantId = t.data.id;

  const now = Date.now();
  const oneYearAgo = new Date(now - 365 * 86400000).toISOString();

  // ── Pull service tickets (last 12mo for callback-rate, all open) ──
  const ts = await supabaseAdmin
    .from('service_tickets')
    .select('id, ticket_type, status, priority, title, scheduled_at, completed_at, reported_at, customer:customers(full_name)')
    .eq('tenant_id', tenantId)
    .or(`status.in.(open,scheduled,in_progress),completed_at.gte.${oneYearAgo}`)
    .order('reported_at', { ascending: false })
    .limit(2000);

  if (ts.error) {
    report.findings.push(`service_tickets fetch failed: ${ts.error.message}`);
    return report;
  }
  const tickets = ts.data || [];

  // ── Lifecycle stats ──
  const stats = report.stats = {
    tickets_open: 0, tickets_scheduled: 0, tickets_in_progress: 0,
    tickets_complete_12mo: 0, callbacks_complete_12mo: 0, callback_rate_pct: 0,
    callbacks_open: 0, repairs_open: 0,
    tickets_overdue: 0,
    callbacks_aging: 0,                 // open callbacks > AGING_CALLBACK_DAYS old
    warranty_claims_open: 0, warranty_claims_pending_response: 0, warranty_high_value: 0
  };

  const overdueTickets = [];
  const agingCallbacks = [];

  for (const t of tickets) {
    if (t.status === 'open') {
      stats.tickets_open++;
      if (t.ticket_type === 'callback') {
        stats.callbacks_open++;
        const reported = t.reported_at ? new Date(t.reported_at).getTime() : 0;
        if (reported && (now - reported) / 86400000 >= AGING_CALLBACK_DAYS) {
          stats.callbacks_aging++;
          agingCallbacks.push(t);
        }
      }
      if (t.ticket_type === 'repair') stats.repairs_open++;
    } else if (t.status === 'scheduled') {
      stats.tickets_scheduled++;
      if (t.scheduled_at) {
        const sched = new Date(t.scheduled_at).getTime();
        if (sched < now - OVERDUE_HOURS * 3600000) {
          stats.tickets_overdue++;
          overdueTickets.push(t);
        }
      }
    } else if (t.status === 'in_progress') {
      stats.tickets_in_progress++;
    } else if (t.status === 'complete' && t.completed_at && t.completed_at >= oneYearAgo) {
      stats.tickets_complete_12mo++;
      if (t.ticket_type === 'callback') stats.callbacks_complete_12mo++;
    }
  }
  stats.callback_rate_pct = stats.tickets_complete_12mo > 0
    ? Math.round((stats.callbacks_complete_12mo / stats.tickets_complete_12mo) * 1000) / 10
    : 0;

  // ── Warranty claims ──
  const wc = await supabaseAdmin
    .from('warranty_claims')
    .select('id, status, claim_type, manufacturer, title, filed_at, customer:customers(full_name), source_estimate')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(500);

  const pendingClaims = [];
  const highValueClaims = [];
  if (!wc.error) {
    for (const c of wc.data || []) {
      if (['open','documenting','filed'].includes(c.status)) {
        stats.warranty_claims_open++;
        if (c.status === 'filed' && c.filed_at) {
          const days = (now - new Date(c.filed_at).getTime()) / 86400000;
          if (days >= WARRANTY_PENDING_DAYS) {
            stats.warranty_claims_pending_response++;
            pendingClaims.push({ ...c, days_pending: Math.floor(days) });
          }
        }
      }
    }
  }

  // ── Findings + tasks ──
  report.findings.push(
    `Open tickets: ${stats.tickets_open} (${stats.callbacks_open} callbacks, ${stats.repairs_open} repairs) · ${stats.tickets_scheduled} scheduled · ${stats.tickets_complete_12mo} completed (12mo, callback rate ${stats.callback_rate_pct}%)`
  );

  if (stats.tickets_overdue > 0) {
    report.findings.push(`${stats.tickets_overdue} ticket${stats.tickets_overdue === 1 ? '' : 's'} overdue (scheduled past + still open)`);
    report.tasks.push({
      title: `Reschedule or close ${stats.tickets_overdue} overdue ticket${stats.tickets_overdue === 1 ? '' : 's'}`,
      description: overdueTickets.slice(0, 8).map(t => `• ${t.customer?.full_name || 'unknown'} — ${t.title} — scheduled ${t.scheduled_at}`).join('\n'),
      priority: stats.tickets_overdue >= 3 ? 'high' : 'medium'
    });
  }

  if (stats.callbacks_aging > 0) {
    report.findings.push(`${stats.callbacks_aging} callback${stats.callbacks_aging === 1 ? '' : 's'} open ${AGING_CALLBACK_DAYS}+ days`);
    report.tasks.push({
      title: `Triage ${stats.callbacks_aging} aging callback${stats.callbacks_aging === 1 ? '' : 's'}`,
      description: agingCallbacks.slice(0, 8).map(t => `• ${t.customer?.full_name || 'unknown'} — ${t.title} — reported ${t.reported_at}`).join('\n'),
      priority: 'high'
    });
  }

  if (stats.warranty_claims_pending_response > 0) {
    report.findings.push(`${stats.warranty_claims_pending_response} warranty claim${stats.warranty_claims_pending_response === 1 ? '' : 's'} filed ${WARRANTY_PENDING_DAYS}+ days, no manufacturer response`);
    report.tasks.push({
      title: `Follow up with manufacturer on ${stats.warranty_claims_pending_response} warranty claim${stats.warranty_claims_pending_response === 1 ? '' : 's'}`,
      description: pendingClaims.slice(0, 6).map(c => `• ${c.customer?.full_name || 'unknown'} — ${c.title} — ${c.manufacturer || 'manufacturer'} — ${c.days_pending}d pending`).join('\n'),
      priority: 'high'
    });
  }

  if (stats.callback_rate_pct >= 8 && stats.tickets_complete_12mo >= 20) {
    report.findings.push(`Callback rate ${stats.callback_rate_pct}% is above 8% — investigate crew workmanship or material defects`);
    report.tasks.push({
      title: `Review callback drivers — rate is ${stats.callback_rate_pct}% (target <5%)`,
      description: `Callbacks ÷ completed jobs over last 12mo. Walk recent callbacks for common cause (crew, material lot, install detail). 20+ data points so this is meaningful.`,
      priority: 'medium'
    });
  }

  return report;
}
