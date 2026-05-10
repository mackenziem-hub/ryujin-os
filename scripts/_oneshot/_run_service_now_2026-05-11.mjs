// Manual run of just the service agent for today, so AJ's portal
// has data to show. Skipping the full cron-daily because the other
// 6 agents already ran today at 10:45 UTC; re-running would create
// duplicate briefing items.
import fs from 'node:fs';
import path from 'node:path';
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

const { runServiceScan } = await import('../../lib/agents/service_scan.js');
const { persistAgentRun } = await import('../../lib/agents/persistAgentRun.js');

// Find AJ's user_id for default assignment
const { data: aj } = await sb.from('users').select('id').eq('tenant_id', tenant.id).ilike('name', 'AJ%').maybeSingle();
const assignedTo = aj ? { service: aj.id } : {};

const report = await runServiceScan({ tenantSlug: 'plus-ultra' });
console.log('Service scan report:', JSON.stringify({ findings: report.findings, tasks: report.tasks, stats: report.stats }, null, 2));

const result = await persistAgentRun(report, {
  tenantId: tenant.id,
  agentSlug: 'service',
  trigger: 'manual',
  assignedTo,
  kpiMap: {
    'stats.tickets_open':                  { key: 'service.tickets_open',         label: 'Tickets Open',          unit: 'count', sort_order: 60 },
    'stats.callbacks_open':                { key: 'service.callbacks_open',       label: 'Callbacks Open',        unit: 'count', sort_order: 61 },
    'stats.callbacks_aging':               { key: 'service.callbacks_aging',      label: 'Aging Callbacks',       unit: 'count', sort_order: 62 },
    'stats.tickets_overdue':               { key: 'service.tickets_overdue',      label: 'Overdue Tickets',       unit: 'count', sort_order: 63 },
    'stats.tickets_complete_12mo':         { key: 'service.tickets_complete_12mo',label: 'Completed (12mo)',      unit: 'count', sort_order: 64 },
    'stats.callback_rate_pct':             { key: 'service.callback_rate_pct',    label: 'Callback Rate',         unit: '%',     sort_order: 65 },
    'stats.warranty_claims_pending_response':{ key: 'service.warranty_pending_resp', label: 'Warranty Resp Pending', unit: 'count', sort_order: 66 },
  },
});
console.log('Persist result:', result);
