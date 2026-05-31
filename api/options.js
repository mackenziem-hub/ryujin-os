// ═══════════════════════════════════════════════════════════════
// /api/options — agent-generated top-4 options for the interactive
// mode shell (3-mode MD).
//
//   GET  /api/options?pillar=sales[&state=<id>]
//
//   returns: { context_summary: string,
//              options: [{ id, label, why?, kind, payload, recommended_rank }],
//              archetype: { name, accent_color, avatar_video, avatar_poster },
//              pillar, latency_ms }
//
// Same observations + Claude API loop as /api/agent-chat, but the
// agent's job is "given the current state, list the top 4 actions
// in priority order" instead of "respond to a message". Used by the
// interactive-mode shell to populate the controller-navigable cards.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requirePillar } from '../lib/entitlements.js';
import { resolvePillar, archetypeOf } from '../lib/archetypeRegistry.js';
import { catalogForPrompt, sanitizeNavAction } from '../lib/pageCatalog.js';
import { loadSnapshotObservations } from '../lib/observations.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1200;

const OPTIONS_TOOL = {
  name: 'record_options',
  description: 'Record the top 4 actions the operator should consider right now, in priority order.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['context_summary', 'options'],
    properties: {
      context_summary: {
        type: 'string',
        description: '1-2 sentences summarizing the current state of this pillar so the operator knows why these options surfaced. Reference real numbers from observations.',
      },
      options: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'kind', 'recommended_rank'],
          properties: {
            label: { type: 'string', description: 'Short imperative button text.' },
            why: { type: 'string', description: 'One short line of evidence.' },
            kind: {
              type: 'string',
              enum: ['navigate_to', 'send_email', 'send_sms', 'create_quest', 'run_agent', 'open_estimate', 'open_customer', 'compose_message', 'escalate_to_advanced'],
            },
            payload: { type: 'object', description: 'Action-specific data.' },
            recommended_rank: {
              type: 'integer', minimum: 1, maximum: 4,
              description: '1 = highest leverage, 4 = lowest. No two options should share rank.',
            },
          },
        },
      },
    },
  },
};

async function loadObservations(tenantId, pillarSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const obs = { briefing: [], kpis: [], latest_run: null };

  const briefing = await supabaseAdmin
    .from('briefing_items')
    .select('priority, title, body, source_agent, created_at')
    .eq('tenant_id', tenantId)
    .eq('source_agent', pillarSlug)
    .eq('for_date', today)
    .is('dismissed_at', null)
    .order('priority', { ascending: true })
    .limit(20);
  if (!briefing.error) obs.briefing = briefing.data || [];

  const kpis = await supabaseAdmin
    .from('kpis')
    .select('key, label, value, unit')
    .eq('tenant_id', tenantId)
    .like('key', `${pillarSlug}.%`)
    .order('sort_order', { ascending: true })
    .limit(30);
  if (!kpis.error) obs.kpis = kpis.data || [];

  const latest = await supabaseAdmin
    .from('agent_runs')
    .select('agent_slug, summary, started_at, status')
    .eq('tenant_id', tenantId)
    .eq('agent_slug', pillarSlug)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest.error && latest.data) obs.latest_run = latest.data;

  return obs;
}

function formatObservations(obs) {
  const lines = [];
  if (obs.latest_run?.summary) {
    lines.push(`### Latest agent run`);
    lines.push(obs.latest_run.summary);
    lines.push('');
  }
  if (obs.briefing.length) {
    lines.push(`### Today's briefing`);
    for (const b of obs.briefing) {
      lines.push(`- [${(b.priority || 'normal').toUpperCase()}] ${b.title}${b.body ? ` — ${b.body}` : ''}`);
    }
    lines.push('');
  }
  if (obs.kpis.length) {
    lines.push(`### KPIs`);
    for (const k of obs.kpis) {
      lines.push(`- ${k.label}: ${k.unit === '$' ? '$' : ''}${k.value}${k.unit && k.unit !== '$' ? ' ' + k.unit : ''}`);
    }
    lines.push('');
  }
  if (lines.length === 0) return '(No observations available — today\'s cron run hasn\'t happened yet, or this pillar has no data.)';
  return lines.join('\n');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const pillarSlug = req.query.pillar;
  const stateId = req.query.state || 'root';
  const pillarConfig = resolvePillar(pillarSlug);
  if (!pillarConfig) return res.status(400).json({ error: `unknown pillar: ${pillarSlug}` });

  const obs = await loadObservations(req.tenant.id, pillarSlug);
  // Shared cross-pillar awareness: active-jobs roster + revenue totals from
  // /api/snapshot (Plus Ultra only; '' for other tenants).
  const snapshotText = await loadSnapshotObservations(req.tenant.slug);
  const observationsText = snapshotText
    ? `${formatObservations(obs)}\n\n${snapshotText}`
    : formatObservations(obs);

  const system = `${pillarConfig.persona_prompt}

You are picking the top 4 actions for the operator's interactive-mode card stack. State id: "${stateId}".

## Observations available right now
${observationsText}

## Action vocabulary (kind values for record_options)
- navigate_to: payload { url } - open a Ryujin page. Use ONLY one of these exact paths (never invent a URL or #hash). If the right page is unclear, use /cockpit.html:
${catalogForPrompt()}
- send_email: payload { to, subject?, body } — operator confirms before send
- send_sms: payload { to, subject?, body } — ONLY between 07:00 and 19:00 local time. The current hour is ${new Date().getHours()}. Outside that window, use compose_message instead.
- create_quest: payload { title, description, priority }
- run_agent: payload { agent_slug }
- open_estimate: payload { estimate_id }
- open_customer: payload { customer_id }
- compose_message: payload { to_user, body } — internal Ryujin operator-to-operator message; the default for quiet hours
- escalate_to_advanced: payload { url } — open the equivalent advanced-mode page when the action is too rich for a single click

## Rules
- Return at most 4 options.
- recommended_rank is 1 for the highest-leverage option, 2/3/4 for descending priority.
- Every option must be grounded in the observations. If observations are empty, return one option of kind escalate_to_advanced pointing to the pillar dashboard so the operator can pick from the full surface.
- No two options should share recommended_rank.
- Be specific in labels: "Send follow-up to Bryon Heisler" not "Send follow-up".
- Use record_options to record your output.`;

  const t0 = Date.now();
  let claudeRes;
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [OPTIONS_TOOL],
        tool_choice: { type: 'tool', name: 'record_options' },
        messages: [{ role: 'user', content: `Generate the top 4 options for state "${stateId}" right now.` }],
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: `Claude API network: ${e.message}` });
  }

  const latencyMs = Date.now() - t0;
  if (!claudeRes.ok) {
    const txt = await claudeRes.text().catch(() => '');
    return res.status(502).json({ error: `Claude API ${claudeRes.status}: ${txt.slice(0, 300)}` });
  }
  const j = await claudeRes.json();
  const toolUse = (j.content || []).find(c => c.type === 'tool_use' && c.name === 'record_options');
  if (!toolUse?.input) {
    return res.status(502).json({ error: 'Claude did not call record_options', raw: j });
  }

  // Sort options by recommended_rank ascending for deterministic UI ordering.
  const options = (toolUse.input.options || [])
    .map((o, i) => ({ id: `opt_${i}`, ...o }))
    .sort((a, b) => (a.recommended_rank || 99) - (b.recommended_rank || 99))
    .slice(0, 4)
    .map(sanitizeNavAction); // fail-closed: never ship a hallucinated nav URL to the browser

  const archetype = archetypeOf(pillarSlug);
  return res.status(200).json({
    context_summary: toolUse.input.context_summary,
    options,
    archetype: archetype ? {
      name: pillarConfig.name,
      accent_color: archetype.accent_color,
      avatar_video: archetype.avatar_video,
      avatar_poster: archetype.avatar_poster,
    } : null,
    pillar: pillarSlug,
    state_id: stateId,
    latency_ms: latencyMs,
    model: MODEL,
  });
}

async function gatedHandler(req, res) {
  const pillarSlug = req.query.pillar;
  if (!pillarSlug) return res.status(400).json({ error: 'pillar query param required' });
  const gate = requirePillar(pillarSlug);
  return gate(handler)(req, res);
}

export default requireTenant(gatedHandler);
