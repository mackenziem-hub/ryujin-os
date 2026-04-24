// Ryujin OS — Per-platform social caption generator (Claude Haiku)
// POST /api/caption-gen
// Body: { transcript, brandId, platforms: ['facebook','instagram','youtube','tiktok','google'] }
// Returns: { captions: { [platform]: { caption, title?, ctaType? } } }
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { generatePlatformCaptions } from '../lib/captionGenerator.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenantId = req.tenant.id;
  const { transcript, brandId, platforms } = req.body || {};

  if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: 'transcript required' });
  if (!Array.isArray(platforms) || !platforms.length) return res.status(400).json({ error: 'platforms[] required' });

  // Load brand (for voice/cta/hashtags)
  let brand = { name: '', voice: '', cta: '', tagline: '', website: '', hashtags: [] };
  if (brandId) {
    const { data, error } = await supabaseAdmin
      .from('brands').select('*')
      .eq('tenant_id', tenantId).eq('id', brandId).single();
    if (error || !data) return res.status(404).json({ error: 'Brand not found' });
    brand = data;
  }

  try {
    const captions = await generatePlatformCaptions({ transcript, brand, platforms });
    return res.json({ captions });
  } catch (e) {
    return res.status(500).json({ error: 'Caption generation failed', detail: e.message || String(e) });
  }
}

export default requireTenant(handler);
