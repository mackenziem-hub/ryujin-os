// Auth headers for server-to-server calls to the now-gated /api/snapshot.
//
// /api/snapshot carries customer PII + revenue, so it requires a session
// (resolveSession in lib/portalAuth.js). Cron agents and server libs that
// self-call the endpoint authenticate with RYUJIN_SERVICE_TOKEN, which
// resolveSession maps to a synthetic admin session scoped to x-tenant-id.
//
// Read the env at call time (not module load) so a rotated token is picked up
// without a cold start. If the token is unset this returns only x-tenant-id and
// the call will 401 -- the correct fail-closed behaviour, never a silent leak.
export function snapshotHeaders(extra = {}) {
  const token = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  return {
    'Content-Type': 'application/json',
    'x-tenant-id': 'plus-ultra',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
