// ═══════════════════════════════════════════════════════════════
// /api/cron-health — admin-only view of the cron + agent fleet's
// last-24h health. Powers /admin-cron-health.html.
//
//   GET /api/cron-health
//   Headers: Authorization: Bearer <session token>
//
// Returns:
//   {
//     generated_at: ISO,
//     agents: [
//       { agent_slug, runs_24h, errors_24h, last_run, last_status,
//         last_duration_ms, last_summary, last_error_message }
//     ],
//     crons: [
//       { path, schedule, description }   // static — mirrors vercel.json
//     ]
//   }
//
// Tenant scoping: requireTenant resolves the tenant from header /
// session. Admin-only — returns 403 for non-privileged sessions.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

// Mirror of vercel.json crons[] — kept in sync manually so the page can
// show a scheduled job even when it hasn't fired in the last 24h yet.
const CRONS = [
  { path: '/api/marketing-reconcile',       schedule: '*/15 * * * *',     description: 'Reconcile scheduled marketing posts against GHL' },
  { path: '/api/agents/daily',              schedule: '3 10 * * *',       description: 'Meta token health + 4 daily agent scans (06:03 AT)' },
  { path: '/api/agents/weekly',             schedule: '7 9 * * 1',        description: 'Weekly infra + KPI scan (Mon 05:07 AT)' },
  { path: '/api/agents/briefing?type=morning', schedule: '0 10 * * *',    description: 'Morning briefing email to Mac (06:00 AT)' },
  { path: '/api/agents/briefing?type=evening', schedule: '0 21 * * *',    description: 'Evening briefing snapshot (17:00 AT)' },
  { path: '/api/agents/memory',             schedule: '59 3 * * *',       description: 'Memory consolidation across agents (23:59 AT prev day)' },
  { path: '/api/agents/watchdog',           schedule: '0 12,14,16,18,20,22 * * *', description: 'Email + GHL conversation polling every 2h' },
  { path: '/api/agents/heartbeat',          schedule: '30 12 * * *',      description: "Dead-man's switch for the morning briefing (08:30 AT)" },
  { path: '/api/agents/cashflow',           schedule: '0 */4 * * *',      description: 'Cashflow Gmail payment reconciliation (every 4h)' },
  { path: '/api/agents/peer-audit',         schedule: '30 10 * * *',      description: 'Pricing peer-audit on recent estimates (06:30 AT)' },
  { path: '/api/agents/cron-daily',         schedule: '45 10 * * *',      description: '6 archetypal scans + strategy roll-up (06:45 AT)' },
];

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });
  if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only' });

  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data: runs, error } = await supabaseAdmin
    .from('agent_runs')
    .select('agent_slug, started_at, completed_at, status, duration_ms, summary, error_message')
    .eq('tenant_id', req.tenant.id)
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Aggregate by agent_slug — keep the most recent row's status, count
  // total runs and error runs in the window.
  const bySlug = new Map();
  for (const r of runs || []) {
    if (!bySlug.has(r.agent_slug)) {
      bySlug.set(r.agent_slug, {
        agent_slug: r.agent_slug,
        runs_24h: 0,
        errors_24h: 0,
        last_run: r.started_at,
        last_status: r.status,
        last_duration_ms: r.duration_ms,
        last_summary: typeof r.summary === 'string' ? r.summary : JSON.stringify(r.summary || {}).slice(0, 200),
        last_error_message: r.error_message || null,
      });
    }
    const agg = bySlug.get(r.agent_slug);
    agg.runs_24h += 1;
    if (r.status === 'error' || r.error_message) agg.errors_24h += 1;
  }

  const agents = [...bySlug.values()].sort((a, b) =>
    (b.last_run || '').localeCompare(a.last_run || ''));

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    agents,
    crons: CRONS,
  });
}

export default requireTenant(handler);
