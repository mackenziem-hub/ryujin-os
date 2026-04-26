// Ryujin OS — Marketing Caption Suggester
//
// POST /api/marketing-suggest
//   Body: {
//     source_url: 'https://...',           // public Blob URL of the photo/video
//     source_mime_type: 'image/jpeg',
//     is_photo: true,
//     user_note?: 'don't forget to smile, fun photo',
//     brand_ids: ['<uuid>', ...]
//   }
//
// Returns: { suggestions: { '<brand_id>': { caption, brand: { id, slug, name } } } }
//
// Calls Claude Haiku 4.5 with vision (for photos) or just text (for videos —
// no transcript yet at upload time). One Claude call per brand, run in
// parallel. Each prompt seeds with the user's note + brand voice/CTA/hashtags.
// Output is intentionally simple: 1-3 sentences, fresh-feeling, brand-voiced,
// minimal hashtags. Mac wants fresh content, not SEO walls.
//
// On failure for a given brand, returns a stub fallback so the UI doesn't
// hang. Caller (capture page) can also "Regenerate" individual cards.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { nextOpenSlotForTenant, formatSlotForDisplay } from '../lib/scheduling.js';

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = 'claude-haiku-4-5-20251001';
const REQUEST_TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = `You write social media captions for small business posts. Your job:
- Read the brand voice + the user's note about the photo
- If a photo is attached, look at it and describe what you actually see (selfie, roof job, crew, hardware, etc.)
- Write ONE simple, fresh-feeling caption (1-3 sentences, ~80-220 chars). Short wins.
- Tone matches the brand voice exactly. Do not invent corporate filler.
- The user's note is the seed. Riff on it. Do not replace it with your own message.
- Reply with ONLY the caption text. No JSON, no preamble, no "here's a caption:".

Style rules (mandatory):
- NO em-dashes (—). Use a comma, period, or "and" instead. Em-dash use is a hard fail.
- Contractions always (don't, we're, it's, that's). Never spell out "do not", "we are".
- No aggressive CTAs. No "DM us!", no "Hit the link!", no all-caps yelling.
- No clichéd marketing phrases ("game-changer", "next-level", "elevate", "unleash").
- No hashtag in the middle of a sentence. Hashtags only at the end if at all.

Hashtag rules (strict):
- Use ONLY hashtags from the brand's provided list. Do NOT invent new ones.
- Maximum 2 hashtags. Often zero is the right answer for fresh content.
- If the brand provides no hashtags, use no hashtags.
- Never hashtag a place name you weren't given (no #RiverviewNB, #MonctonNB, etc. unless those exact tags are in the brand's list).`;

function buildUserMessage({ brand, userNote, isPhoto, sourceUrl, sourceMimeType }) {
  const brandLines = [
    `Brand: ${brand.name}`,
    brand.voice ? `Voice: ${brand.voice}` : null,
    brand.cta ? `Default CTA (use sparingly, only if it fits): ${brand.cta}` : null,
    brand.hashtags?.length ? `Brand hashtags (use only if relevant): ${brand.hashtags.map(h => '#' + String(h).replace(/^#/, '')).join(' ')}` : null,
  ].filter(Boolean).join('\n');

  const noteLine = userNote
    ? `\n\nThe user said: "${userNote}"`
    : `\n\n(The user did not write a note — base the caption on what's in the image and the brand voice.)`;

  const text = `${brandLines}${noteLine}\n\nWrite the caption.`;

  if (isPhoto && sourceUrl) {
    return [
      { type: 'image', source: { type: 'url', url: sourceUrl } },
      { type: 'text', text },
    ];
  }
  return [{ type: 'text', text }];
}

async function suggestForBrand({ brand, userNote, isPhoto, sourceUrl, sourceMimeType }) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY missing');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

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
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: buildUserMessage({ brand, userNote, isPhoto, sourceUrl, sourceMimeType }),
        }],
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Anthropic ${r.status}: ${err.slice(0, 240)}`);
    }
    const data = await r.json();
    const text = data?.content?.[0]?.text?.trim() || '';
    if (!text) throw new Error('Empty caption');
    return scrubCaption(text, brand);
  } finally {
    clearTimeout(t);
  }
}

function fallbackCaption(brand, userNote) {
  if (userNote) return userNote;
  return brand.cta || `Latest from ${brand.name}.`;
}

// Post-processing: enforce style rules and strip hallucinated hashtags.
// Belt-and-suspenders for the system prompt — if the LLM slips, we still
// ship clean text.
function scrubCaption(text, brand) {
  let out = String(text || '').trim();

  // Strip wrapping quotes/fences
  out = out.replace(/^["'`]|["'`]$/g, '').replace(/^```[\w]*\n?|\n?```$/g, '').trim();

  // Em-dashes → comma+space. Catches both real em-dash and the UTF-8/Win-1252
  // mojibake form that sometimes sneaks through ("â€"").
  out = out.replace(/\u2014|\u2013/g, ', ');     // em-dash, en-dash
  out = out.replace(/\u00E2\u20AC\u201D/g, ', '); // mojibake em-dash
  out = out.replace(/\u00E2\u20AC\u201C/g, ', '); // mojibake en-dash
  out = out.replace(/  +/g, ' ').replace(/ ,/g, ',').replace(/,,/g, ',').trim();

  // Hashtag whitelist — keep only ones in the brand's provided list (case-insensitive).
  // Strip any others the model invented (e.g. fake place names).
  const allowed = new Set((brand?.hashtags || []).map((t) => String(t).replace(/^#/, '').toLowerCase()));
  out = out.replace(/#([\w\d_]+)/g, (m, tag) => {
    return allowed.has(tag.toLowerCase()) ? '#' + tag : '';
  });

  // Tidy whitespace from removed tags
  out = out.replace(/  +/g, ' ').replace(/ \./g, '.').replace(/ ,/g, ',').trim();

  return out;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenantId = req.tenant.id;
  const body = req.body || {};
  const { source_url, source_mime_type, is_photo, user_note, brand_ids } = body;

  if (!source_url) return res.status(400).json({ error: 'source_url required' });
  if (!Array.isArray(brand_ids) || !brand_ids.length) {
    return res.status(400).json({ error: 'brand_ids required' });
  }

  // Load brand records (tenant-scoped)
  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id, slug, name, voice, cta, tagline, hashtags, website')
    .eq('tenant_id', tenantId)
    .in('id', brand_ids);
  if (error) return res.status(500).json({ error: 'brand lookup: ' + error.message });
  if (!brands?.length) return res.status(404).json({ error: 'no matching brands' });

  // Generate suggestions in parallel — one Claude call per brand
  const tasks = brands.map(async (brand) => {
    let caption;
    try {
      caption = await suggestForBrand({
        brand, userNote: user_note,
        isPhoto: !!is_photo, sourceUrl: source_url, sourceMimeType: source_mime_type,
      });
    } catch (e) {
      console.error(`[marketing-suggest] ${brand.slug} failed:`, e.message);
      caption = fallbackCaption(brand, user_note);
    }
    return [brand.id, { caption, brand: { id: brand.id, slug: brand.slug, name: brand.name } }];
  });

  const [entries, slot] = await Promise.all([
    Promise.all(tasks),
    nextOpenSlotForTenant(tenantId).catch(() => null),
  ]);
  const suggestions = Object.fromEntries(entries);

  return res.json({
    suggestions,
    next_slot: slot ? {
      iso: slot.toISOString(),
      label: formatSlotForDisplay(slot),
    } : null,
  });
}

export default requireTenant(handler);
