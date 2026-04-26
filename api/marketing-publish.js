// Ryujin OS — Marketing Publish (clip → scheduled_posts auto-fan-out)
//
// Bridges the marketing_clips lifecycle to the scheduled_posts / GHL Social
// Planner pipeline. When a clip becomes status='ready' with scheduled_at +
// target_platforms set, this endpoint resolves matching brand_accounts and
// fans out one scheduled_posts row per account.
//
// Endpoints:
//   POST /api/marketing-publish?id=CLIP_ID    → publish a single ready clip
//                                                (UI "Publish now" button).
//                                                Tenant required via x-tenant-id.
//
//   POST /api/marketing-publish?next=1        → cron sweep: pulls all ready
//                                                clips across tenants whose
//                                                scheduled_at falls within the
//                                                lookahead window and fans
//                                                them out. Same auth as
//                                                marketing-reconcile.
//
// Auth (sweep mode, in priority order):
//   1. Authorization: Bearer $CRON_SECRET     ← Vercel cron auto-sends this
//   2. x-internal-key: $INTERNAL_RENDER_KEY
//   3. If neither env var is set: open (dev only)
//
// Idempotency: a clip with any active (scheduled/posted) scheduled_posts row
// is skipped. Clips whose prior attempts ALL failed are eligible for retry —
// the failed rows are deleted first so history stays clean.
//
// Notes:
//   - 'gbp' on the clip maps to 'google' on brand_accounts.platform (GHL term).
//   - Caption is AI-polished per-brand-per-platform via captionGenerator.
//   - GHL rejects scheduleDate ≤ now+30s, so we clamp clipped clips forward.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { createSocialPost, getDefaultPosterUserId } from '../lib/ghl.js';
import { buildGhlPost } from './schedule-clip.js';
import { generatePlatformCaptions } from '../lib/captionGenerator.js';

const SWEEP_LOOKAHEAD_MS = 24 * 60 * 60 * 1000; // publish anything scheduled within next 24h
const SWEEP_LIMIT = 10; // ~6s per clip × 10 = 60s budget; cron fires every 10 min so backlog drains fast
const MIN_SCHEDULE_OFFSET_MS = 10 * 60 * 1000; // GHL rejects schedule dates < ~10 min ahead — empirically verified Apr 26

// clip target_platforms term  →  brand_accounts.platform term
const PLATFORM_MAP = {
  facebook: ['facebook'],
  instagram: ['instagram'],
  youtube: ['youtube'],
  tiktok: ['tiktok'],
  gbp: ['google'],
  google: ['google'],
};

function checkSweepAuth(req) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const internalKey = (process.env.INTERNAL_RENDER_KEY || '').trim();
  if (!cronSecret && !internalKey) return { ok: true, via: 'open-dev' };

  const auth = (req.headers['authorization'] || '').trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return { ok: true, via: 'cron-secret' };

  const got = (req.headers['x-internal-key'] || '').trim();
  if (internalKey && got === internalKey) return { ok: true, via: 'internal-key' };

  return { ok: false };
}

// Fallback caption when AI polish fails. Pulls in the brand's CTA + default
// hashtags so even an unpolished post stays on-brand. clip-level hashtags
// merge with brand-level hashtags, deduped.
function buildFallbackCaption(clip, brand) {
  const parts = [];
  if (clip.description?.trim()) parts.push(clip.description.trim());
  else if (clip.title?.trim()) parts.push(clip.title.trim());

  if (brand?.cta) parts.push(brand.cta);

  const tagSet = new Set();
  for (const t of clip.hashtags || []) tagSet.add(String(t).replace(/^#/, ''));
  for (const t of brand?.hashtags || []) tagSet.add(String(t).replace(/^#/, ''));
  if (tagSet.size) parts.push([...tagSet].map((t) => '#' + t).join(' '));

  return parts.join('\n\n');
}

function clampScheduleDate(scheduledAt) {
  const requested = new Date(scheduledAt).getTime();
  const earliest = Date.now() + MIN_SCHEDULE_OFFSET_MS;
  return new Date(Math.max(requested, earliest)).toISOString();
}

async function loadClipBrands(clipId) {
  const { data, error } = await supabaseAdmin
    .from('marketing_clip_brands')
    .select('brand:brands(id, slug, name, voice, tagline, cta, website, hashtags)')
    .eq('clip_id', clipId);
  if (error) throw new Error('clip brand lookup failed: ' + error.message);
  return (data || []).map((r) => r.brand).filter(Boolean);
}

// Brand-aware account resolution. Returns one row per (brand, account) where:
// - account belongs to that brand (brand_accounts.brand_id matches)
// - account is not excluded
// - if clip.target_platforms is set, account.platform must be in that set
//   ('gbp' clip-side maps to 'google' account-side)
async function resolveAccountsForBrands(tenantId, brandIds, targetPlatforms) {
  if (!brandIds.length) return [];
  let q = supabaseAdmin
    .from('brand_accounts')
    .select('ghl_account_id, brand_id, platform, account_name, excluded')
    .eq('tenant_id', tenantId)
    .eq('excluded', false)
    .in('brand_id', brandIds);

  if (Array.isArray(targetPlatforms) && targetPlatforms.length) {
    const ghlPlatforms = new Set();
    for (const p of targetPlatforms) {
      (PLATFORM_MAP[String(p).toLowerCase()] || [String(p).toLowerCase()]).forEach((m) => ghlPlatforms.add(m));
    }
    q = q.in('platform', [...ghlPlatforms]);
  }

  const { data, error } = await q;
  if (error) throw new Error('brand_accounts lookup failed: ' + error.message);
  return data || [];
}

// Per-brand polished captions. Runs all brands in parallel (each is one Haiku
// call) so 3 brands take ~3s instead of ~9s. Falls back gracefully — better
// to post a plain caption than to drop the clip.
async function buildBrandCaptions(clip, brands, accounts) {
  const seedTranscript =
    clip.transcript?.text?.trim() ||
    [clip.title, clip.description].filter(Boolean).join('\n') ||
    clip.title || '';

  const tasks = brands.map(async (brand) => {
    const platforms = [...new Set(
      accounts.filter((a) => a.brand_id === brand.id).map((a) => a.platform)
    )];
    if (!platforms.length || !seedTranscript.trim()) return [brand.id, {}];
    try {
      const captions = await generatePlatformCaptions({
        transcript: seedTranscript, brand, platforms,
      });
      return [brand.id, captions];
    } catch (e) {
      console.error(`[marketing-publish] caption-gen failed for brand ${brand.slug}:`, e.message);
      return [brand.id, {}];
    }
  });

  return new Map(await Promise.all(tasks));
}

// Publishes one clip. Returns { clip_id, status, scheduled, failed, results, error? }.
async function publishClip(clip) {
  const tenantId = clip.tenant_id;
  const result = { clip_id: clip.id, scheduled: 0, failed: 0, results: [] };

  // Pre-flight: only ready clips with rendered_url + scheduled_at.
  if (clip.status !== 'ready') {
    return { ...result, status: 'skipped', error: `clip status is ${clip.status}, expected 'ready'` };
  }
  if (!clip.rendered_url) {
    return { ...result, status: 'skipped', error: 'clip has no rendered_url' };
  }
  if (!clip.scheduled_at) {
    return { ...result, status: 'skipped', error: 'clip has no scheduled_at' };
  }

  // Idempotency: skip if any active (non-failed) scheduled_posts row exists.
  // Allowing retry of fully-failed clips means a transient GHL/network blip
  // doesn't permanently strand a clip — the cron will pick it up again.
  // We sweep the failed rows out of the way first so a retry produces a clean
  // 1-row-per-account picture (no stacked failures cluttering history).
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('scheduled_posts')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('clip_id', clip.id);
  if (existingErr) return { ...result, status: 'error', error: 'existing-check failed: ' + existingErr.message };
  if (existing && existing.length) {
    const active = existing.filter((r) => r.status !== 'failed' && r.status !== 'cancelled');
    if (active.length) {
      return { ...result, status: 'skipped', error: 'already has active scheduled_posts rows', existing: active.length };
    }
    // All prior attempts failed/cancelled — clear them and re-fan-out.
    const failedIds = existing.map((r) => r.id);
    await supabaseAdmin.from('scheduled_posts').delete().in('id', failedIds);
  }

  // Brand selection. Without brands the clip has no destination — fail clearly.
  let brands;
  try { brands = await loadClipBrands(clip.id); }
  catch (e) { return { ...result, status: 'error', error: e.message }; }

  if (!brands.length) {
    await supabaseAdmin.from('marketing_clips').update({
      status: 'failed',
      error_message: 'No brands attached to this clip — pick at least one before publishing.',
    }).eq('id', clip.id);
    return { ...result, status: 'failed', error: 'no brands selected' };
  }

  // Accounts for those brands, optionally narrowed by clip.target_platforms.
  let accounts;
  try {
    accounts = await resolveAccountsForBrands(tenantId, brands.map((b) => b.id), clip.target_platforms);
  } catch (e) {
    return { ...result, status: 'error', error: e.message };
  }

  // Photo clips can't post to TikTok (video-only platform). Filter rather
  // than fan out and let GHL reject it.
  if (clip.is_photo) {
    accounts = accounts.filter((a) => a.platform !== 'tiktok');
  }

  if (!accounts.length) {
    await supabaseAdmin.from('marketing_clips').update({
      status: 'failed',
      error_message: `No connected GHL accounts for selected brands${clip.target_platforms?.length ? ` and platforms ${clip.target_platforms.join(', ')}` : ''}.`,
    }).eq('id', clip.id);
    return { ...result, status: 'failed', error: 'no matching brand_accounts' };
  }

  const scheduleDate = clampScheduleDate(clip.scheduled_at);
  // GHL requires the actual MIME type (e.g. 'image/jpeg', 'video/mp4'), not
  // a generic 'image'/'video' string. Use the source mime if known, else
  // a sane default by media kind.
  const mediaType = clip.source_mime_type
    || (clip.is_photo ? 'image/jpeg' : 'video/mp4');
  const brandsById = new Map(brands.map((b) => [b.id, b]));

  // GHL requires a userId on every Social Planner post. Fetch once,
  // reuse across the fan-out. Cached for 30 min in-process.
  let userId = null;
  try { userId = await getDefaultPosterUserId(); }
  catch (e) { console.error('[marketing-publish] userId fetch failed:', e.message); }

  // Approved captions from the review flow (one per brand). When present
  // we use them verbatim — the user already saw and approved this text.
  // Falls back to AI auto-gen for any brand without an override.
  const overrides = (clip.caption_overrides && typeof clip.caption_overrides === 'object')
    ? clip.caption_overrides : {};
  const brandsNeedingAi = brands.filter((b) => !overrides[b.id]?.trim?.());
  const captionsByBrand = brandsNeedingAi.length
    ? await buildBrandCaptions(clip, brandsNeedingAi, accounts)
    : new Map();

  // Per-platform truncation for approved overrides. GHL/each platform has
  // its own cap; we trim cleanly on word boundary if the brand caption is
  // longer than the platform allows.
  const PLATFORM_MAX = { facebook: 2000, instagram: 2200, youtube: 4900, tiktok: 2200, google: 1500 };
  const truncForPlatform = (text, plat) => {
    const max = PLATFORM_MAX[plat] || 2000;
    if (!text || text.length <= max) return text;
    const trimmed = text.slice(0, max - 1);
    const lastSpace = trimmed.lastIndexOf(' ');
    return (lastSpace > max * 0.7 ? trimmed.slice(0, lastSpace) : trimmed) + '\u2026';
  };

  // Fan out: insert draft → POST GHL → update with ghl_post_id.
  for (const account of accounts) {
    const override = overrides[account.brand_id];
    const polished = captionsByBrand.get(account.brand_id)?.[account.platform];
    const fallback = buildFallbackCaption(clip, brandsById.get(account.brand_id));
    const caption = override
      ? truncForPlatform(override, account.platform)
      : (polished?.caption || fallback);
    const ytTitle = polished?.title || clip.title || undefined;
    const ctaType = polished?.ctaType || undefined;

    const baseRow = {
      tenant_id: tenantId,
      clip_id: clip.id,
      brand_id: account.brand_id || null,
      ghl_account_id: account.ghl_account_id,
      platform: account.platform,
      caption,
      media_url: clip.rendered_url,
      media_type: mediaType,
      scheduled_at: scheduleDate,
      status: 'draft',
    };

    const { data: draft, error: insErr } = await supabaseAdmin
      .from('scheduled_posts').insert(baseRow).select('*').single();
    if (insErr) {
      result.failed++;
      result.results.push({
        ghl_account_id: account.ghl_account_id, status: 'failed',
        error: 'draft insert: ' + insErr.message,
      });
      continue;
    }

    try {
      const post = {
        ghl_account_id: account.ghl_account_id,
        caption,
        title: ytTitle,
        ctaType,
      };
      const ghlBody = buildGhlPost({
        mediaUrl: clip.rendered_url,
        mediaType,
        scheduledAt: scheduleDate,
        post,
        accountRow: account,
        userId,
      });
      const ghlResp = await createSocialPost(ghlBody);
      // GHL returns the post id as Mongo-style `_id` under results.post
      const ghlPostId = ghlResp?.results?.post?._id
        || ghlResp?.results?.post?.id
        || ghlResp?.post?._id
        || ghlResp?.post?.id
        || ghlResp?.id
        || ghlResp?.data?.id
        || null;
      await supabaseAdmin.from('scheduled_posts')
        .update({
          status: 'scheduled',
          ghl_post_id: ghlPostId,
          raw_response: ghlResp,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draft.id).eq('tenant_id', tenantId);
      result.scheduled++;
      result.results.push({
        brand_id: account.brand_id, platform: account.platform,
        ghl_account_id: account.ghl_account_id, status: 'scheduled',
        ghl_post_id: ghlPostId, row_id: draft.id,
      });
    } catch (e) {
      await supabaseAdmin.from('scheduled_posts')
        .update({
          status: 'failed',
          error_msg: e.message || String(e),
          raw_response: e.data || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draft.id).eq('tenant_id', tenantId);
      result.failed++;
      result.results.push({
        brand_id: account.brand_id, platform: account.platform,
        ghl_account_id: account.ghl_account_id, status: 'failed',
        error: e.message, row_id: draft.id,
      });
    }
  }

  if (result.scheduled > 0) {
    await supabaseAdmin.from('marketing_clips').update({
      status: 'scheduled',
      error_message: result.failed
        ? `Partial: ${result.scheduled} scheduled, ${result.failed} failed — see scheduled_posts`
        : null,
    }).eq('id', clip.id);
    return { ...result, status: 'scheduled' };
  }

  await supabaseAdmin.from('marketing_clips').update({
    status: 'failed',
    error_message: `All ${result.failed} fan-out attempts failed — see scheduled_posts`,
  }).eq('id', clip.id);
  return { ...result, status: 'failed' };
}

// ── Single-clip handler (tenant-scoped) ──
async function singleHandler(req, res) {
  const tenantId = req.tenant.id;
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing ?id=' });

  const { data: clip, error } = await supabaseAdmin
    .from('marketing_clips').select('*').eq('id', id).eq('tenant_id', tenantId).single();
  if (error || !clip) return res.status(404).json({ error: 'Clip not found' });

  const out = await publishClip(clip);
  const code = out.status === 'scheduled' ? 200 : (out.status === 'skipped' ? 409 : 500);
  return res.status(code).json(out);
}

// ── Sweep handler (cross-tenant, cron) ──
async function sweepHandler(req, res) {
  const auth = checkSweepAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const cutoff = new Date(Date.now() + SWEEP_LOOKAHEAD_MS).toISOString();

  const { data: clips, error } = await supabaseAdmin
    .from('marketing_clips')
    .select('*')
    .eq('status', 'ready')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', cutoff)
    .order('scheduled_at', { ascending: true })
    .limit(SWEEP_LIMIT);
  if (error) return res.status(500).json({ error: 'sweep query failed: ' + error.message });

  if (!clips || !clips.length) {
    return res.json({ via: auth.via, swept: 0, items: [], note: 'No ready clips in window.' });
  }

  const items = [];
  const counts = { scheduled: 0, failed: 0, skipped: 0, error: 0 };
  for (const clip of clips) {
    try {
      const out = await publishClip(clip);
      counts[out.status] = (counts[out.status] || 0) + 1;
      items.push(out);
    } catch (e) {
      counts.error++;
      items.push({ clip_id: clip.id, status: 'error', error: e.message });
    }
  }

  return res.json({ via: auth.via, swept: clips.length, ...counts, items });
}

// ── Router ──
async function tenantHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  return singleHandler(req, res);
}

const tenantWrapped = requireTenant(tenantHandler);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Sweep mode: no tenant required, uses cron / internal-key auth.
  if (req.query.next) return sweepHandler(req, res);

  // Single-clip mode: tenant scoped via header.
  return tenantWrapped(req, res);
}
