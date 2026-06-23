// Ryujin OS — Proposal Activity Live Feed
//
// GET /api/proposal-activity-feed — a tenant-scoped, newest-first stream of
// proposal engagement events (opens, views, envelope reveals, tier compares,
// PDF saves, accepts) for the live Proposal Activity wallboard. Read-only.
//
// Open-tracking events live in activity_log keyed by entity_id = estimate id.
// We scope by tenant_id (indexed: idx_activity_tenant on tenant_id, created_at
// desc), pull the recent slice, resolve each to its estimate + customer, drop
// non-customer noise (created/updated/beacon_selftest), and classify a kind.

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveSession } from '../lib/portalAuth.js';

// Events that mean "a human engaged with the proposal" — everything else
// (record edits, the beacon self-test, soft-deletes) is noise for the feed.
const NOISE = new Set(['created', 'updated', 'deleted', 'beacon_selftest', 'cancelled']);

function classify(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('accept')) return 'accept';
  if (a.includes('video')) return 'video';
  if (a.includes('pdf')) return 'pdf';
  if (a.includes('tier') || a.includes('scope') || a.includes('envelope')) return 'explore';
  if (a.includes('viewed') || a.includes('opened') || a.includes('view')) return 'view';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. GET only.' });
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  const tenantId = session.tenant_id || null;
  if (!tenantId) return res.json({ events: [], generatedAt: new Date().toISOString() });

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('activity_log')
      .select('entity_id, entity_type, action, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(160);
    if (error) return res.status(500).json({ error: 'feed_failed', message: error.message });

    // Keep only customer-engagement events that resolve to an estimate.
    const meaningful = (rows || []).filter(r => {
      const a = String(r.action || '').toLowerCase();
      return r.entity_id && !NOISE.has(a) && classify(a);
    });
    const ids = [...new Set(meaningful.map(r => r.entity_id))].slice(0, 120);

    const meta = new Map();
    if (ids.length) {
      const { data: est } = await supabaseAdmin
        .from('estimates')
        .select('id, estimate_number, share_token, status, customer:customers(full_name, address, city)')
        .eq('tenant_id', tenantId)
        .in('id', ids);
      for (const e of (est || [])) {
        const c = e.customer || {};
        meta.set(e.id, {
          customer: c.full_name || ('Proposal ' + (e.estimate_number || '')),
          address: [c.address, c.city].filter(Boolean).join(', '),
          shareToken: e.share_token || null,
          status: e.status || null,
          number: e.estimate_number || null
        });
      }
    }

    const events = [];
    for (const r of meaningful) {
      const m = meta.get(r.entity_id);
      if (!m) continue; // event not backed by one of this tenant's estimates
      events.push({
        customer: m.customer,
        address: m.address,
        shareToken: m.shareToken,
        status: m.status,
        kind: classify(r.action),
        action: r.action,
        ts: r.created_at
      });
      if (events.length >= 60) break;
    }

    return res.json({ events, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'feed_failed', message: e.message });
  }
}
