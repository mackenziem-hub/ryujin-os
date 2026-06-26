// Ryujin OS - the Inbox OS dispatcher.
// ----------------------------------------------------------------------------
// A crew member types a need in plain language ("I need materials for 15 Bissett")
// and the OS classifies the intent (Haiku) and routes it to the right people via
// the existing routing engine (messages + quests + briefing items per recipient),
// confirmation-first through Cat (the routingMap copies her on crew requests).
// Read step is just NLU; the deterministic routingMap decides WHO, so the model
// never freelances the recipients.
//
//   POST /api/os-dispatch  (crew/any session)  { message }
//     -> { ok, intent, urgency, routed_to:[{user_id,name,reason}], note? }
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { routeIntent } from '../lib/router.js';

const MODEL = 'claude-haiku-4-5';

// The crew-facing intents the dispatcher routes. Tight set = reliable classify.
const CREW_INTENTS = [
  'material_request', 'repair_request', 'inspection_request', 'install_reschedule',
  'crew_dispatch_change', 'equipment_issue', 'paysheet_question', 'warranty_claim',
  'complex_job_consult', 'customer_complaint', 'question', 'unknown',
];

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

async function classify(message) {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) return { intent: 'unknown', urgency: 'normal', summary: '' };
  const system = `You classify a roofing crew member's message into ONE intent slug + an urgency.
Intents: ${CREW_INTENTS.join(', ')}.
Guide: material_request = needs materials/supplies/an order. repair_request = a repair or callback. inspection_request = an inspection or measure. install_reschedule = move a job's date. crew_dispatch_change = a crew or on-site scheduling change. equipment_issue = a tool/equipment problem. paysheet_question = a pay question. warranty_claim = warranty. complex_job_consult = wants Mac's input on a tricky job. customer_complaint = an upset customer. question = a general question with no clear single owner. unknown = none of these.
urgency = "urgent" ONLY for safety, a stop-work issue, or an upset customer on site; otherwise "normal".
Return ONLY compact JSON: {"intent":"<slug>","urgency":"normal|urgent","summary":"<=8 words"}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 120, system, messages: [{ role: 'user', content: String(message).slice(0, 500) }] }),
      signal: AbortSignal.timeout(12000),
    });
    const j = await r.json().catch(() => null);
    const text = j && j.content && j.content[0] && j.content[0].text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { intent: 'unknown', urgency: 'normal', summary: '' };
    const p = JSON.parse(m[0]);
    return {
      intent: CREW_INTENTS.includes(p.intent) ? p.intent : 'unknown',
      urgency: p.urgency === 'urgent' ? 'urgent' : 'normal',
      summary: String(p.summary || '').slice(0, 80),
    };
  } catch {
    return { intent: 'unknown', urgency: 'normal', summary: '' };
  }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);
  const message = String(body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });

  const { intent, urgency, summary } = await classify(message);
  if (intent === 'unknown') {
    return res.json({
      ok: true, intent: 'unknown', routed_to: [],
      note: 'I could not tell who should handle that. Try naming it (materials, a repair, an inspection, an equipment problem), or use a direct message.',
    });
  }

  const r = await routeIntent({
    tenantId: req.tenant.id,
    intent,
    urgency,
    fromUserId: req.session.user_id,
    fromLabel: req.session.name,
    operatorMessage: message,
    sourcePillar: 'crew_inbox',
  });
  if (!r.ok) return res.status(500).json({ error: r.error || 'routing failed' });

  return res.json({
    ok: true,
    intent,
    urgency,
    summary,
    routed_to: r.routed_to || [],
    note: (r.routed_to && r.routed_to.length) ? null : 'Logged it, but no one was matched to route to.',
  });
}

export default requirePortalSessionAndTenant(handler);
