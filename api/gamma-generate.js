// Ryujin OS — Gamma Generation
//
// POST /api/gamma-generate?slug=X        — fire generation, save generation_id, return id
// GET  /api/gamma-generate?slug=X        — poll Gamma, save url when complete, return status
//
// Generates a SLIDE DECK presentation from the doc markdown — designed to be
// presented verbally over a Loom recording (one concept per slide, minimal
// text, big visual hierarchy). Uses Gamma v1.0 public API.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

const GAMMA_BASE = 'https://public-api.gamma.app/v1.0';
const USER_AGENT = 'Mozilla/5.0 (compatible; PlusUltraRoofing/1.0)';

const BRAND_PREFIX = `INSTRUCTIONS FOR THIS DECK:

This is a slide deck for LIVE VERBAL PRESENTATION. Mackenzie Maseroll, owner of Plus Ultra Roofing, will record a Loom video walking through this deck slide by slide — so every slide must support him talking through it, not replace him.

Each slide must be:
- ONE concept per slide. Do not cram multiple ideas onto one slide.
- Minimal text. Short headings, 2-4 bullets max, big visual hierarchy.
- Designed to be VIEWED at-a-glance, not READ. The verbal narration is the content.
- Professional, clean, trustworthy. No emoji. No filler.
- Use construction, roofing, and contractor imagery only. No stock-office cliches.

Brand: Plus Ultra Roofing (Riverview / Moncton, New Brunswick).
Brand colors: navy #1a3a8c primary, yellow #fdcc02 accent, cream / off-white backgrounds.
Typography: Montserrat for headings, Inter for body.

Condense the source document into a coherent slide flow. Lead with the most important takeaway. Use comparison tables for tiered options. End with a clear next-step or call-to-action slide.

Source document follows:

---

`;

async function gammaFetch(path, opts = {}) {
  const key = (process.env.GAMMA_API_KEY || '').trim();
  if (!key) throw new Error('GAMMA_API_KEY not configured');
  const r = await fetch(`${GAMMA_BASE}${path}`, {
    ...opts,
    headers: {
      'X-API-KEY': key,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  if (!r.ok) {
    const err = new Error(`Gamma API ${r.status}: ${typeof data === 'object' ? JSON.stringify(data) : text}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const slug = String(req.query.slug || '').trim().toLowerCase();
  if (!slug) return res.status(400).json({ error: 'Missing ?slug=' });

  const { data: doc, error } = await supabaseAdmin
    .from('docs')
    .select('id, slug, title, markdown, gamma_generation_id, gamma_url, gamma_generated_at')
    .eq('tenant_id', req.tenant.id)
    .eq('slug', slug)
    .maybeSingle();
  if (error || !doc) return res.status(404).json({ error: 'Doc not found' });

  if (req.method === 'POST') {
    if (!doc.markdown || doc.markdown.trim().length < 80) {
      return res.status(400).json({ error: 'Document is too short to generate a deck. Add content first.' });
    }

    const inputText = BRAND_PREFIX + doc.markdown;
    let gen;
    try {
      gen = await gammaFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({
          inputText,
          format: 'presentation',
          textMode: 'condense',
          textOptions: { amount: 'medium', tone: 'professional, clear, trustworthy' },
          additionalInstructions: 'Brand: Plus Ultra Roofing. Navy #1a3a8c + yellow #fdcc02. Construction imagery only.'
        })
      });
    } catch (e) {
      return res.status(e.status || 502).json({ error: 'Gamma generate failed', detail: e.message });
    }

    const generationId = gen.generationId || gen.id;
    if (!generationId) return res.status(502).json({ error: 'Gamma returned no generationId', detail: gen });

    await supabaseAdmin
      .from('docs')
      .update({ gamma_generation_id: generationId, gamma_generated_at: new Date().toISOString() })
      .eq('id', doc.id);

    return res.json({ generationId, status: 'pending' });
  }

  if (req.method === 'GET') {
    const generationId = doc.gamma_generation_id;
    if (!generationId) return res.json({ status: 'none' });

    let result;
    try {
      result = await gammaFetch(`/generations/${encodeURIComponent(generationId)}`);
    } catch (e) {
      return res.status(e.status || 502).json({ error: 'Gamma poll failed', detail: e.message });
    }

    const status = result.status || 'pending';
    const url = result.gammaUrl || result.url || null;

    if (status === 'completed' && url && url !== doc.gamma_url) {
      await supabaseAdmin
        .from('docs')
        .update({ gamma_url: url, gamma_generated_at: new Date().toISOString() })
        .eq('id', doc.id);
    }

    return res.json({ status, url, generationId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
