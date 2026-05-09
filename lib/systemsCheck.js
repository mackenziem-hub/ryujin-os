// Systems health check — token expiry, snapshot freshness, API reachability.

const SHENRON_BASE = 'https://ryujin-os.vercel.app';

async function ping(url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(opts.timeout || 6000), ...opts });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

export async function runSystemsCheck() {
  const checks = {};

  // Snapshot freshness
  try {
    const r = await fetch(`${SHENRON_BASE}/api/snapshot`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const d = await r.json();
      const enriched = d.updated_at || d.enrichedAt || d.timestamp || null;
      const ageMin = enriched ? Math.round((Date.now() - new Date(enriched).getTime()) / 60000) : null;
      checks.snapshot = {
        ok: ageMin != null && ageMin < 60 * 26,
        ageMinutes: ageMin,
        enrichedAt: enriched
      };
    } else {
      checks.snapshot = { ok: false, status: r.status };
    }
  } catch (e) { checks.snapshot = { ok: false, error: e.message }; }

  // Meta token expiry
  try {
    const token = (process.env.META_ACCESS_TOKEN || '').trim();
    if (token) {
      const r = await fetch(`https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        const expiresAt = d.data?.expires_at ? d.data.expires_at * 1000 : null;
        const isValid = d.data?.is_valid;
        const daysLeft = expiresAt ? Math.round((expiresAt - Date.now()) / (24 * 3600000)) : null;
        checks.metaToken = { ok: !!isValid && (daysLeft === null || daysLeft > 7), daysLeft, isValid };
      } else {
        checks.metaToken = { ok: false, status: r.status };
      }
    } else {
      checks.metaToken = { ok: false, error: 'no token' };
    }
  } catch (e) { checks.metaToken = { ok: false, error: e.message }; }

  // External API reachability
  const apis = [
    ['estimatorOS', 'https://estimator-os.replit.app/api/stats', { 'x-api-key': 'pu-estimator-2026' }],
    ['actionBoard', 'https://ultra-task-manager.replit.app/api/stats', { 'x-api-key': 'pu-actionboard-2026' }],
    ['instantEstimator', 'https://plus-ultra-roof-estimator.replit.app/api/stats', { 'x-api-key': 'pu-instantest-2026' }],
    ['ghl', `${SHENRON_BASE}/api/ghl?mode=ping`, {}]
  ];
  const results = await Promise.all(apis.map(([k, u, h]) => ping(u, { headers: h }).then(r => [k, r])));
  for (const [k, r] of results) checks[k] = r;

  // Summary
  const allOk = Object.values(checks).every(c => c.ok !== false);
  return { ok: allOk, checks };
}
