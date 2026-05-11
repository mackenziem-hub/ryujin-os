// ═══════════════════════════════════════════════════════════════
// /api/agent-chat — per-pillar conversational agent.
//
//   POST /api/agent-chat
//   body: { pillar, message, conversation: [{role,content},...] (optional),
//           conversation_id: <uuid> (optional — server creates if missing) }
//
//   returns: { reply, proposed_actions[], extracted, auto_routed[],
//              archetype, pillar, conversation_id, latency_ms, model }
//
// Loop: persona prompt + scan observations → Claude (sonnet-4-6)
// → two parallel tools: record_response (reply + suggested actions)
// + extract_entities (customer/estimate/intent/urgency/confidence).
// On high confidence (≥0.7) the system auto-routes via lib/router.js
// to the canonical recipients. Every turn persists to
// chat_conversations + writes an activity_log note on the resolved
// entity.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requirePillar } from '../lib/entitlements.js';
import { resolvePillar, archetypeOf } from '../lib/archetypeRegistry.js';
import { resolveCustomer, resolveEstimate } from '../lib/entityResolver.js';
import { routeIntent } from '../lib/router.js';
import { attachNoteToEntity } from '../lib/agentNote.js';
import { INTENT_SLUGS } from '../lib/routingMap.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

const AUTO_ROUTE_CONFIDENCE = 0.7;
const NOTE_CONFIDENCE = 0.5;

const ACTION_TOOL = {
  name: 'record_response',
  description: 'Record your reply to the operator + any proposed actions they should confirm.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply'],
    properties: {
      reply: { type: 'string', description: '2-4 sentences spoken back to the operator. Plain language. Reference real names / numbers from observations.' },
      proposed_actions: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'kind'],
          properties: {
            label: { type: 'string' },
            kind: { type: 'string', enum: ['navigate_to', 'send_email', 'send_sms', 'create_quest', 'run_agent', 'open_estimate', 'open_customer', 'compose_message', 'noop'] },
            payload: { type: 'object' },
            why: { type: 'string' },
            recommended: { type: 'boolean' },
          },
        },
      },
    },
  },
};

const EXTRACT_TOOL = {
  name: 'extract_entities',
  description: 'Pull structured entities + intent from the operator message. Always call this — return what you can; flag confidence low if unclear. Drives auto-routing + note attachment.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intent', 'confidence', 'urgency'],
    properties: {
      customer_name: { type: 'string', description: 'Customer name as the operator referenced it. Empty if no specific customer.' },
      estimate_ref: { type: 'string', description: 'Estimate ref like "PU-1234" if quoted.' },
      intent: { type: 'string', enum: INTENT_SLUGS, description: 'Best canonical intent. Use unknown if no clear intent.' },
      urgency: { type: 'string', enum: ['normal', 'urgent'], description: 'urgent only when operator said urgent / asap / today / right now / emergency.' },
      confidence: { type: 'number', minimum: 0, maximum: 1, description: '0.7+ triggers auto-routing. Weighs both entity + intent certainty.' },
    },
  },
};

async function loadObservations(tenantId, pillarSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const obs = { briefing: [], kpis: [], latest_run: null };
  const briefing = await supabaseAdmin
    .from('briefing_items')
    .select('priority, title, body, source_agent, created_at')
    .eq('tenant_id', tenantId).eq('source_agent', pillarSlug).eq('for_date', today).is('dismissed_at', null)
    .order('priority', { ascending: true }).limit(20);
  if (!briefing.error) obs.briefing = briefing.data || [];
  const kpis = await supabaseAdmin
    .from('kpis').select('key, label, value, unit')
    .eq('tenant_id', tenantId).like('key', `${pillarSlug}.%`)
    .order('sort_order', { ascending: true }).limit(30);
  if (!kpis.error) obs.kpis = kpis.data || [];
  const latest = await supabaseAdmin
    .from('agent_runs').select('agent_slug, summary, started_at, status')
    .eq('tenant_id', tenantId).eq('agent_slug', pillarSlug)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
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
    lines.push(`### Today's briefing (${obs.briefing.length})`);
    for (const b of obs.briefing) lines.push(`- [${(b.priority || 'normal').toUpperCase()}] ${b.title}${b.body ? ` — ${b.body}` : ''}`);
    lines.push('');
  }
  if (obs.kpis.length) {
    lines.push(`### KPIs`);
    for (const k of obs.kpis) lines.push(`- ${k.label}: ${k.unit === '$' ? '$' : ''}${k.value}${k.unit && k.unit !== '$' ? ' ' + k.unit : ''}`);
    lines.push('');
  }
  if (lines.length === 0) return '(No observations available yet — cron may not have run today.)';
  return lines.join('\n');
}

async function resolveSessionUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token
    || (req.body?.token);
  if (!token) return null;
  const { data: session } = await supabaseAdmin
    .from('sessions').select('user_id, expires_at').eq('token', token).maybeSingle();
  if (!session || new Date(session.expires_at) < new Date()) return null;
  const { data: user } = await supabaseAdmin
    .from('users').select('id, name, email, role').eq('id', session.user_id).maybeSingle();
  return user || null;
}

async function persistConversation({ tenantId, conversationId, userId, pillar, history, userMsg, assistantPayload }) {
  const turn = [
    { role: 'user', content: userMsg, ts: Date.now() },
    { role: 'assistant', content: assistantPayload.reply, ts: Date.now(), proposed_actions: assistantPayload.proposed_actions || [], extracted: assistantPayload.extracted || null, auto_routed: assistantPayload.auto_routed || [] },
  ];
  const messages = [...(history || []), ...turn];
  const title = (userMsg || 'agent chat').slice(0, 80);

  if (conversationId) {
    const { data, error } = await supabaseAdmin
      .from('chat_conversations')
      .update({ messages, title, updated_at: new Date().toISOString() })
      .eq('id', conversationId).eq('tenant_id', tenantId)
      .select('id').maybeSingle();
    if (!error && data?.id) return data.id;
  }
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .insert({ tenant_id: tenantId, user_id: userId, title, messages, metadata: { pillar } })
    .select('id').single();
  if (error) return null;
  return data.id;
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
  const conversationId = body.conversation_id || null;

  const pillarConfig = resolvePillar(pillarSlug);
  if (!pillarConfig) return res.status(400).json({ error: `unknown pillar: ${pillarSlug}` });
  if (!message) return res.status(400).json({ error: 'message required' });

  const me = await resolveSessionUser(req);
  const obs = await loadObservations(req.tenant.id, pillarSlug);
  const observationsText = formatObservations(obs);

  const system = `${pillarConfig.persona_prompt}

You are responding to ${me?.name || 'an operator'} (role: ${me?.role || 'unknown'}) on Ryujin OS. Use BOTH tools each turn:
1. record_response — your reply + up to 4 proposed actions
2. extract_entities — pull customer / intent / urgency / confidence

## Observations
${observationsText}

## Action vocabulary (record_response.proposed_actions[].kind)
- navigate_to: { url }
- send_email: { to, subject?, body }
- send_sms: { to, subject?, body } — ONLY between 07:00 and 19:00 local time. The current hour is ${new Date().getHours()}. Outside that window, ALWAYS use compose_message instead.
- create_quest: { title, description, priority }
- run_agent: { agent_slug }
- open_estimate: { estimate_id }
- open_customer: { customer_id }
- compose_message: { to_user, body, subject? } — internal Ryujin DM, the default for quiet hours
- noop: when no action fits

Mark the single best option recommended:true. Never invent customers / estimates / dollars.

## Intent vocabulary (extract_entities.intent)
The system auto-routes to the right teammate when confidence ≥ 0.7. Pick from:
${INTENT_SLUGS.join(', ')}.
Use 'unknown' if no clear canonical intent. Confidence weighs both entity certainty AND intent certainty — if the operator named a customer but the intent is fuzzy, cap confidence at 0.6.`;

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
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [ACTION_TOOL, EXTRACT_TOOL],
        tool_choice: { type: 'any' },
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
  const responseBlock = (j.content || []).find(c => c.type === 'tool_use' && c.name === 'record_response');
  const extractBlock = (j.content || []).find(c => c.type === 'tool_use' && c.name === 'extract_entities');
  if (!responseBlock?.input) return res.status(502).json({ error: 'Claude did not call record_response', raw: j });

  const reply = responseBlock.input.reply;
  const proposed_actions = responseBlock.input.proposed_actions || [];
  const extracted = extractBlock?.input || { intent: 'unknown', urgency: 'normal', confidence: 0 };

  // Resolve entities + attach notes + auto-route.
  let resolvedCustomer = null;
  let resolvedEstimate = null;
  let auto_routed = [];

  if (extracted.customer_name) {
    resolvedCustomer = await resolveCustomer(req.tenant.id, extracted.customer_name);
  }
  if (extracted.estimate_ref) {
    resolvedEstimate = await resolveEstimate(req.tenant.id, extracted.estimate_ref);
  }
  if (!resolvedCustomer && resolvedEstimate?.customer_id) {
    const { data: c } = await supabaseAdmin.from('customers').select('id, full_name').eq('id', resolvedEstimate.customer_id).maybeSingle();
    if (c) resolvedCustomer = { customer_id: c.id, full_name: c.full_name, confidence: 0.6 };
  }

  const overallConfidence = Math.min(extracted.confidence || 0, resolvedCustomer ? resolvedCustomer.confidence : 1);
  if (resolvedCustomer && overallConfidence >= NOTE_CONFIDENCE) {
    await attachNoteToEntity({
      tenantId: req.tenant.id, userId: me?.id || null,
      entityType: 'customer', entityId: resolvedCustomer.customer_id,
      action: 'agent_note',
      details: { source: 'agent_chat', pillar: pillarSlug, operator_message: message, agent_reply: reply, intent: extracted.intent, urgency: extracted.urgency, confidence: overallConfidence },
    });
  }
  if (resolvedEstimate) {
    await attachNoteToEntity({
      tenantId: req.tenant.id, userId: me?.id || null,
      entityType: 'estimate', entityId: resolvedEstimate.estimate_id,
      action: 'agent_note',
      details: { source: 'agent_chat', pillar: pillarSlug, operator_message: message, intent: extracted.intent },
    });
  }

  if (
    extracted.intent && extracted.intent !== 'unknown'
    && overallConfidence >= AUTO_ROUTE_CONFIDENCE
    && me?.id
  ) {
    const r = await routeIntent({
      tenantId: req.tenant.id,
      intent: extracted.intent,
      urgency: extracted.urgency,
      fromUserId: me.id,
      fromLabel: `${me.name}'s ${pillarSlug} agent`,
      refs: {
        customer_id: resolvedCustomer?.customer_id || null,
        customer_name: resolvedCustomer?.full_name || extracted.customer_name || null,
        estimate_id: resolvedEstimate?.estimate_id || null,
      },
      operatorMessage: message,
      conversationId,
      sourcePillar: pillarSlug,
    });
    if (r.ok) auto_routed = r.routed_to.map(rt => ({ ...rt, intent: extracted.intent, message_ids: r.message_ids, thread_id: r.thread_id }));
  }

  const persistedConvId = await persistConversation({
    tenantId: req.tenant.id, conversationId, userId: me?.id || null, pillar: pillarSlug,
    history, userMsg: message,
    assistantPayload: { reply, proposed_actions, extracted, auto_routed },
  });

  const archetype = archetypeOf(pillarSlug);
  return res.status(200).json({
    reply,
    proposed_actions,
    extracted: { ...extracted, resolved_customer: resolvedCustomer, resolved_estimate: resolvedEstimate },
    auto_routed,
    archetype: archetype ? {
      name: pillarConfig.name,
      accent_color: archetype.accent_color,
      avatar_video: archetype.avatar_video,
      avatar_poster: archetype.avatar_poster,
    } : null,
    pillar: pillarSlug,
    conversation_id: persistedConvId,
    latency_ms: latencyMs,
    model: MODEL,
  });
}

async function gatedHandler(req, res) {
  const pillarSlug = (req.body || {}).pillar;
  if (!pillarSlug) return res.status(400).json({ error: 'pillar required in body' });
  const gate = requirePillar(pillarSlug);
  return gate(handler)(req, res);
}

export default requireTenant(gatedHandler);
