// Ryujin OS — Per-platform social caption generator
// Given a transcript + brand voice, emits captions tuned to each platform's
// norms (length, hashtags, emoji, CTA placement, SEO). One Claude call,
// returns a caption per requested platform.
//
// Used by /api/schedule-clip to populate the caption field on each
// scheduled_posts row before POSTing to GHL.
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const MODEL = 'claude-haiku-4-5-20251001';

// Per-platform rules. Merged into the prompt for Claude.
const PLATFORM_RULES = {
  facebook: {
    maxLen: 2000,
    rules: [
      'Conversational, can be longer (300-800 chars sweet spot).',
      'Hook in first line. No clickbait.',
      'End with a soft CTA.',
      '2-4 hashtags at the very end, relevant to the content.',
      'Emoji sparingly — professional brand voice.'
    ]
  },
  instagram: {
    maxLen: 2200,
    rules: [
      'Hook in the first line (before the "more" cutoff at ~125 chars).',
      '150-400 chars main body, then 5-10 targeted hashtags at the end.',
      'Conversational, some emoji OK.',
      'Include CTA (save / share / book inspection / visit bio).',
      'Line breaks welcome.'
    ]
  },
  tiktok: {
    maxLen: 2200,
    rules: [
      'Hook first 40 chars — attention grab.',
      'Short (under 200 chars) is fine; punchy wins.',
      '3-5 hashtags, mix of #fyp-style and niche ones.',
      'Casual, energetic voice.',
      'No commercial-sounding CTAs — soft invitations.'
    ]
  },
  youtube: {
    maxLen: 4900,
    rules: [
      'Return BOTH a title (<=100 chars, SEO-focused, the thing people would search) AND a description (300-800 chars).',
      'Description should open with a 1-2 sentence hook, then more context.',
      'Include #Shorts hashtag at end of description if video is short (9:16).',
      '5-10 hashtags + keywords in description.',
      'Add channel CTA at the end (subscribe / next video).'
    ]
  },
  google: {
    maxLen: 1500,
    rules: [
      'This is Google Business Profile — local SEO focus.',
      '150-400 chars. Mention city/area if the brand is local.',
      'NO hashtags.',
      'Clear CTA: book / call / visit website.',
      'Factual, confidence-inspiring tone.',
      'Also suggest a CTA button type: BOOK | CALL | LEARN_MORE | SIGN_UP | ORDER (choose one).'
    ]
  }
};

function buildPrompt({ transcript, brand, platforms }){
  const rules = platforms.map(p => {
    const cfg = PLATFORM_RULES[p];
    if (!cfg) return null;
    return `### ${p.toUpperCase()}\n- Max length: ${cfg.maxLen} chars\n${cfg.rules.map(r => '- ' + r).join('\n')}`;
  }).filter(Boolean).join('\n\n');

  const brandCtx = [
    brand.name ? `Brand: ${brand.name}` : null,
    brand.voice ? `Voice: ${brand.voice}` : null,
    brand.tagline ? `Tagline: ${brand.tagline}` : null,
    brand.cta ? `Default CTA: ${brand.cta}` : null,
    brand.website ? `Website: ${brand.website}` : null,
    brand.hashtags && brand.hashtags.length ? `Mandatory hashtags to include where appropriate: ${brand.hashtags.map(h => '#' + h.replace(/^#/, '')).join(' ')}` : null
  ].filter(Boolean).join('\n');

  return `You are writing social media captions for a video clip. Below is the transcript of the video and the brand voice. Write a caption for each requested platform following that platform's specific rules.

${brandCtx}

## Transcript
"""
${transcript}
"""

## Platform rules
${rules}

## Output
Return a single JSON object with a key for each platform. For most platforms the value is a string (the caption). For youtube, the value is an object with keys "title" and "description". For google, the value is an object with keys "caption" and "ctaType" (one of BOOK, CALL, LEARN_MORE, SIGN_UP, ORDER).

Example shape (include only the platforms requested):
{
  "facebook": "string caption...",
  "instagram": "string caption...",
  "tiktok": "string caption...",
  "youtube": { "title": "...", "description": "..." },
  "google": { "caption": "...", "ctaType": "BOOK" }
}

Rules for your output:
- Reply with ONLY valid JSON. No markdown fences, no preamble, no commentary.
- Respect each platform's character limits — do not exceed maxLen.
- Do not invent facts not in the transcript; you may add tone/CTA/hashtags.
- No negations ("no surprises", "don't skip") — use positive phrasing.
- Plus Ultra specifically: avoid sci-fi/techy tone; warm and clear.`;
}

export async function generatePlatformCaptions({ transcript, brand, platforms, timeoutMs = 30000 }){
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY missing');
  if (!transcript || !transcript.trim()) throw new Error('transcript required');
  if (!brand) throw new Error('brand required');
  if (!Array.isArray(platforms) || !platforms.length) throw new Error('platforms[] required');

  const prompt = buildPrompt({ transcript, brand, platforms });

  // Bound the Anthropic call so a stalled API can't drag down the function.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2400,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: ctrl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Anthropic timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(t);
  }

  if (!r.ok){
    const errText = await r.text();
    throw new Error(`Anthropic ${r.status}: ${errText.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = data?.content?.[0]?.text || '';

  // Strip fences if the model added them despite instructions
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e){ throw new Error('Caption gen returned non-JSON: ' + cleaned.slice(0, 200)); }

  // Normalize into a consistent shape: every platform returns { caption, title?, ctaType? }
  const out = {};
  for (const p of platforms){
    const v = parsed[p];
    if (v == null) continue;
    if (typeof v === 'string') out[p] = { caption: v };
    else if (typeof v === 'object'){
      if (p === 'youtube') out[p] = { caption: v.description || '', title: v.title || '' };
      else if (p === 'google') out[p] = { caption: v.caption || '', ctaType: v.ctaType || null };
      else out[p] = { caption: v.caption || v.text || '' };
    }
  }
  return out;
}

export { PLATFORM_RULES };
