// Ryujin OS, Team OS Suggestions
//
// POST /api/team-suggest
//   Body: { lens?: 'gaps'|'delegation'|'hiring', focusPersonId?: '<personId>' }
//
// Returns: { ok, summary, suggestions: [{type,title,detail,who,function,priority}], model, latencyMs }
//
// Owner/admin only. Reads the tenant's team roster (tenant_settings.team_coverage),
// builds a PII-safe context (names + title/pillar/rung/reportsTo/owns/measuredBy/
// coverage roles + active only, NO emails, phones, or customer data) and asks
// Claude Haiku for structured org suggestions via a forced tool call (same pattern
// as lib/peer_review.js). On a missing key / API error it returns ok:false with an
// empty suggestions array so the board's panel degrades gracefully and the rest of
// the page keeps working. The team data itself is never blocked on this call.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { requireOwnerOrAdmin } from '../lib/auth-server.js';

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = 'claude-haiku-4-5-20251001';
const REQUEST_TIMEOUT_MS = 25000;

const LENS_FOCUS = {
  gaps: 'Find the structural gaps: functions or outcomes with no clear owner, single points of failure, people stretched across too many lanes, and rungs that are only partially covered.',
  delegation: 'Find what the owner (the person at the top, reportsTo null) is still doing that someone else on the roster could own, and who should take each piece. Bias toward freeing the owner into their highest-value seat.',
  hiring: 'Find the next role worth hiring for: which gap, when, and what outcome that hire would own. Distinguish a genuine hire from cross-training an existing person.',
};

const SYSTEM_PROMPT = `You are a business operations advisor for a small roofing company. You are given the company's team roster as structured data: each person has a name, title, pillar, buyback ladder rung (1 = admin, 5 = owner), who they report to, the outcomes they own, how they are measured, their coverage roles (primary/backup per function), and whether they are active.

The org runs on Dan Martell's Buy Back Your Time: every role exists to free the owner into the single highest-value seat (closing, pricing, hiring, systems, strategy). A rung is only "done" when one person owns the outcome end to end, not just the tasks.

Read the roster and record concrete, specific suggestions via the record_team_suggestions tool. Ground every suggestion in the actual data (name the real person and function). Do not invent people or facts not in the roster. Keep each suggestion short and actionable.

Style rules (mandatory):
- NO em dashes. Use a comma, period, or parentheses.
- Plain, direct language. No corporate filler ("leverage", "synergy", "circle back").
- Be specific: "Name a single delivery owner for measure-to-completion; Diego is closest" beats "improve operations".`;

const SUGGEST_TOOL = {
  name: 'record_team_suggestions',
  description: 'Record structured team/org suggestions. Always call this exactly once.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string', description: 'A 2 to 4 sentence plain-English read of the org as it stands.' },
      suggestions: {
        type: 'array',
        description: '3 to 6 concrete suggestions, most important first.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['gap', 'delegation', 'hiring', 'cross_train', 'risk'] },
            title: { type: 'string', description: 'Short headline, under ~70 chars.' },
            detail: { type: 'string', description: 'One to three sentences. Name the real person/function.' },
            who: { type: 'string', description: 'Person name this is about, or "new hire". Optional.' },
            function: { type: 'string', description: 'Affected function or pillar. Optional.' },
            priority: { type: 'string', enum: ['now', 'soon', 'later'] },
          },
          required: ['type', 'title', 'detail', 'priority'],
        },
      },
    },
    required: ['summary', 'suggestions'],
  },
};

// Strip em dashes / en dashes (and the common mojibake form) from model strings.
function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/—|–/g, ', ')
    .replace(/â€”/g, ', ')
    .replace(/â€“/g, ', ')
    .replace(/ ,/g, ',')
    .replace(/  +/g, ' ')
    .trim();
}

// Reduce a roster person to the PII-safe fields the model is allowed to see.
function safePerson(p) {
  return {
    name: p.nick && p.nick !== p.name ? `${p.name} (${p.nick})` : p.name,
    title: p.title || '',
    pillar: p.pillar || '',
    rung: p.rung ?? null,
    reportsTo: p.reportsTo || null,
    active: p.active !== false,
    owns: Array.isArray(p.owns) ? p.owns : [],
    measuredBy: Array.isArray(p.measuredBy) ? p.measuredBy : [],
    coverage: p.roles || {},
    external: !!p.external,
  };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'POST only', suggestions: [] });
  }

  // Owner/admin only: this reads the whole roster and returns delegation/hiring advice.
  const auth = await requireOwnerOrAdmin(req, res);
  if (!auth) return; // 401/403 already sent

  const body = req.body || {};
  const lens = LENS_FOCUS[body.lens] ? body.lens : 'gaps';
  const focusPersonId = body.focusPersonId ? String(body.focusPersonId) : null;

  // Load the roster (scoped to the authed session's tenant).
  const { data: settings, error } = await supabaseAdmin
    .from('tenant_settings')
    .select('team_coverage')
    .eq('tenant_id', auth.tenant_id)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message, suggestions: [] });

  const tc = settings?.team_coverage || {};
  const people = Array.isArray(tc.people) ? tc.people : [];
  if (!people.length) {
    return res.status(200).json({ ok: false, error: 'no_roster', summary: 'No team roster to analyze yet.', suggestions: [] });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(200).json({ ok: false, error: 'ai_unavailable', summary: '', suggestions: [] });
  }

  const focusName = focusPersonId ? (people.find(p => p.id === focusPersonId)?.name || null) : null;
  const context = {
    functions: tc.functions || [],
    people: people.map(safePerson),
  };
  const userText = [
    `Lens: ${lens}. ${LENS_FOCUS[lens]}`,
    focusName ? `Bias suggestions toward freeing up: ${focusName}.` : null,
    '',
    'Roster (JSON):',
    JSON.stringify(context),
  ].filter(Boolean).join('\n');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1600,
        system: SYSTEM_PROMPT,
        tools: [SUGGEST_TOOL],
        tool_choice: { type: 'tool', name: 'record_team_suggestions' },
        messages: [{ role: 'user', content: userText }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[team-suggest] anthropic', r.status, errText.slice(0, 200));
      return res.status(200).json({ ok: false, error: `ai_http_${r.status}`, summary: '', suggestions: [] });
    }
    const data = await r.json();
    const tool = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'record_team_suggestions');
    if (!tool) return res.status(200).json({ ok: false, error: 'no_tool_call', summary: '', suggestions: [] });

    const out = tool.input || {};
    const suggestions = (Array.isArray(out.suggestions) ? out.suggestions : []).map(s => ({
      type: s.type || 'gap',
      title: scrub(s.title),
      detail: scrub(s.detail),
      who: s.who ? scrub(s.who) : '',
      function: s.function ? scrub(s.function) : '',
      priority: ['now', 'soon', 'later'].includes(s.priority) ? s.priority : 'soon',
    }));
    return res.status(200).json({
      ok: true,
      lens,
      summary: scrub(out.summary),
      suggestions,
      model: MODEL,
      latencyMs: Date.now() - start,
    });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'ai_timeout' : `ai_error: ${e.message}`;
    return res.status(200).json({ ok: false, error: msg, summary: '', suggestions: [] });
  } finally {
    clearTimeout(t);
  }
}

export default requireTenant(handler);
