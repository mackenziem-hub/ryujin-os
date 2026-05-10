// ═══════════════════════════════════════════════════════════════
// /api/agent-chat — per-pillar conversational agent (3-mode MC).
//
//   POST /api/agent-chat
//   body: { pillar: 'sales'|'marketing'|'service'|'customer'|'finance'|'production'|'hq',
//           message: string, conversation: [{role,content},...] (optional) }
//
//   returns: { reply: string,
//              proposed_actions: [{ label, kind, payload, why }],
//              archetype: { name, accent_color, avatar_video, avatar_poster },
//              latency_ms }
//
// Pulls the pillar's latest agent_runs.summary + briefing_items + KPIs
// as observations the agent sees as live context. Calls Claude API
// with persona prompt + observations + operator message, returns a
// structured response via forced tool use.
//
// Action kinds the agent may propose (operator confirms before any
// write):
//   navigate_to    — { url }
//   send_email     — { to, subject, body }
//   send_sms       — { to, body }
//   create_quest   — { title, description, priority }
//   run_agent      — { agent_slug }
//   open_estimate  — { estimate_id }
//   open_customer  — { customer_id }
//
// The shell at public/assets/agent-mode-shell.js handles execution
// after operator confirms.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requirePillar } from '../lib/entitlements.js';
import { resolvePillar, archetypeOf } from '../lib/archetypeRegistry.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

const ACTION_TOOL = {
  name: 'record_response',
  description: 'Record your reply to the operator + any proposed actions they should confirm.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply'],
    properties: {
      reply: {
        type: 'string',
        description: '2-4 sentences spoken back to the operator. Plain language, no corporate jargon. Reference real names/numbers from the observations.',
      },
      proposed_actions: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string', description: 'Short button text the operator clicks. Imperative voice.' },
            kind: {
              type: 'string',
              enum: ['navigate_to', 'send_email', 'send_sms', 'create_quest', 'run_agent', 'open_estimate', 'open_customer', 'noop'],
            },
            payload: { type: 'object', description: 'Action-specific data — see /api/agent-chat docs.' },
            why: { type: 'string', description: 'One short line of evidence (e.g. "Bryon\'s deposit cleared but install isn\'t scheduled").' },
            recommended: { type: 'boolean', description: 'True for the single highest-leverage option.' },
          },
        },
      },
    },
  },
};

async function loadObservations(tenantId, pillarSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const obs = { briefing: [], kpis: [], latest_run: null };

  // Briefing items emitted today by this pillar's agent.
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

  // KPIs prefixed with this pillar's namespace.
  const kpis = await supabaseAdmin
    .from('kpis')
    .select('key, label, value, unit')
    .eq('tenant_id', tenantId)
    .like('key', `${pillarSlug}.%`)
    .order('sort_order', { ascending: true })
    .limit(30);
  if (!kpis.error) obs.kpis = kpis.data || [];

  // Latest agent run summary so the agent has the most recent narrative.
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
    lines.push(`### Latest agent run (${obs.latest_run.started_at}, ${obs.latest_run.status})`);
    lines.push(obs.latest_run.summary);
    lines.push('');
  }
  if (obs.briefing.length) {
    lines.push(`### Today's briefing (${obs.briefing.length} items)`);
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const body = req.body || {};
  const pillarSlug = body.pillar;
  const message = (body.message || '').trim();
  const history = Array.isArray(body.conversation) ? body.conversation.slice(-8) : [];

  const pillarConfig = resolvePillar(pillarSlug);
  if (!pillarConfig) return res.status(400).json({ error: `unknown pillar: ${pillarSlug}` });
  if (!message) return res.status(400).json({ error: 'message required' });

  const obs = await loadObservations(req.tenant.id, pillarSlug);
  const observationsText = formatObservations(obs);

  const system = `${pillarConfig.persona_prompt}

You are responding to a real operator running their business through Ryujin OS. Use the record_response tool to reply.

## Observations available right now
${observationsText}

## Action vocabulary
You may propose up to 4 actions for the operator to confirm. Use these kinds:
- navigate_to: payload { url } — open a Ryujin page
- send_email / send_sms: payload { to, subject?, body } — operator confirms before send
- create_quest: payload { title, description, priority } — adds to the operator's quest board
- run_agent: payload { agent_slug } — re-run a pillar's scan now
- open_estimate: payload { estimate_id }
- open_customer: payload { customer_id }
- noop: when no action is appropriate, just reply

Mark the single best option recommended:true. Never invent customers, estimates, or dollar amounts. If the observations don't support an action, don't propose it.`;

  const messages = [];
  for (const turn of history) {
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: typeof turn.content === 'string' ? turn.content : JSON.stringify(turn.content) });
    }
  }
  messages.push({ role: 'user', content: message });

  const t0 = Date.now();
  let claudeRes;
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [ACTION_TOOL],
        tool_choice: { type: 'tool', name: 'record_response' },
        messages,
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
  const toolUse = (j.content || []).find(c => c.type === 'tool_use' && c.name === 'record_response');
  if (!toolUse?.input) {
    return res.status(502).json({ error: 'Claude did not call record_response', raw: j });
  }

  const archetype = archetypeOf(pillarSlug);
  return res.status(200).json({
    reply: toolUse.input.reply,
    proposed_actions: toolUse.input.proposed_actions || [],
    archetype: archetype ? {
      name: pillarConfig.name,
      accent_color: archetype.accent_color,
      avatar_video: archetype.avatar_video,
      avatar_poster: archetype.avatar_poster,
    } : null,
    pillar: pillarSlug,
    latency_ms: latencyMs,
    model: MODEL,
  });
}

// Wrap order: requireTenant first, then requirePillar so an operator
// without the pillar entitlement gets a clean 403 + upgrade hint.
// Pillar is dynamic so we wrap inside the handler.
async function gatedHandler(req, res) {
  const pillarSlug = (req.body || {}).pillar;
  if (!pillarSlug) return res.status(400).json({ error: 'pillar required in body' });
  // Use the entitlements gate — but it expects a closed-over slug, so we
  // construct it on the fly per request.
  const gate = requirePillar(pillarSlug);
  return gate(handler)(req, res);
}

export default requireTenant(gatedHandler);
