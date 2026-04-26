// Ryujin OS — Scheduled posts CRUD (read + cancel)
//
// GET    /api/scheduled-posts                          → list (filterable)
// GET    /api/scheduled-posts?id=X                     → single row
// DELETE /api/scheduled-posts?id=X                     → cancel:
//                                                        1. Tell GHL to delete the post
//                                                        2. Mark our row status='cancelled' (we keep the row as audit)
//
// Filters on list: ?status=scheduled&brand=plus_ultra&platform=facebook&from=ISO&to=ISO&limit=N&offset=N
// Default: all non-cancelled posts, newest first, limit 100.
//
// PUT (reschedule) is deferred until there's UI to drive it. Reschedule via:
// DELETE old + POST new through /api/schedule-clip.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { deleteSocialPost } from '../lib/ghl.js';

const HARD_LIMIT = 200;
const DEFAULT_LIMIT = 100;

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('scheduled_posts')
        .select('*, brand:brands(slug,name)')
        .eq('tenant_id', tenantId).eq('id', id).single();
      if (error) return res.status(404).json({ error: 'Scheduled post not found' });
      return res.json(data);
    }

    const {
      status, brand, platform, from, to,
      limit = DEFAULT_LIMIT, offset = 0
    } = req.query;

    let q = supabaseAdmin
      .from('scheduled_posts')
      .select('*, brand:brands(slug,name)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('scheduled_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + Math.min(parseInt(limit), HARD_LIMIT) - 1);

    if (status) q = q.eq('status', status);
    else q = q.neq('status', 'cancelled');
    if (platform) q = q.eq('platform', platform);
    if (from) q = q.gte('scheduled_at', from);
    if (to) q = q.lte('scheduled_at', to);

    if (brand) {
      const { data: brandRow } = await supabaseAdmin
        .from('brands').select('id').eq('tenant_id', tenantId).eq('slug', brand).single();
      if (!brandRow) return res.json({ scheduled_posts: [], total: 0 });
      q = q.eq('brand_id', brandRow.id);
    }

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ scheduled_posts: data, total: count });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Fetch row first — we need ghl_post_id and tenant scope check
    const { data: row, error: fErr } = await supabaseAdmin
      .from('scheduled_posts')
      .select('id, status, ghl_post_id, posted_at')
      .eq('tenant_id', tenantId).eq('id', id).single();
    if (fErr || !row) return res.status(404).json({ error: 'Scheduled post not found' });

    if (row.status === 'cancelled') {
      return res.json({ ok: true, already: 'cancelled', id: row.id });
    }
    if (row.status === 'posted') {
      // Cancelling a published post means deleting it from the platform — that's destructive
      // and not what most users mean. Refuse and let them re-confirm via a separate path.
      return res.status(409).json({
        error: 'Post already published. Use the platform UI (or a future force-delete endpoint) to remove published content.',
        posted_at: row.posted_at
      });
    }

    // Try to cancel on GHL. If GHL says 404 (already gone), proceed. Other errors abort
    // so the user sees the failure and can decide what to do.
    let ghlOutcome = 'no_ghl_id';
    let ghlError = null;
    if (row.ghl_post_id) {
      try {
        await deleteSocialPost(row.ghl_post_id);
        ghlOutcome = 'deleted';
      } catch (e) {
        if (e.status === 404) {
          ghlOutcome = 'already_gone';
        } else {
          ghlError = e.message || String(e);
          // Soft fail: still mark our side cancelled so the UI doesn't keep showing it
          // as scheduled. Surface the GHL error so user knows to verify in GHL UI.
          ghlOutcome = 'ghl_error';
        }
      }
    }

    const { error: uErr } = await supabaseAdmin
      .from('scheduled_posts')
      .update({
        status: 'cancelled',
        error_msg: ghlError ? `Cancel: GHL delete failed — ${ghlError}` : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id).eq('tenant_id', tenantId);
    if (uErr) return res.status(500).json({ error: 'cancel update failed: ' + uErr.message });

    return res.json({
      ok: true, id, ghl: ghlOutcome,
      ...(ghlError ? { ghl_error: ghlError, note: 'Local row cancelled but GHL delete failed — verify in GHL UI.' } : {})
    });
  }

  return res.status(405).json({ error: 'GET or DELETE only' });
}

export default requireTenant(handler);
