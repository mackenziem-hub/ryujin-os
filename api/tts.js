// Phase 12: ElevenLabs TTS integration with graceful fallback to browser-native.
// POST /api/tts  body: { text, voice_id?, archetype? }  → returns audio/mpeg stream
//
// Voice resolution priority: explicit voice_id > archetype-mapped > default
// Falls back with 503 if ELEVENLABS_API_KEY not configured (front-end then uses browser TTS).
//
// Auth: Bearer token (same as chat). No-auth defaults to plus-ultra owner for backward compat with chat-fab calls.

import { supabaseAdmin } from '../lib/supabase.js';

const ELEVEN_API = 'https://api.elevenlabs.io/v1/text-to-speech';
// Phase 16: cost-conscious default. flash_v2_5 is 1/3 the credits of multilingual_v2 with quality
// that's plenty natural for chat-assistant use. Multilingual is overkill for short conversational lines.
// If quality suffers on a specific archetype, the per-archetype voice can still override per-call.
const MODEL_ID = 'eleven_flash_v2_5';

// Professional / business-appropriate voice library mapped to archetype lenses.
// Re-tuned May 2 — initial mapping had voices skewing young/casual, sounded "meme-y"
// for executive AI use. These are mature, broadcast-quality voices appropriate for a contractor SaaS.
// Mac can override per-user via persona.voice_id from the persona modal.
const ARCHETYPE_VOICE = {
  ruler:      'JBFqnCBsd6RMkjVDRZzb', // George — calm, mature narrator (executive authority)
  caregiver:  'EXAVITQu4vr4xnSDxMaL', // Sarah — confident professional female (EA tone)
  hero:       'nPczCjzI2devNBz1zQrb', // Brian — confident persuasive male (sales coach)
  creator:    'pqHfZKP75CvOlQylNhV4', // Bill — friendly authoritative, grounded (production)
  sage:       '21m00Tcm4TlvDq8ikWAM', // Rachel — clear, intelligent professional female (analysis)
  magician:   '9BWtsMINqrJLrRacOk9x', // Aria — mature, intelligent female (Hecate is female; transformation/mystery)
  explorer:   'Xb7hH8MSUJpSbSDYk0k2', // Alice — clear independent British female (frontier work)
  jester:     'bIHbv24MWmeRgasZH58o', // Will — friendly conversational, playful but not meme-y
  lover:      'pFZP5JQG7iQjIQuC4Bku', // Lily — warm female (relationship/brand)
  innocent:   'XB0fDUnXU5powFXDhCwa', // Charlotte — gentle American female (onboarding)
  everyman:   'cjVigY5qzO86Huf0OWal', // Eric — friendly conversational male (relatable)
  outlaw:     'TX3LPaxmHKxFdv7VOQHJ'  // Liam — articulate American male (challenger)
};

const DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // George — fallback for owner/unmapped

// Tuned for natural conversational delivery (less monotone, light emphasis)
const VOICE_SETTINGS = {
  stability: 0.35,        // lower = more emotional variance, less robotic
  similarity_boost: 0.78,
  style: 0.4,             // slightly more emphasis / inflection
  use_speaker_boost: true
};

async function resolveSession(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token;
  if (!token) return null;
  try {
    const { data: session } = await supabaseAdmin
      .from('sessions').select('user_id, tenant_id, expires_at').eq('token', token).single();
    if (!session || new Date(session.expires_at) < new Date()) return null;
    return { userId: session.user_id, tenantId: session.tenant_id };
  } catch {
    return null;
  }
}

// Pull user's persona.voice_id if set (overrides archetype default)
async function userVoiceOverride(userId) {
  if (!userId) return null;
  try {
    const { data } = await supabaseAdmin.from('users').select('persona').eq('id', userId).single();
    const v = data?.persona?.voice_id;
    return (v && typeof v === 'string' && v.length > 5) ? v : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'ElevenLabs not configured',
      hint: 'Set ELEVENLABS_API_KEY in Vercel env. Front-end will fall back to browser TTS.',
      fallback: 'browser'
    });
  }

  const { text, voice_id, archetype } = req.body || {};
  if (!text || typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  if (text.length > 5000) return res.status(400).json({ error: 'text too long (max 5000 chars)' });

  // Voice resolution: explicit > archetype-mapped > user persona override > default
  // Archetype wins over persona override because the archetype IS the character speaking.
  // Mac's persona voice only kicks in when there's no archetype context (legacy / non-archetype flows).
  // (Earlier this was inverted — that's why every archetype sounded like one voice.)
  const ctx = await resolveSession(req);
  let resolvedVoiceId = voice_id;
  if (!resolvedVoiceId && archetype && ARCHETYPE_VOICE[archetype]) {
    resolvedVoiceId = ARCHETYPE_VOICE[archetype];
  }
  if (!resolvedVoiceId && ctx?.userId) {
    resolvedVoiceId = await userVoiceOverride(ctx.userId);
  }
  if (!resolvedVoiceId) resolvedVoiceId = DEFAULT_VOICE;

  // Strip markdown + punctuation noise that reads literally through TTS
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' code block ')          // code fences
    .replace(/`([^`]+)`/g, '$1')                          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')              // markdown links → text only
    .replace(/[\*_`#>~|]/g, '')                            // markdown formatting chars
    .replace(/\\([\w])/g, '$1')                            // escape sequences
    .replace(/\s[—–]\s/g, ', ')                            // em/en dash with spaces → comma
    .replace(/[—–]/g, ', ')                                // em/en dash without spaces
    .replace(/\s-\s/g, ', ')                               // hyphen with spaces → comma
    .replace(/[(){}\[\]]/g, ' ')                           // brackets/parens → space (pause)
    .replace(/\s*&\s*/g, ' and ')                          // ampersand → "and"
    .replace(/\b(\w+)\/(\w+)\b/g, '$1 or $2')              // slash between words → "or"
    .replace(/^[\s]*[•\u2022\u25CF\-\d]+[.)]?[\s]+/gm, '') // bullet/number prefixes
    .replace(/\n{2,}/g, '. ')                              // double newlines → sentence break
    .replace(/\n/g, ' ')                                   // single newlines → space
    .replace(/\s+/g, ' ')                                  // collapse whitespace
    .replace(/\.\s*\./g, '.')                              // doubled periods
    .replace(/,\s*,/g, ',')                                // doubled commas
    .trim();
  if (!clean) return res.status(400).json({ error: 'text empty after cleanup' });

  // If client requests timestamps, hit the with-timestamps endpoint and return JSON containing
  // audio_base64 + alignment so front-end can do exact word-by-word sync. Otherwise stream raw audio.
  const wantTimestamps = req.body?.timestamps === true;

  try {
    if (wantTimestamps) {
      const upstream = await fetch(`${ELEVEN_API}/${resolvedVoiceId}/with-timestamps`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          text: clean,
          model_id: MODEL_ID,
          voice_settings: VOICE_SETTINGS
        })
      });
      if (!upstream.ok) {
        const errText = await upstream.text();
        return res.status(upstream.status).json({
          error: `ElevenLabs ${upstream.status}`,
          detail: errText.slice(0, 300),
          fallback: 'browser'
        });
      }
      const data = await upstream.json();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Voice-Id', resolvedVoiceId);
      return res.status(200).json({
        audio_base64: data.audio_base64,
        alignment: data.normalized_alignment || data.alignment || null,
        voice_id: resolvedVoiceId
      });
    }

    const upstream = await fetch(`${ELEVEN_API}/${resolvedVoiceId}/stream?optimize_streaming_latency=2`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: clean,
        model_id: MODEL_ID,
        voice_settings: VOICE_SETTINGS
      })
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error: `ElevenLabs ${upstream.status}`,
        detail: errText.slice(0, 300),
        fallback: 'browser'
      });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Voice-Id', resolvedVoiceId);
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: e.message, fallback: 'browser' });
  }
}
