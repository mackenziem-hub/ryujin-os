// Ryujin OS - Ad Script Studio generator (AI-drafted, shoot-ready ad scripts in Mac's voice).
//
// POST /api/ad-scripts-generate { offer, angle, length? }
//   -> generates a shoot-ready ad script in the Plus Ultra creative voice and returns it
//      as an HTML fragment ready to drop straight into the WYSIWYG ad-script editor.
//
// Grounding (best-effort): pulls the tenant's existing 'reference' ad-script rows
// (block_key 'adscript:%', content.kind==='reference') that mention the offer and feeds
// the winning copy as context. Never fails the request if that lookup misfires.
//
// Auth: requireTenant (resolves tenant) + a privileged session, same posture as ad-scripts.js.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const PREFIX = 'adscript:';
const LENGTHS = ['short', 'standard', 'long'];

const LENGTH_GUIDE = {
  short: 'Keep it tight for a 15-20 second cut. One concept, one hook, a 2 paragraph VO, 3-4 b-roll shots.',
  standard: 'Aim for a 30-45 second cut. One concept, two hook options, a 2-3 paragraph VO, 4-6 b-roll shots.',
  long: 'Aim for a 60-75 second cut. One concept, two hook options, a 3-4 paragraph VO, 6-8 b-roll shots.',
};

const SYSTEM = `You are the in-house creative director for Plus Ultra Roofing, writing a shoot-ready ad script in the voice of Mackenzie, the owner. Plus Ultra is a third-generation Moncton roofing family serving Greater Moncton, New Brunswick. The company is CertainTeed certified.

HARD RULES (these are non-negotiable doctrine, never break one):
- Positive framing ONLY. State the benefit and the outcome. Never use "no X / no Y" framing, never define the offer by what it is NOT, never open with "don't", "stop", or "avoid".
- Never bash salespeople or the replace / replacement process. Present a roof replacement as a legitimate, good outcome when it is the right call.
- Lead with the benefit and the outcome, not the process or the mechanics.
- Always work in the "third-generation roofing family" or "third-generation Moncton roofer" line, and always include a why-now (booking into the season, the season fills up, get on the schedule).
- NO em dashes anywhere. Use periods, commas, parentheses, or hyphens instead.
- Plain-spoken owner voice. Concrete, grounded, confident, never hypey. Mackenzie talks straight: "I'll tell you straight if yours isn't a fit." First person from the owner is good.
- Use 5-star or Google review proof where it lands naturally.
- This is built for Facebook first, Instagram second. Write for a Facebook feed.

OUTPUT FORMAT (absolute):
- Return ONLY a raw HTML fragment. No markdown, no code fences, no backticks, no commentary before or after.
- Use EXACTLY this structure and these tags, filled for the given offer and angle:
<h3>Concept</h3><p>...</p>
<h3>Hook</h3><p><mark class="hl-hook">FIRST HOOK LINE</mark></p><p><mark class="hl-hook">ALT HOOK LINE</mark></p>
<h3>On-screen text</h3><ul><li>0-3s: ...</li><li>...</li></ul>
<h3>VO script</h3><blockquote>the spoken script, 2-4 short paragraphs</blockquote>
<h3>B-roll</h3><ul><li>SHOT: ...</li><li>...</li></ul>
<h3>End card + CTA</h3><p>...</p>
<h3>Meta caption</h3><p><strong>Headline:</strong> ...</p><p><strong>Primary text:</strong> <mark class="hl-benefit">one key benefit line</mark> ...</p>
- Wrap the single strongest benefit sentence anywhere in the script in <mark class="hl-benefit">. Use it exactly once.
- Wrap each hook line in <mark class="hl-hook">.
- Keep everything tight and shoot-ready. A crew should be able to film it from the page.`;

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFences(text) {
  let t = String(text || '').trim();
  // Drop a leading ```html / ``` fence and a trailing ``` fence if the model added them.
  t = t.replace(/^```(?:html)?\s*/i, '');
  t = t.replace(/\s*```$/i, '');
  return t.trim();
}

// Best-effort: pull reference copy on file for this offer to ground the draft. Never throws.
async function gatherReferenceCopy(tenantId, offer) {
  try {
    const { data } = await supabaseAdmin
      .from('proposal_blocks')
      .select('name, content')
      .eq('tenant_id', tenantId)
      .like('block_key', `${PREFIX}%`);
    const needle = String(offer || '').toLowerCase().trim();
    const matches = [];
    for (const row of data || []) {
      const c = (row.content && typeof row.content === 'object') ? row.content : {};
      if (c.kind !== 'reference') continue;
      const html = typeof c.html === 'string' ? c.html : '';
      const hay = `${row.name || ''} ${html}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      const plain = stripTags(html).slice(0, 400);
      if (plain) matches.push(plain);
      if (matches.length >= 4) break;
    }
    return matches;
  } catch {
    return [];
  }
}

async function callAnthropic(apiKey, system, user) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    system,
    messages: [{ role: 'user', content: user }],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    });
    if (response.ok) {
      try { return { ok: true, json: await response.json() }; }
      catch (e) { return { ok: false, status: 502, detail: 'bad ai response body: ' + e.message }; }
    }
    if ((response.status === 429 || response.status === 529) && attempt < 1) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 4000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    return { ok: false, status: response.status, detail: await response.text() };
  }
  return { ok: false, status: 502, detail: 'no response' };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Privileged gate; tenant from the SESSION, never the client x-tenant-id header.
  const session = await resolveSession(req);
  if (!isPrivileged(session)) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id;

  const b = req.body || {};
  const offer = typeof b.offer === 'string' ? b.offer.trim() : '';
  const angle = typeof b.angle === 'string' ? b.angle.trim() : '';
  if (!offer || !angle) {
    return res.status(400).json({ error: 'offer and angle are required' });
  }
  const length = LENGTHS.includes(b.length) ? b.length : 'standard';

  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({ error: 'ai_unavailable', detail: 'ANTHROPIC_API_KEY not set' });
  }

  const references = await gatherReferenceCopy(tenantId, offer);

  let user = `Offer: ${offer}\nCreative angle: ${angle}\nLength: ${length}. ${LENGTH_GUIDE[length]}\n\n`;
  if (references.length) {
    user += 'WINNING COPY ON FILE (use as voice and angle reference, do not copy verbatim):\n';
    references.forEach((r, i) => { user += `${i + 1}. ${r}\n`; });
    user += '\n';
  }
  user += `Write the shoot-ready ad script now. Return ONLY the HTML fragment in the exact structure from your instructions, filled for this offer and angle.`;

  const result = await callAnthropic(apiKey, SYSTEM, user);
  if (!result.ok) {
    return res.status(502).json({ error: 'ai_error', detail: result.detail });
  }

  const j = result.json;
  const text = stripFences(
    (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim()
  );
  if (!text) {
    return res.status(502).json({ error: 'ai_error', detail: 'empty response' });
  }

  return res.json({ title: `${offer}: ${angle}`.slice(0, 120), html: text });
}

export default requireTenant(handler);
