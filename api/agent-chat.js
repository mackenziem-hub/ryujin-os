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

// ─── Observation helpers ─────────────────────────────────────────
// Each returns a plain-text block (string). Empty string means
// "no relevant data found" or "this feed errored" — by design,
// a single feed outage never blocks the chat.

async function loadCoreObservations(tenantId, pillarSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const out = { briefing: [], kpis: [], latest_run: null };
  try {
    const [b, k, l] = await Promise.all([
      supabaseAdmin.from('briefing_items')
        .select('priority, title, body, source_agent, created_at')
        .eq('tenant_id', tenantId).eq('source_agent', pillarSlug).eq('for_date', today).is('dismissed_at', null)
        .order('priority', { ascending: true }).limit(20),
      supabaseAdmin.from('kpis').select('key, label, value, unit')
        .eq('tenant_id', tenantId).like('key', `${pillarSlug}.%`)
        .order('sort_order', { ascending: true }).limit(30),
      supabaseAdmin.from('agent_runs').select('agent_slug, summary, started_at, status')
        .eq('tenant_id', tenantId).eq('agent_slug', pillarSlug)
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (!b.error) out.briefing = b.data || [];
    if (!k.error) out.kpis = k.data || [];
    if (!l.error && l.data) out.latest_run = l.data;
  } catch { /* fail-open */ }
  return out;
}

async function loadScheduleObservations(tenantId) {
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 86400000);
    const [ests, tix] = await Promise.all([
      // estimates.scheduled_at (added in migration_038) — timestamptz of
      // when the job is on the calendar. Not scheduled_start_date.
      supabaseAdmin.from('estimates')
        .select('id, estimate_number, scheduled_at, state, customer:customers(full_name)')
        .eq('tenant_id', tenantId)
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', now.toISOString())
        .lte('scheduled_at', horizon.toISOString())
        .order('scheduled_at', { ascending: true }).limit(8),
      supabaseAdmin.from('service_tickets')
        .select('id, title, scheduled_at, priority, customer:customers(full_name)')
        .eq('tenant_id', tenantId)
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', now.toISOString())
        .lte('scheduled_at', horizon.toISOString())
        .order('scheduled_at', { ascending: true }).limit(8),
    ]);
    const items = [
      ...(ests.data || []).map(e => ({
        when: e.scheduled_at?.slice(0, 10),
        label: `Install · ${e.customer?.full_name || ''} · ${e.estimate_number || e.id.slice(0, 6)}${e.state ? ` (${e.state})` : ''}`,
      })),
      ...(tix.data || []).map(t => ({
        when: t.scheduled_at?.slice(0, 10),
        label: `${(t.priority === 'urgent' || t.priority === 'high') ? '⚠ ' : ''}Service · ${t.customer?.full_name || ''} · ${t.title}`,
      })),
    ].sort((a, b) => (a.when || '').localeCompare(b.when || '')).slice(0, 8);
    if (!items.length) return '';
    return `### Scheduled in the next 7 days\n${items.map(i => `- ${i.when} — ${i.label}`).join('\n')}\n`;
  } catch { return ''; }
}

async function loadInboxObservations(tenantId, { userId, isAdmin }) {
  try {
    let q = supabaseAdmin.from('messages')
      .select('subject, body, from_label, from_user_id, to_user_id, created_at')
      .eq('tenant_id', tenantId)
      .is('read_at', null)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('created_at', { ascending: false }).limit(10);
    if (!isAdmin && userId) q = q.eq('to_user_id', userId);
    const { data, error } = await q;
    if (error || !data?.length) return '';
    const lines = data.map(m => {
      const when = m.created_at?.slice(0, 16).replace('T', ' ');
      const from = m.from_label || (m.from_user_id ? 'teammate' : 'agent');
      const subject = m.subject ? ` — ${m.subject}` : '';
      const body = (m.body || '').slice(0, 140);
      return `- ${when} · from ${from}${subject}${body ? ` · "${body}${m.body?.length > 140 ? '…' : ''}"` : ''}`;
    });
    const scope = isAdmin ? 'team-wide' : 'yours';
    return `### Unread internal messages (${scope}, ${data.length})\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

async function loadVoiceObservations(tenantId, { userId, isAdmin }) {
  try {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    // Real column names (per migration_055 + migration_056):
    //   voice_memos.uploader_user_id  +  voice_memos.transcription
    //   phone_calls.from_user_id / to_user_id  +  phone_calls.transcript
    const [memos, calls] = await Promise.all([
      supabaseAdmin.from('voice_memos')
        .select('uploader_user_id, transcription, created_at')
        .eq('tenant_id', tenantId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(6),
      supabaseAdmin.from('phone_calls')
        .select('from_user_id, to_user_id, from_phone, direction, status, duration_sec, started_at, customer:customers(full_name)')
        .eq('tenant_id', tenantId).gte('started_at', since)
        .order('started_at', { ascending: false }).limit(6),
    ]);
    // phone_calls has no `transcript` column — transcripts live in
    // voice_memos via voice_memo_id. The memos block above already
    // surfaces them. The call block just notes who/when/duration.
    const items = [
      ...(memos.data || []).filter(m => isAdmin || m.uploader_user_id === userId).map(m => ({
        when: m.created_at,
        label: `Voice memo · "${(m.transcription || '(transcribing)').slice(0, 200)}${m.transcription?.length > 200 ? '…' : ''}"`,
      })),
      ...(calls.data || []).filter(c => isAdmin || c.from_user_id === userId || c.to_user_id === userId).map(c => ({
        when: c.started_at,
        label: `Call ${c.direction || ''} ${c.status || ''} · ${c.customer?.full_name || c.from_phone || 'unknown'}${c.duration_sec ? ` · ${c.duration_sec}s` : ''}`,
      })),
    ].sort((a, b) => (b.when || '').localeCompare(a.when || '')).slice(0, 6);
    if (!items.length) return '';
    return `### Voice activity (last 24h)\n${items.map(i => `- ${i.when?.slice(0, 16).replace('T', ' ')} — ${i.label}`).join('\n')}\n`;
  } catch { return ''; }
}

async function loadServiceQueueObservations(tenantId) {
  try {
    const { data, error } = await supabaseAdmin.from('service_tickets')
      .select('id, title, priority, status, customer:customers(full_name)')
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'in_progress'])
      .order('priority', { ascending: true }).limit(20);
    if (error || !data?.length) return '';
    const counts = { urgent: 0, high: 0, normal: 0, total: data.length };
    for (const t of data) counts[t.priority] = (counts[t.priority] || 0) + 1;
    const top = data.filter(t => t.priority === 'urgent' || t.priority === 'high').slice(0, 3);
    const head = `### Service queue (${counts.total} open · ${counts.urgent || 0} urgent · ${counts.high || 0} high)`;
    if (!top.length) return head + '\n';
    const lines = top.map(t => `- [${t.priority.toUpperCase()}] ${t.title}${t.customer?.full_name ? ` (${t.customer.full_name})` : ''}`);
    return `${head}\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

async function loadActivityObservations(tenantId, { userId, isAdmin }) {
  try {
    // activity_log schema (per schema/migrations.sql):
    //   user_id, entity_type, entity_id, action, details (jsonb), created_at
    // No FK to customers — entity_type='customer' acts as discriminator.
    let q = supabaseAdmin.from('activity_log')
      .select('user_id, entity_type, entity_id, action, details, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', new Date(Date.now() - 12 * 3600000).toISOString())
      .order('created_at', { ascending: false }).limit(10);
    if (!isAdmin && userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error || !data?.length) return '';
    const lines = data.map(a => {
      const when = a.created_at?.slice(11, 16);
      const detailSnip = a.details ? JSON.stringify(a.details).slice(0, 80).replace(/[{}"]/g, '') : '';
      return `- ${when} · ${a.action} ${a.entity_type}${detailSnip ? ` · ${detailSnip}` : ''}`;
    });
    return `### Recent activity (last 12h)\n${lines.join('\n')}\n`;
  } catch { return ''; }
}

async function loadObservations(tenantId, pillarSlug, opts = {}) {
  const t0 = Date.now();
  const [core, schedule, inbox, voice, service, activity] = await Promise.all([
    loadCoreObservations(tenantId, pillarSlug),
    loadScheduleObservations(tenantId),
    loadInboxObservations(tenantId, opts),
    loadVoiceObservations(tenantId, opts),
    loadServiceQueueObservations(tenantId),
    loadActivityObservations(tenantId, opts),
  ]);
  console.log(`[agent-chat] observations loaded in ${Date.now() - t0}ms (pillar=${pillarSlug}, admin=${opts.isAdmin ? 1 : 0})`);
  return { core, schedule, inbox, voice, service, activity };
}

function formatObservations(obs) {
  const out = [];
  // Core (briefing + KPIs + latest run) — pillar-specific
  const c = obs.core || {};
  if (c.latest_run?.summary) { out.push('### Latest agent run'); out.push(c.latest_run.summary); out.push(''); }
  if (c.briefing?.length) {
    out.push(`### Today's briefing (${c.briefing.length})`);
    for (const b of c.briefing) out.push(`- [${(b.priority || 'normal').toUpperCase()}] ${b.title}${b.body ? ` — ${b.body}` : ''}`);
    out.push('');
  }
  if (c.kpis?.length) {
    out.push('### KPIs');
    for (const k of c.kpis) out.push(`- ${k.label}: ${k.unit === '$' ? '$' : ''}${k.value}${k.unit && k.unit !== '$' ? ' ' + k.unit : ''}`);
    out.push('');
  }
  // Cross-pillar feeds — each block is already self-titled with ### so just append.
  for (const block of [obs.schedule, obs.inbox, obs.voice, obs.service, obs.activity]) {
    if (block) out.push(block);
  }
  if (out.length === 0) return '(No observations available yet — cron may not have run today.)';
  return out.join('\n').trimEnd();
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
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const obs = await loadObservations(req.tenant.id, pillarSlug, {
    userId: me?.id || null,
    isAdmin,
  });
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

EXPLAINABILITY: every proposed_actions[] entry MUST include a non-empty 'why' (one short sentence, max 18 words) that cites the SPECIFIC observation triggering the suggestion — e.g. "Patricia replied 4 days ago, no follow-up logged" or "Estimate PU-1234 sits in 'sent' for 11 days." If you cannot tie an action to a concrete observation, drop the action. No vague justifications like "good idea" or "high impact" — the operator reads 'why' to decide whether to trust the action.

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
