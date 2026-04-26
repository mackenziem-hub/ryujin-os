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
- Write ONE simple, fresh-feeling caption (1-3 sentences, ~120-300 chars)
- Tone matches the brand voice exactly. Do not invent corporate filler.
- Add 0-3 relevant hashtags at the end if they feel natural — skip if they don't
- Never hashtag every word. Never add aggressive CTAs. Never sound like a press release.
- The user's note is the seed — riff on it, don't replace it with your own message
- Reply with ONLY the caption text. No JSON, no preamble, no "here's a caption:".`;

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
    // Strip accidental quotes/fences
    return text.replace(/^["'`]|["'`]$/g, '').replace(/^```[\w]*\n?|\n?```$/g, '').trim();
  } finally {
    clearTimeout(t);
  }
}

function fallbackCaption(brand, userNote) {
  if (userNote) return userNote;
  return brand.cta || `Latest from ${brand.name}.`;
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
