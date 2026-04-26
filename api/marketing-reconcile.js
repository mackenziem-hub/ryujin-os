// Ryujin OS — Marketing post reconciler
//
// Polls GHL for the actual status of any scheduled_posts row whose
// scheduled_at has passed but whose local status is still 'scheduled'.
// Maps GHL → local status: posted / failed / cancelled, and stamps
// posted_at + raw_response.
//
// Without this job, scheduled_posts.status never advances past 'scheduled' —
// the UI shows posts as "scheduled" forever even after GHL publishes.
//
// Auth (in priority order, must match one):
//   1. Authorization: Bearer $CRON_SECRET   ← Vercel cron auto-sends this
//   2. x-internal-key: $INTERNAL_RENDER_KEY (reuses the existing render key
//      so you don't need a second env var for manual / curl invocations)
//   3. If neither env var is set, the endpoint is open (dev only).
//
// Endpoints:
//   GET  /api/marketing-reconcile          → dry run, returns what *would* change
//   POST /api/marketing-reconcile          → actually reconciles
//   Optional ?tenant=<slug> to scope to one tenant (default: all tenants)
//   Optional ?limit=N (default 50, hard cap 200)
//
// Returns: { reconciled, posted, failed, cancelled, untouched, errors, items: [...] }
//
// NOTE: GHL Social Planner is currently single-location (one GHL_LOCATION_ID
// per deploy), so this job uses the single configured location for all tenants.
// When per-tenant GHL credentials land, replace the static getSocialPost()
// import with a per-tenant resolver.
import { supabaseAdmin } from '../lib/supabase.js';
import { getSocialPost } from '../lib/ghl.js';

const HARD_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function checkAuth(req) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const internalKey = (process.env.INTERNAL_RENDER_KEY || '').trim();

  // No env vars set → open (dev only)
  if (!cronSecret && !internalKey) return { ok: true, via: 'open-dev' };

  const auth = (req.headers['authorization'] || '').trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return { ok: true, via: 'cron-secret' };

  const got = (req.headers['x-internal-key'] || '').trim();
  if (internalKey && got === internalKey) return { ok: true, via: 'internal-key' };

  return { ok: false };
}

// Map a GHL post payload → our status. GHL response shape isn't fully
// documented; we accept several common field names. raw_response is always
// stored so you can adjust this mapping after seeing real responses.
function mapGhlStatus(ghlPost) {
  if (!ghlPost) return { status: null, reason: 'empty response' };
  const p = ghlPost.post || ghlPost.data || ghlPost; // unwrap common envelopes

  const rawStatus = String(p.status || p.postStatus || p.state || '').toLowerCase();
  const postedAt = p.postedAt || p.publishedAt || p.published_at || null;
  const errorMsg = p.errorMessage || p.error || p.failureReason || null;

  if (['posted', 'published', 'success', 'completed'].includes(rawStatus)) {
    return { status: 'posted', posted_at: postedAt || new Date().toISOString(), error_msg: null };
  }
  if (['failed', 'error', 'rejected'].includes(rawStatus)) {
    return { status: 'failed', error_msg: errorMsg || `GHL reported status=${rawStatus}` };
  }
  if (['deleted', 'cancelled', 'canceled'].includes(rawStatus)) {
    return { status: 'cancelled', error_msg: errorMsg || null };
  }
  // 'scheduled', 'pending', 'queued', '' → no change yet
  return { status: null, reason: `GHL still ${rawStatus || 'unknown'}` };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'GET (dry-run) or POST only' });
  }

  const auth = checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit) || DEFAULT_LIMIT, HARD_LIMIT);
  const tenantSlug = req.query.tenant;

  // Find candidates: status='scheduled', scheduled_at in the past, has ghl_post_id
  let q = supabaseAdmin
    .from('scheduled_posts')
    .select('id, tenant_id, ghl_post_id, status, scheduled_at, platform, brand_id')
    .eq('status', 'scheduled')
    .not('ghl_post_id', 'is', null)
    .lt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  if (tenantSlug) {
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', tenantSlug).single();
    if (!tenant) return res.status(404).json({ error: `Tenant ${tenantSlug} not found` });
    q = q.eq('tenant_id', tenant.id);
  }

  const { data: candidates, error: qErr } = await q;
  if (qErr) return res.status(500).json({ error: 'Candidate query failed: ' + qErr.message });

  if (!candidates || candidates.length === 0) {
    return res.json({
      via: auth.via, dryRun, reconciled: 0, posted: 0, failed: 0, cancelled: 0,
      untouched: 0, errors: 0, items: [], note: 'No overdue scheduled posts to reconcile.'
    });
  }

  const counts = { posted: 0, failed: 0, cancelled: 0, untouched: 0, errors: 0 };
  const items = [];

  for (const row of candidates) {
    let ghlPost, mapped;
    try {
      ghlPost = await getSocialPost(row.ghl_post_id);
    } catch (e) {
      counts.errors++;
      items.push({
        id: row.id, ghl_post_id: row.ghl_post_id, action: 'error',
        error: e.message, status: e.status || null
      });
      // 404 from GHL = post no longer exists. Mark cancelled so we don't keep polling.
      if (e.status === 404 && !dryRun) {
        await supabaseAdmin.from('scheduled_posts')
          .update({
            status: 'cancelled',
            error_msg: 'GHL post not found (404) — assumed deleted',
            updated_at: new Date().toISOString()
          })
          .eq('id', row.id);
        counts.cancelled++;
      }
      continue;
    }

    mapped = mapGhlStatus(ghlPost);
    if (!mapped.status) {
      counts.untouched++;
      items.push({ id: row.id, ghl_post_id: row.ghl_post_id, action: 'untouched', reason: mapped.reason });
      continue;
    }

    counts[mapped.status]++;
    items.push({
      id: row.id, ghl_post_id: row.ghl_post_id, action: mapped.status,
      posted_at: mapped.posted_at || null
    });

    if (!dryRun) {
      const update = {
        status: mapped.status,
        raw_response: ghlPost,
        updated_at: new Date().toISOString()
      };
      if (mapped.posted_at) update.posted_at = mapped.posted_at;
      if (mapped.error_msg) update.error_msg = mapped.error_msg;
      await supabaseAdmin.from('scheduled_posts').update(update).eq('id', row.id);
    }
  }

  const reconciled = counts.posted + counts.failed + counts.cancelled;

  // ── Propagate scheduled_posts aggregates → parent marketing_clips ──
  // For each clip touched in this run, recompute the aggregate state from ALL
  // its scheduled_posts rows and update marketing_clips.status accordingly:
  //   • all linked posts in {posted,cancelled} and at least one posted → clip 'posted'
  //   • any linked post 'failed' AND no remaining 'scheduled'/'posting'   → clip 'failed'
  //   • otherwise leave alone (still in flight)
  const clipPropagation = { posted: 0, failed: 0, untouched: 0 };
  if (!dryRun) {
    const clipIds = [...new Set(
      candidates.map((r) => r.clip_id).filter(Boolean)
    )];
    for (const clipId of clipIds) {
      const { data: rows } = await supabaseAdmin
        .from('scheduled_posts')
        .select('status, posted_at')
        .eq('clip_id', clipId);
      if (!rows || !rows.length) { clipPropagation.untouched++; continue; }

      const stats = rows.reduce((a, r) => {
        a[r.status] = (a[r.status] || 0) + 1;
        if (r.posted_at && (!a.lastPostedAt || r.posted_at > a.lastPostedAt)) {
          a.lastPostedAt = r.posted_at;
        }
        return a;
      }, {});
      const inFlight = (stats.scheduled || 0) + (stats.posting || 0) + (stats.draft || 0);

      if ((stats.posted || 0) > 0 && inFlight === 0) {
        await supabaseAdmin.from('marketing_clips').update({
          status: 'posted',
          posted_at: stats.lastPostedAt || new Date().toISOString(),
        }).eq('id', clipId);
        clipPropagation.posted++;
      } else if ((stats.failed || 0) > 0 && inFlight === 0 && !(stats.posted > 0)) {
        await supabaseAdmin.from('marketing_clips').update({
          status: 'failed',
          error_message: `${stats.failed} scheduled_posts failed — see scheduled_posts.error_msg`,
        }).eq('id', clipId);
        clipPropagation.failed++;
      } else {
        clipPropagation.untouched++;
      }
    }
  }

  return res.json({
    via: auth.via, dryRun, candidates: candidates.length,
    reconciled, ...counts, items,
    clip_propagation: clipPropagation,
  });
}
