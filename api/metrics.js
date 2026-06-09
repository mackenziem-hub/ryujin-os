// ═══════════════════════════════════════════════════════════════
// METRICS — live canonical KPIs (metrics contract v1).
//
// GET /api/metrics — computes the cross-page KPI set from Supabase in one
// place (lib/metricsContract.js). Pages must render value+label as shipped;
// no page-side math or labels. The hourly snapshot rebuild writes the same
// compute to sections.metrics for the fast cached path.
//
// Gated: exposes revenue numbers, so portal session (or service token)
// required, not just tenant resolution.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { computeMetrics } from '../lib/metricsContract.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  try {
    const metrics = await computeMetrics(supabaseAdmin, req.tenant.id);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json(metrics);
  } catch (e) {
    console.error('[metrics] compute failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

export default requirePortalSessionAndTenant(handler);
