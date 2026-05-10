// Manus product-audit primitive.
//
// Fires a Manus task pointed at a deployed URL. Manus opens it in its
// browser, navigates as a customer would, and returns a typed verdict
// of what's broken / overlapping / unclear / sellable. Different from
// lib/peer_review.js (Claude API code review) — this is the outside-agent
// "use the actual product" pass that catches UX issues code review can't see.
//
// Usage:
//   import { auditUrl } from './lib/manus_audit.js';
//   const result = await auditUrl({
//     url: 'https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-52',
//     focus: 'customer-facing roofing proposal — flow, mobile, clarity',
//   });
//
// Cost: ~$0.50–$2.50 per audit on Mac's $60/mo (12K credit) Manus plan.
// Wall-clock: 3–8 minutes per audit (Manus drives the browser, takes time).

const MANUS_BASE = 'https://api.manus.ai';

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessment: {
      type: 'string',
      enum: ['ship-ready', 'minor-polish', 'needs-work', 'not-shippable'],
      description: 'Overall ship-readiness verdict.',
    },
    summary: {
      type: 'string',
      description: 'Plain-English summary of what you found, 2-4 sentences.',
    },
    blockers: {
      type: 'array',
      description: 'Issues that prevent shipping. Each must include where on the page (selector or visual location), what is wrong, and what to change.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: ['ui_break', 'overlap', 'dead_click', 'broken_link', 'mobile_overflow', 'copy_misleading', 'data_wrong', 'flow_confusing', 'accessibility', 'performance'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium'] },
          location: { type: 'string', description: 'Where on the page (e.g., "hero CTA", "footer links", "mobile 375px viewport — package cards", "sticky bottom bar").' },
          description: { type: 'string', description: 'What is wrong. Be specific. Quote the visible text or describe the element.' },
          evidence: { type: 'string', description: 'REQUIRED verifiable artifact. Must contain at least one of: (a) HTTP status quote ("GET /api/x returned 500"), (b) console message exact text, (c) DOM measurement with selector ("card.layer-card:nth-child(3) is 142px tall, siblings are 120px"), (d) URL + observed behavior, (e) exact visible-text copy-paste. If you cannot produce verifiable evidence, demote this finding to polish or omit it.' },
          fix: { type: 'string', description: 'Concrete fix recommendation. Be specific.' },
        },
        required: ['category', 'severity', 'location', 'description', 'evidence', 'fix'],
      },
    },
    polish: {
      type: 'array',
      description: 'Smaller improvements that would raise quality. Optional — empty array if nothing meaningful.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          description: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['location', 'description', 'fix'],
      },
    },
    strengths: {
      type: 'array',
      description: 'Things that genuinely work well — worth preserving when iterating. Empty array if nothing notable.',
      items: { type: 'string' },
    },
  },
  required: ['assessment', 'summary', 'blockers', 'polish', 'strengths'],
};

/**
 * Fire a Manus product audit and wait for the typed verdict.
 * @param {object} opts
 * @param {string} opts.url — the deployed URL to audit
 * @param {string} opts.focus — one-line description of what to focus on (e.g., "customer-facing proposal flow, desktop + mobile")
 * @param {string} [opts.context] — extra context (intended audience, what we just changed, etc.)
 * @param {'manus-1.6'|'manus-1.6-lite'|'manus-1.6-max'} [opts.profile='manus-1.6'] — model tier
 * @param {string} [opts.projectId] — Manus project_id; project's persistent instruction is auto-prepended
 * @param {number} [opts.pollIntervalMs=10000] — poll interval
 * @param {number} [opts.maxWaitMs=600000] — max wall time (default 10 min)
 * @param {string} [opts.apiKey] — override env var
 * @returns {Promise<{ok, assessment, summary, blockers, polish, strengths, taskId, taskUrl, elapsedMs, error?}>}
 */
export async function auditUrl({
  url,
  focus,
  context,
  profile = 'manus-1.6',
  projectId,
  pollIntervalMs = 10000,
  maxWaitMs = 600000,
  apiKey,
} = {}) {
  const start = Date.now();
  const key = apiKey || process.env.MANUS_API_KEY;
  if (!key) return { ok: false, error: 'MANUS_API_KEY not set', elapsedMs: 0 };
  if (!url) return { ok: false, error: 'url required', elapsedMs: 0 };
  if (!focus) return { ok: false, error: 'focus required', elapsedMs: 0 };

  const H = { 'x-manus-api-key': key, 'content-type': 'application/json' };

  const prompt = [
    `Open this URL and audit it as if you were a real customer landing on this page for the first time:`,
    ``,
    `${url}`,
    ``,
    `Focus: ${focus}`,
    context ? `\nContext: ${context}` : '',
    ``,
    `Walk through the page. Click things. Try the interactive elements. Resize to mobile (375px) and check for overlap, cut-off text, broken stickies. Open DevTools console for JS errors.`,
    ``,
    `Then return your findings via the structured output. Verdict tiers:`,
    `- "ship-ready": polished, would not embarrass us in front of a paying customer`,
    `- "minor-polish": works well but a few cosmetic things to tighten`,
    `- "needs-work": has real flow / clarity / visual issues a customer would notice`,
    `- "not-shippable": broken or actively misleading; do not show to customers`,
    ``,
    `Be specific. "Layout is messy" is useless. "On mobile 375px, the package selector overlaps the sticky CTA bar by 18px" is useful. Quote visible text where relevant.`,
  ].filter(Boolean).join('\n');

  // 1) Create task
  let createRes;
  try {
    createRes = await fetch(`${MANUS_BASE}/v2/task.create`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        message: { content: [{ type: 'text', text: prompt }] },
        agent_profile: profile,
        interactive_mode: false,
        hide_in_task_list: false,
        title: `Product audit — ${focus.slice(0, 60)}`,
        structured_output_schema: AUDIT_SCHEMA,
        ...(projectId ? { project_id: projectId } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, error: `network on create: ${e.message}`, elapsedMs: Date.now() - start };
  }
  const created = await createRes.json().catch(() => ({}));
  if (!created.ok) {
    return { ok: false, error: `task.create failed: ${created.error?.message || JSON.stringify(created)}`, elapsedMs: Date.now() - start };
  }

  const taskId = created.task_id;
  const taskUrl = created.task_url;

  // 2) Poll listMessages until terminal
  let structured = null;
  let lastStatus = null;
  let pollCount = 0;
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    pollCount += 1;
    const r = await fetch(`${MANUS_BASE}/v2/task.listMessages?task_id=${taskId}&order=desc&limit=80`, { headers: H }).catch(() => null);
    if (!r || !r.ok) continue;
    const j = await r.json().catch(() => ({}));
    const events = j.messages || j.events || j.data || [];

    let status = null;
    for (const e of events) {
      if (!status && e.type === 'status_update' && e.agent_status) status = e.agent_status;
      if (!structured && e.type === 'structured_output_result') structured = e.structured_output_result || e;
    }
    if (status && status !== lastStatus) lastStatus = status;
    if (status === 'stopped' || status === 'error') break;
  }

  const elapsedMs = Date.now() - start;
  if (!structured) {
    return {
      ok: false,
      error: `no structured_output_result after ${pollCount} polls (status=${lastStatus})`,
      taskId,
      taskUrl,
      elapsedMs,
    };
  }
  if (structured.success === false) {
    return {
      ok: false,
      error: `structured output failed: ${structured.error || 'unknown'}`,
      taskId,
      taskUrl,
      elapsedMs,
    };
  }

  const value = structured.value || structured;
  return {
    ok: true,
    assessment: value.assessment,
    summary: value.summary,
    blockers: value.blockers || [],
    polish: value.polish || [],
    strengths: value.strengths || [],
    taskId,
    taskUrl,
    elapsedMs,
  };
}
