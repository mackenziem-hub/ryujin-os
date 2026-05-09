// Peer-review primitive — Claude API with forced structured output.
//
// Usage:
//   import { peerReview, LENSES } from './lib/peer_review.js';
//   const result = await peerReview({ artifact, lens: 'code' });
//   // { ok, verdict, summary, issues: [...], latencyMs, model }
//
// Pattern: a single tool (record_verdict) with a strict input_schema, and
// tool_choice forcing Claude to call it. Claude returns the verdict as
// the tool's input, which we read directly — no JSON parsing of prose.
//
// Lenses are system prompts. Add new ones in LENSES below.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const FAST_MODEL = 'claude-haiku-4-5-20251001';

export const LENSES = {
  code: {
    label: 'Code review',
    system: `You are a senior code reviewer. Read the artifact, find real issues, and record a verdict via the record_verdict tool.

Focus on: correctness, edge cases, error handling at boundaries, security (injection / auth / data exposure), and obvious performance traps. Skip stylistic nits unless they hide a bug.

Verdict rules:
- "pass" → ship it as-is
- "needs_changes" → real issues exist but the overall direction is sound
- "fail" → fundamental problems, do not ship

Issue severity:
- "error" → bug, security hole, or production risk
- "warning" → likely problem, edge case unhandled, fragile assumption
- "info" → noteworthy but not blocking

Be specific. "Add input validation" is useless. "Validate b !== 0 before division on line 2; throw RangeError" is useful.`,
  },

  'customer-copy': {
    label: 'Customer-facing copy review',
    system: `You are reviewing customer-facing copy for a roofing business (Plus Ultra Roofing). Check for: misleading claims, hidden fees framing, over-promising, jargon, condescending tone, and any line that exposes internal pricing mechanics (multipliers, per-SQ math, distance brackets).

Hard rules from this business:
- Never claim "no out-of-town add-ons" if the price already factors in distance
- Never expose multipliers, per-SQ rates, or engine internals
- Tone: confident, plain-spoken, no industry jargon
- Mobilization/lodging is bundled — frame as "no surprise charges added at signing"

Verdict:
- "pass" → send as-is
- "needs_changes" → fix the flagged lines, structure is fine
- "fail" → rewrite, current draft will damage trust

Quote the exact problem line in each issue's description.`,
  },

  pricing: {
    label: 'Pricing + scope review (Ryujin)',
    system: `You are auditing a Ryujin estimate for pricing/scope correctness against Plus Ultra canonical rules.

CANONICAL RULES — flag deviations:
- Sub paysheet rates v2.1: 4-6 SQ $130/SQ, 7-9 $160, 10-12 $190, 13+ $200
- Travel surcharge v2.2: linear $1/SQ × max(0, distance_km - 40). Stepped brackets ($20/$30) are deprecated.
- Margin lives in customer-facing labor pricing, not as a separate line
- Remediation row is OPT-IN per quote — never auto-applied. Acceptable when older home / discovered rot / customer-requested + documented.
- Multi-pitch jobs with planes[]: computeSubPaysheet routes PER PLANE (each plane uses its own SQ for bracket lookup, NOT the aggregate)
- Sub CREW PAY floor: $700/day. Never below. (Note: this protects sub crew minimums, NOT customer-facing price.)
- HST 15% NB default

BLESSED OVERRIDES — these tags mean OWNER-AUTHORIZED decisions, NOT process violations. Do NOT flag them as errors:
- 'pricing_locked_at_floor' — owner honored customer-facing price at a documented floor (e.g., honoring a 2024 quote, neighbor-rate honoring). Authorized.
- 'legacy_pricing_honored' — owner honoring a prior-year quote for a returning customer or referred neighbor. Authorized.
- 'neighbor_rate_<address>_<year>_<adjustment>' — pricing anchored to a known neighbor's prior job with explicit inflation adjustment. Authorized practice.
- 'price_to_sell' — owner-tier discretion for closeable competitive deals.
- 'ryan_pre_approval_confirmed' — sub-rate variance pre-approved by the sub. Informational.
- 'presented_in_person' — informational, not a process flag.
- Namespace tags (address:*, pipeline:*, sales_owner:*, source:*) — metadata only, never flag.

When a blessed tag is present, accept the customer-facing price as the owner's deliberate decision. Your job is then ONLY to verify:
  (a) sub crew pay (NOT customer price) still clears $700/day floor
  (b) calculations referenced in the artifact are arithmetically consistent
  (c) no fundamental scope error (zero sqft, missing planes, etc.)

NON-ISSUES — never flag:
- calculated_packages serialized in alphabetical order (diamond, gold, platinum). JSON quirk, not a presentation bug.
- absence of customer-facing breakdown lines in this artifact (the artifact summarizes engine state, not the customer-facing PDF)
- absence of distance_km when the artifact does not include it (distance can be set later or derived elsewhere)

REAL BUGS WORTH FLAGGING (severity error):
- top-level roof_area_sqft = 0 when planes[] sums to non-zero → broken denominator in per-SQ math
- per-SQ values inconsistent with (total ÷ SQ derived from planes sum)
- crew-pay-floor violation when summing per-plane sub paysheets
- distance_km recorded inconsistently with stated address
- redeck_sheets > 0 with no corresponding line item

Verdict rules:
- "pass" → math + scope check out, no real issues OR all surfaced concerns reduce to blessed overrides
- "needs_changes" → fixable miscalculations, missing rows, real rate drift, sqft/per-SQ inconsistencies
- "fail" → fundamental scope error, below-floor CREW PAY, broken denominator producing nonsense displays

Cite the violated rule + the actual value in each issue. When a blessed tag is present, explicitly note "owner-authorized via tag X — not flagged" rather than silently ignoring it.`,
  },
};

const VERDICT_TOOL = {
  name: 'record_verdict',
  description: 'Record a structured peer-review verdict. Always call this exactly once at the end of your review.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      verdict: {
        type: 'string',
        enum: ['pass', 'needs_changes', 'fail'],
        description: 'Overall verdict.',
      },
      summary: {
        type: 'string',
        description: 'One-paragraph plain-English summary of what you found. 2-4 sentences.',
      },
      issues: {
        type: 'array',
        description: 'Specific issues found, each with severity + actionable fix. Empty array if verdict is "pass".',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            severity: { type: 'string', enum: ['info', 'warning', 'error'] },
            description: { type: 'string', description: 'What is wrong. Quote the exact line/value.' },
            fix: { type: 'string', description: 'Concrete fix. Be specific.' },
          },
          required: ['severity', 'description', 'fix'],
        },
      },
    },
    required: ['verdict', 'summary', 'issues'],
  },
};

/**
 * Run a peer review against an artifact.
 * @param {object} opts
 * @param {string} opts.artifact - The thing to review (code, copy, pricing JSON, etc.)
 * @param {string} opts.lens - One of LENSES keys
 * @param {string} [opts.context] - Optional extra context (file path, customer name, etc.)
 * @param {'default'|'fast'} [opts.speed] - Pick model tier. Default = Sonnet, fast = Haiku.
 * @param {string} [opts.model] - Explicit model override (rare).
 * @param {string} [opts.apiKey] - Override env var.
 * @returns {Promise<{ok: boolean, verdict?: string, summary?: string, issues?: Array, latencyMs: number, model: string, error?: string}>}
 */
export async function peerReview({ artifact, lens, context, speed, model, apiKey } = {}) {
  const start = Date.now();
  const lensDef = LENSES[lens];
  if (!lensDef) {
    return { ok: false, error: `Unknown lens: ${lens}. Valid: ${Object.keys(LENSES).join(', ')}`, latencyMs: 0, model: '' };
  }
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY not set', latencyMs: 0, model: '' };

  const useModel = model || (speed === 'fast' ? FAST_MODEL : DEFAULT_MODEL);

  const userContent = context
    ? `Context: ${context}\n\n--- Artifact ---\n${artifact}`
    : artifact;

  const body = {
    model: useModel,
    max_tokens: 2048,
    system: lensDef.system,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'record_verdict' },
    messages: [{ role: 'user', content: userContent }],
  };

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `network: ${e.message}`, latencyMs: Date.now() - start, model: useModel };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 500)}`, latencyMs: Date.now() - start, model: useModel };
  }

  const json = await res.json();
  const toolBlock = (json.content || []).find(b => b.type === 'tool_use' && b.name === 'record_verdict');
  if (!toolBlock) {
    return { ok: false, error: 'Claude did not call record_verdict', latencyMs: Date.now() - start, model: useModel };
  }

  return {
    ok: true,
    verdict: toolBlock.input.verdict,
    summary: toolBlock.input.summary,
    issues: toolBlock.input.issues || [],
    latencyMs: Date.now() - start,
    model: useModel,
    usage: json.usage,
  };
}
