// Ryujin OS — Schedule a clip across multiple GHL social accounts
// POST /api/schedule-clip
// Body: {
//   mediaUrl:     'https://...mp4',                   // required, public URL to the video
//   mediaType:    'video' | 'image' (default 'video'),
//   scheduledAt:  '2026-04-25T15:00:00.000Z',         // ISO 8601 UTC
//   clipId:       'uuid',                             // optional link to marketing_clips
//   posts: [{                                          // one per target account
//     ghl_account_id: 'acc_xxx',
//     caption:        'text',
//     title:          'optional — YouTube only',
//     ctaType:        'optional — Google only: BOOK|CALL|LEARN_MORE|SIGN_UP|ORDER',
//     ctaUrl:         'optional — GBP CTA link'
//   }]
// }
// Returns: { scheduled: N, failed: M, results: [{ ghl_account_id, status, ghl_post_id?, error? }] }
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { createSocialPost, getDefaultPosterUserId } from '../lib/ghl.js';

export function buildGhlPost({ mediaUrl, mediaType, scheduledAt, post, accountRow, userId }){
  // Base payload — only the top-level keys GHL Social Planner accepts.
  // Verified Apr 26, 2026: nested `youtube`/`google` keys cause 422
  // ("property X should not exist"). Per-platform metadata (yt title,
  // gbp CTA) goes inside the per-account post object via different
  // endpoints if at all — not the multi-platform /posts call.
  const body = {
    accountIds: [post.ghl_account_id],
    summary: post.caption || '',
    media: [{ url: mediaUrl, type: mediaType || 'video/mp4' }],
    scheduleDate: scheduledAt,
    status: 'scheduled',
    type: 'post',
  };
  if (userId) body.userId = userId; // GHL requires this — which user is posting
  return body;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tenantId = req.tenant.id;
  const { mediaUrl, mediaType = 'video', scheduledAt, clipId, posts } = req.body || {};

  if (!mediaUrl) return res.status(400).json({ error: 'mediaUrl required' });
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt required (ISO 8601)' });
  if (!Array.isArray(posts) || !posts.length) return res.status(400).json({ error: 'posts[] required' });

  // Validate scheduleAt is in the future (GHL rejects past times)
  if (new Date(scheduledAt).getTime() <= Date.now() + 30_000) {
    return res.status(400).json({ error: 'scheduledAt must be at least 30 seconds in the future' });
  }

  // Fetch account metadata for brand_id + platform mapping
  const ids = posts.map(p => p.ghl_account_id);
  const { data: accountRows, error: arErr } = await supabaseAdmin
    .from('brand_accounts')
    .select('ghl_account_id, brand_id, platform, account_name, excluded')
    .eq('tenant_id', tenantId)
    .in('ghl_account_id', ids);
  if (arErr) return res.status(500).json({ error: 'account lookup failed: ' + arErr.message });

  const byId = new Map(accountRows.map(r => [r.ghl_account_id, r]));

  // Refuse posts to excluded accounts (guardrail)
  const excluded = posts.filter(p => byId.get(p.ghl_account_id)?.excluded);
  if (excluded.length){
    return res.status(400).json({
      error: 'Refusing to post to excluded accounts',
      excluded: excluded.map(p => p.ghl_account_id)
    });
  }

  let userId = null;
  try { userId = await getDefaultPosterUserId(); }
  catch (e) { console.error('[schedule-clip] userId fetch failed:', e.message); }

  const results = [];
  for (const post of posts){
    const accountRow = byId.get(post.ghl_account_id);
    const baseRow = {
      tenant_id: tenantId,
      clip_id: clipId || null,
      brand_id: accountRow?.brand_id || null,
      ghl_account_id: post.ghl_account_id,
      platform: accountRow?.platform || 'unknown',
      caption: post.caption || '',
      media_url: mediaUrl,
      media_type: mediaType,
      scheduled_at: scheduledAt,
      status: 'draft'
    };

    // Insert draft row first so we always have a trace even if GHL call fails
    const { data: draft, error: insErr } = await supabaseAdmin
      .from('scheduled_posts').insert(baseRow).select('*').single();
    if (insErr){
      results.push({ ghl_account_id: post.ghl_account_id, status: 'failed', error: 'draft insert: ' + insErr.message });
      continue;
    }

    // Call GHL
    try {
      const ghlBody = buildGhlPost({ mediaUrl, mediaType, scheduledAt, post, accountRow, userId });
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
          updated_at: new Date().toISOString()
        })
        .eq('id', draft.id).eq('tenant_id', tenantId);
      results.push({ ghl_account_id: post.ghl_account_id, status: 'scheduled', ghl_post_id: ghlPostId, row_id: draft.id });
    } catch (e) {
      await supabaseAdmin.from('scheduled_posts')
        .update({
          status: 'failed',
          error_msg: e.message || String(e),
          raw_response: e.data || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', draft.id).eq('tenant_id', tenantId);
      results.push({ ghl_account_id: post.ghl_account_id, status: 'failed', error: e.message, row_id: draft.id });
    }
  }

  const scheduled = results.filter(r => r.status === 'scheduled').length;
  const failed = results.filter(r => r.status === 'failed').length;
  return res.json({ scheduled, failed, results });
}

export default requireTenant(handler);
