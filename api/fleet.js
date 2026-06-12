// ═══════════════════════════════════════════════════════════════
// RYUJIN FLEET — Guild Hall desk state bridge
// POST /api/fleet — a desk reports its session state (service-token auth)
// GET  /api/fleet — all desks for the Builder Room / command-center / deck
// Storage: Vercel Blob (versioned key, no migration). The fleet lives in
//   local hub/sessions/*.json on Mac's PCs; a deployed Ryujin page cannot
//   read that disk, so each desk POSTs its state here on every heartbeat
//   fire (see _brain/hub/heartbeat.mjs). This is design-lock D4 option (a).
//
// Why Blob and not tenant_settings: tenant_settings has fixed columns
// (migration 007), so a new `fleet` key would need a hand-apply migration.
// Blob is the genuine no-migration path and mirrors how /api/snapshot
// already stores its operational cache. Versioned keys defeat the CDN
// staleness that bit the snapshot brief-wipe (list() is API-backed, never
// CDN-cached, so newest-by-key discovery is always fresh).
// ═══════════════════════════════════════════════════════════════

import { put, list, del } from '@vercel/blob';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const FLEET_VERSIONED_PREFIX = 'ryujin-fleet-v/';

// A desk is "stale" if its last server-stamped report is older than this.
// Judge liveness by when the report landed on the server, NOT the desk's
// self-reported updatedAt (env-less terminals have skewed/frozen clocks;
// memory reference: judge worker liveness by inbox activity, not timestamps).
const STALE_MS = 30 * 60 * 1000;

// Codepoint compare, descending: collation must never depend on locale.
function byPathnameDesc(a, b) {
  return b.pathname < a.pathname ? -1 : b.pathname > a.pathname ? 1 : 0;
}

async function getFleet() {
  const { blobs } = await list({ prefix: FLEET_VERSIONED_PREFIX, limit: 1000 });
  if (blobs.length === 0) return { desks: {}, updatedAt: null };
  const newest = blobs.sort(byPathnameDesc)[0];
  const resp = await fetch(newest.url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`fleet blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

async function saveFleet(data) {
  // Zero-padded ms epoch keeps pathname sort == time sort.
  const key = `${FLEET_VERSIONED_PREFIX}${String(Date.now()).padStart(15, '0')}.json`;
  await put(key, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  // Best-effort prune: keep the 3 newest versions (rolling monitor cache,
  // rewritten every heartbeat; not user data).
  try {
    const { blobs } = await list({ prefix: FLEET_VERSIONED_PREFIX, limit: 1000 });
    const stale = blobs.sort(byPathnameDesc).slice(3).map(b => b.url);
    if (stale.length) await del(stale);
  } catch {
    // Prune failure never blocks a report write.
  }
}

// Annotate each desk with server-side staleness so every consumer (Builder
// Room cards, command-center pips, fleet deck) reads the same liveness rule.
function withStaleness(fleet) {
  const now = Date.now();
  const desks = {};
  for (const [id, d] of Object.entries(fleet.desks || {})) {
    const stampedAt = d.receivedAt ? Date.parse(d.receivedAt) : NaN;
    const ageMs = Number.isFinite(stampedAt) ? now - stampedAt : null;
    desks[id] = {
      ...d,
      ageMs,
      stale: ageMs == null ? true : ageMs > STALE_MS,
    };
  }
  return { desks, updatedAt: fleet.updatedAt || null, staleAfterMs: STALE_MS };
}

const ALLOWED_FIELDS = [
  'deskId', 'machine', 'lane', 'task', 'status',
  'progress', 'queue', 'lastTool', 'updatedAt', 'usageEvents',
];

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Both verbs are internal-only. A valid session (a real owner/admin login
  // or the service token + x-tenant-id) is required; the fleet is not public.
  const session = await resolveSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });

  if (req.method === 'GET') {
    let fleet;
    try {
      fleet = await getFleet();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    return res.status(200).json(withStaleness(fleet));
  }

  if (req.method === 'POST') {
    // Writing fleet state is privileged (service token or owner/admin).
    if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });

    const body = req.body || {};
    const deskId = String(body.deskId || '').trim();
    if (!deskId || !/^[A-Za-z0-9_-]{1,16}$/.test(deskId)) {
      return res.status(400).json({ error: 'deskId required (1-16 alphanumeric chars)' });
    }

    // Keep only known fields; stamp the server receive time (the liveness basis).
    const entry = { receivedAt: new Date().toISOString() };
    for (const k of ALLOWED_FIELDS) {
      if (body[k] !== undefined) entry[k] = body[k];
    }
    entry.deskId = deskId;

    // Read-merge-write. Each desk owns its own key; a concurrent POST from
    // another desk can drop this update under a last-write-wins race, but
    // heartbeats re-report every poll so the fleet self-heals within one
    // cycle. Acceptable for an internal monitor; a dedicated fleet_sessions
    // table (per-row upsert, race-free) is the upgrade path if this matters.
    let fleet;
    try {
      fleet = await getFleet();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    const desks = { ...(fleet.desks || {}), [deskId]: entry };
    const next = { desks, updatedAt: new Date().toISOString() };
    try {
      await saveFleet(next);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    return res.status(200).json({ ok: true, deskId, ...withStaleness(next) });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

export default requireTenant(handler);
