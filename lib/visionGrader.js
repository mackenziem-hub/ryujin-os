// Ryujin OS — Vision Showcase Grader
//
// The Generator picks photos for public Plus Ultra social posts. Metadata
// alone (megapixels, recency) cannot tell a finished, attractive roof from a
// worn "before" shot or a detail close-up, so the agent was posting bad
// photos captioned as showcase work (May 29 incident). This grader looks at
// the actual pixels with a Claude vision model and classifies each photo so
// selection can keep only genuine finished-work hero shots.
//
// gradeShowcase(imageUrl) -> { state, score, reason, model }
//   state: one of STATES below ('ungraded' on failure so callers can retry)
//   score: 0-10 showcase quality (composition / lighting / curb appeal), or null
//
// Cheap by design: Haiku vision, one image per call, 20s timeout. Callers
// should persist the result (media_pool.vision_state/score) so each photo is
// graded once, not every run.
const VISION_MODEL = 'claude-haiku-4-5-20251001';

// The single source of truth for what counts as postable. Only 'showcase'
// is eligible for a solo post; pairs require the AFTER photo to be 'showcase'.
export const STATES = ['showcase', 'before_or_worn', 'in_progress', 'detail', 'not_roof', 'ungraded'];
export const MATERIALS = ['asphalt', 'metal', 'flat', 'other', 'unknown'];
export const SHOWCASE_SCORE_FLOOR = 6; // solo singles must clear this

const PROMPT = `You grade photos for a roofing company's public social media (Facebook / Google).
The company wants to post ONLY finished, attractive completed-roof photos that make a homeowner think "I want my roof to look like that."

Look at the image and classify it into exactly ONE state:
- "showcase": a COMPLETED roof that looks clean, new, and attractive. A proud "look at our finished work" hero shot. The roof is the clear subject and it looks good.
- "before_or_worn": an old, worn, dirty, mossy, faded, curling, or damaged roof. A "before" condition. NOT something to brag about.
- "in_progress": mid-installation. Exposed underlayment/felt, partial shingles, materials or tools on the roof, tear-off in progress.
- "detail": an extreme close-up of one component (a vent, pipe boot, flashing, a few shingles, ridge cap). Useful for documentation, not a hero shot.
- "not_roof": not primarily a roof, or unusable: interior, a person, a truck, a document, blurry, dark, or otherwise not a clean roof photo.

Then rate "score" from 0-10 for how good this would look as a social post (composition, lighting, framing, curb appeal). A worn or in-progress roof can still be sharp, so score is about visual appeal as a brag-worthy post, independent of state.

Also identify "material" as one of: asphalt, metal, flat, other (use "unknown" if unclear).

Return ONLY strict JSON, no markdown, no preamble:
{"state":"<one of the five>","score":<0-10 integer>,"material":"<asphalt|metal|flat|other|unknown>","reason":"<one short sentence>"}`;

export async function gradeShowcase(imageUrl, { signal } = {}) {
  const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!ANTHROPIC_KEY) return { state: 'ungraded', score: null, reason: 'no ANTHROPIC_API_KEY', model: null };
  if (!imageUrl) return { state: 'ungraded', score: null, reason: 'no url', model: null };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return { state: 'ungraded', score: null, reason: `api ${r.status}: ${errText.slice(0, 120)}`, model: null };
    }
    const data = await r.json();
    const raw = (data?.content?.[0]?.text || '').trim();
    const parsed = parseGrade(raw);
    if (!parsed) return { state: 'ungraded', score: null, reason: `unparseable: ${raw.slice(0, 80)}`, model: VISION_MODEL };
    return { ...parsed, model: VISION_MODEL };
  } catch (e) {
    return { state: 'ungraded', score: null, reason: `fetch failed: ${e.message}`, model: null };
  } finally {
    clearTimeout(timer);
  }
}

function parseGrade(raw) {
  // Tolerate a stray ```json fence or trailing prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj;
  try { obj = JSON.parse(match[0]); } catch { return null; }
  const state = STATES.includes(obj.state) ? obj.state : null;
  if (!state || state === 'ungraded') return null;
  let score = Number(obj.score);
  if (!Number.isFinite(score)) score = null;
  else score = Math.max(0, Math.min(10, Math.round(score)));
  const material = MATERIALS.includes(obj.material) ? obj.material : 'unknown';
  return { state, score, material, reason: String(obj.reason || '').slice(0, 200) };
}

// True if a photo is eligible to be posted as a solo single.
export function isSoloShowcase(grade) {
  return grade?.state === 'showcase' && (grade.score ?? 0) >= SHOWCASE_SCORE_FLOOR;
}
