// ═══════════════════════════════════════════════════════════════
// RYUJIN FLEET — Guild Hall coordination bus
//
// Desk state (original, PR #380):
//   POST /api/fleet                      — a desk reports its session state
//   GET  /api/fleet                      — all desks + the full bus snapshot
//
// Coordination bus (PR: leave-OneDrive dispatch migration):
//   POST /api/fleet {action:'order.create', deskId, order}  — foreman dispatches an order
//   POST /api/fleet {action:'order.update', deskId, orderId, status, result}  — desk ack/done
//   GET  /api/fleet?orders=<deskId>[&status=pending]         — a desk pulls its queue
//   POST /api/fleet {action:'situation.set', situation}      — operator posts latest situation
//   POST /api/fleet {action:'advice.set', advice}            — consultant posts latest advice
//   POST /api/fleet {action:'deploy.acquire', holder, purpose} — atomic deploy lock
//   POST /api/fleet {action:'deploy.release', token}         — release the deploy lock
//   POST /api/fleet {action:'deploy.status'}                 — read the current holder
//
// Storage: Vercel Blob versioned keys (no migration), one ISOLATED namespace
// per channel. CRITICAL: orders/situation/advice/deploy-lock do NOT share the
// desk-state blob. The desk-state blob is rewritten on every heartbeat; folding
// orders into it would let a heartbeat clobber a freshly dispatched order — the
// exact OneDrive-clobber failure this migration removes. Each channel below
// owns its own prefix so the high-frequency heartbeat write can never touch it.
//
// Why Blob: tenant_settings has fixed columns (migration 007); a new key would
// need a hand-apply migration. Blob is the genuine no-migration path. list() is
// API-backed (never CDN-cached), so newest-by-key discovery is always fresh.
// ═══════════════════════════════════════════════════════════════

import { put, list, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const FLEET_VERSIONED_PREFIX = 'ryujin-fleet-v/';        // desk state (unchanged)
const ORDERS_PREFIX          = 'ryujin-fleet-orders-v/'; // per-order blobs, per desk
const SITUATION_PREFIX       = 'ryujin-fleet-situation-v/';
const ADVICE_PREFIX          = 'ryujin-fleet-advice-v/';
const DEPLOYLOCK_PREFIX      = 'ryujin-fleet-deploylock-v/';

// A desk is "stale" if its last server-stamped report is older than this.
const STALE_MS = 30 * 60 * 1000;
// A held deploy lock auto-expires after this so a crashed holder never wedges
// the deploy queue. A real deploy is minutes; 20 covers a slow one with margin.
const DEPLOY_LOCK_TTL_MS = 20 * 60 * 1000;
// Per-desk order retention: keep this many done orders (newest), prune older.
const DONE_ORDER_KEEP = 10;

// Codepoint compare: collation must never depend on locale.
function byPathnameDesc(a, b) {
  return b.pathname < a.pathname ? -1 : b.pathname > a.pathname ? 1 : 0;
}
function byPathnameAsc(a, b) {
  return a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0;
}

// Zero-padded ms epoch keeps pathname sort == time sort. Stamped SERVER-side
// (here, on Vercel) so desk clock skew never affects ordering or the lock.
function tsKey() {
  return String(Date.now()).padStart(15, '0');
}

async function putKey(key, data) {
  await put(key, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
}

async function fetchBlobJson(url) {
  const resp = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!resp.ok) throw new Error(`blob fetch HTTP ${resp.status}`);
  return await resp.json();
}

// ── Desk state (original behavior, unchanged) ────────────────────────────────

async function getFleet() {
  const { blobs } = await list({ prefix: FLEET_VERSIONED_PREFIX, limit: 1000 });
  if (blobs.length === 0) return { desks: {}, updatedAt: null };
  const newest = blobs.sort(byPathnameDesc)[0];
  return await fetchBlobJson(newest.url);
}

async function saveFleet(data) {
  const key = `${FLEET_VERSIONED_PREFIX}${tsKey()}.json`;
  await putKey(key, data);
  // Best-effort prune: keep the 3 newest desk-state versions.
  try {
    const { blobs } = await list({ prefix: FLEET_VERSIONED_PREFIX, limit: 1000 });
    const stale = blobs.sort(byPathnameDesc).slice(3).map(b => b.url);
    if (stale.length) await del(stale);
  } catch { /* prune failure never blocks a report write */ }
}

function withStaleness(fleet) {
  const now = Date.now();
  const desks = {};
  for (const [id, d] of Object.entries(fleet.desks || {})) {
    const stampedAt = d.receivedAt ? Date.parse(d.receivedAt) : NaN;
    const ageMs = Number.isFinite(stampedAt) ? now - stampedAt : null;
    desks[id] = { ...d, ageMs, stale: ageMs == null ? true : ageMs > STALE_MS };
  }
  return { desks, updatedAt: fleet.updatedAt || null, staleAfterMs: STALE_MS };
}

const ALLOWED_FIELDS = [
  'deskId', 'machine', 'lane', 'task', 'status',
  'progress', 'queue', 'lastTool', 'updatedAt', 'usageEvents',
];

// ── Orders channel (one blob per order, isolated from heartbeats) ────────────

// deskId is validated by the caller; orderId is server-minted (tsKey + uuid)
// so it is sortable and unguessable. Deterministic key from (deskId, orderId)
// means ack/update rewrites the same blob without an index lookup.
function orderKey(deskId, orderId) {
  return `${ORDERS_PREFIX}${deskId}/${orderId}.json`;
}

const VALID_ORDER_STATUS = new Set(['pending', 'acked', 'done', 'cancelled']);

async function listDeskOrders(deskId) {
  const { blobs } = await list({ prefix: `${ORDERS_PREFIX}${deskId}/`, limit: 1000 });
  if (!blobs.length) return [];
  const sorted = blobs.sort(byPathnameAsc);
  const out = [];
  for (const b of sorted) {
    try { out.push(await fetchBlobJson(b.url)); } catch { /* skip a corrupt order */ }
  }
  return out;
}

async function createOrder(deskId, order) {
  const orderId = `${tsKey()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const priority = order.priority === 'P0' ? 'P0' : 'P1';
  const entry = {
    id: orderId,
    deskId,
    priority,
    title: String(order.title || '').slice(0, 200),
    prompt: String(order.prompt || ''),
    issuedBy: String(order.issuedBy || 'foreman').slice(0, 32),
    status: 'pending',
    issuedAt: now,
    ackedAt: null,
    doneAt: null,
    result: null,
  };
  await putKey(orderKey(deskId, orderId), entry);
  pruneDoneOrders(deskId).catch(() => {});
  return entry;
}

async function updateOrder(deskId, orderId, patch) {
  const key = orderKey(deskId, orderId);
  // Fetch the current order via its deterministic key. list() returns the url.
  const { blobs } = await list({ prefix: key, limit: 1 });
  if (!blobs.length) return null;
  let current;
  try { current = await fetchBlobJson(blobs[0].url); } catch { return null; }
  const next = { ...current };
  if (patch.status && VALID_ORDER_STATUS.has(patch.status)) next.status = patch.status;
  if (patch.result !== undefined) next.result = patch.result === null ? null : String(patch.result);
  const now = new Date().toISOString();
  if (next.status === 'acked' && !next.ackedAt) next.ackedAt = now;
  if (next.status === 'done' || next.status === 'cancelled') next.doneAt = now;
  await putKey(key, next);
  return next;
}

async function pruneDoneOrders(deskId) {
  const { blobs } = await list({ prefix: `${ORDERS_PREFIX}${deskId}/`, limit: 1000 });
  const done = [];
  for (const b of blobs) {
    try {
      const o = await fetchBlobJson(b.url);
      if (o.status === 'done' || o.status === 'cancelled') done.push({ url: b.url, pathname: b.pathname });
    } catch { /* ignore */ }
  }
  const stale = done.sort(byPathnameDesc).slice(DONE_ORDER_KEEP).map(b => b.url);
  if (stale.length) await del(stale);
}

// ── Situation / advice channels (single latest, newest-by-key) ───────────────

async function getLatest(prefix) {
  const { blobs } = await list({ prefix, limit: 1000 });
  if (!blobs.length) return null;
  const newest = blobs.sort(byPathnameDesc)[0];
  try { return await fetchBlobJson(newest.url); } catch { return null; }
}

async function setLatest(prefix, payload, by) {
  const entry = { ...payload, postedBy: by || null, postedAt: new Date().toISOString() };
  await putKey(`${prefix}${tsKey()}.json`, entry);
  // Keep the 3 newest; the latest is the live value, the rest are short history.
  try {
    const { blobs } = await list({ prefix, limit: 1000 });
    const stale = blobs.sort(byPathnameDesc).slice(3).map(b => b.url);
    if (stale.length) await del(stale);
  } catch { /* prune never blocks the write */ }
  return entry;
}

// ── Deploy lock (Lamport leader-election over server-stamped keys) ───────────
//
// All builders hold deploy keys; only one may deploy at a time, always from
// freshly-fetched main. Vercel Blob has no compare-and-swap, so a read-merge-
// write lock would race. Instead: each acquirer writes its OWN intent blob
// (a unique key, never clobbered), then the EARLIEST non-expired intent by
// server-stamped key wins. Keys are stamped here (server clock), so desk clock
// skew is irrelevant. A loser deletes its own intent so the queue stays clean.

function deployLockKey(token) {
  return `${DEPLOYLOCK_PREFIX}${token}.json`;
}

async function listLiveLocks() {
  const { blobs } = await list({ prefix: DEPLOYLOCK_PREFIX, limit: 1000 });
  const now = Date.now();
  const live = [];
  const expired = [];
  for (const b of blobs) {
    let entry;
    try { entry = await fetchBlobJson(b.url); } catch { continue; }
    const acquiredMs = entry.acquiredAt ? Date.parse(entry.acquiredAt) : NaN;
    const isExpired = !Number.isFinite(acquiredMs) || (now - acquiredMs) > DEPLOY_LOCK_TTL_MS;
    (isExpired ? expired : live).push({ ...entry, _url: b.url, _pathname: b.pathname });
  }
  // Best-effort sweep of expired intents (crashed holders).
  if (expired.length) { try { await del(expired.map(e => e._url)); } catch { /* ignore */ } }
  // Earliest server-stamped key wins.
  live.sort((a, b) => (a._pathname < b._pathname ? -1 : a._pathname > b._pathname ? 1 : 0));
  return live;
}

async function acquireDeployLock(holder, purpose) {
  const token = `${tsKey()}-${randomUUID().slice(0, 8)}`;
  const entry = {
    token,
    holder: String(holder || 'unknown').slice(0, 64),
    purpose: String(purpose || '').slice(0, 200),
    acquiredAt: new Date().toISOString(),
  };
  await putKey(deployLockKey(token), entry);
  const live = await listLiveLocks();
  const winner = live[0];
  if (winner && winner.token === token) {
    return { ok: true, token, holder: entry.holder, acquiredAt: entry.acquiredAt };
  }
  // Lost the election: drop our intent so we do not block the queue.
  try { await del(deployLockKey(token)); } catch { /* ignore */ }
  const held = winner ? { holder: winner.holder, purpose: winner.purpose, acquiredAt: winner.acquiredAt } : null;
  return { ok: false, busy: true, holder: held };
}

async function releaseDeployLock(token) {
  if (!token) return { ok: false, error: 'token required' };
  try { await del(deployLockKey(String(token))); } catch { /* idempotent */ }
  return { ok: true, released: String(token) };
}

async function deployLockStatus() {
  const live = await listLiveLocks();
  const winner = live[0];
  return {
    locked: !!winner,
    holder: winner ? { holder: winner.holder, purpose: winner.purpose, acquiredAt: winner.acquiredAt, token: winner.token } : null,
    waiting: Math.max(0, live.length - 1),
  };
}

// ── Full bus snapshot (GET, no query) ────────────────────────────────────────

async function getBusSnapshot() {
  const [fleet, situation, advice, lock] = await Promise.all([
    getFleet().catch(() => ({ desks: {}, updatedAt: null })),
    getLatest(SITUATION_PREFIX).catch(() => null),
    getLatest(ADVICE_PREFIX).catch(() => null),
    deployLockStatus().catch(() => ({ locked: false, holder: null, waiting: 0 })),
  ]);
  // Orders per desk (pending + acked), discovered from the orders namespace.
  const orders = {};
  try {
    const { blobs } = await list({ prefix: ORDERS_PREFIX, limit: 1000 });
    const deskIds = new Set();
    for (const b of blobs) {
      const rest = b.pathname.slice(ORDERS_PREFIX.length);
      const slash = rest.indexOf('/');
      if (slash > 0) deskIds.add(rest.slice(0, slash));
    }
    for (const deskId of deskIds) {
      orders[deskId] = (await listDeskOrders(deskId)).filter(o => o.status === 'pending' || o.status === 'acked');
    }
  } catch { /* orders best-effort in the aggregate view */ }
  return { ...withStaleness(fleet), orders, situation, advice, deployLock: lock };
}

// ── Handler ──────────────────────────────────────────────────────────────────

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Both verbs are internal-only. A valid session (real owner/admin login or
  // the service token + x-tenant-id) is required; the fleet is not public.
  const session = await resolveSession(req).catch(() => null);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });

  if (req.method === 'GET') {
    // A desk pulls its own order queue: GET ?orders=<deskId>[&status=pending]
    const ordersFor = String(req.query.orders || '').trim();
    if (ordersFor) {
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(ordersFor)) {
        return res.status(400).json({ error: 'orders=<deskId> must be 1-16 alphanumeric chars' });
      }
      try {
        let deskOrders = await listDeskOrders(ordersFor);
        const statusFilter = String(req.query.status || '').trim();
        if (statusFilter) {
          if (statusFilter === 'pending') deskOrders = deskOrders.filter(o => o.status === 'pending');
          else if (statusFilter === 'open') deskOrders = deskOrders.filter(o => o.status === 'pending' || o.status === 'acked');
          else if (VALID_ORDER_STATUS.has(statusFilter)) deskOrders = deskOrders.filter(o => o.status === statusFilter);
          else return res.status(400).json({ error: `status must be 'open' or one of ${[...VALID_ORDER_STATUS].join(', ')}` });
        }
        return res.status(200).json({ deskId: ordersFor, orders: deskOrders });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    // Full coordination-bus snapshot (desks + orders + situation + advice +
    // deploy lock) only when explicitly asked, so the frequent desk-monitor
    // poll keeps its original lean shape + latency.
    if (String(req.query.bus || '') === '1') {
      try {
        return res.status(200).json(await getBusSnapshot());
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    // Default: desk state only (original PR #380 GET shape, unchanged).
    try {
      return res.status(200).json(withStaleness(await getFleet()));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    // Every write is privileged (service token or owner/admin).
    if (!isPrivileged(session)) return res.status(403).json({ error: 'admin_only', code: 'FORBIDDEN' });

    const body = req.body || {};
    const action = String(body.action || 'report').trim();

    try {
      // ── Coordination-bus actions ──
      if (action === 'order.create') {
        const deskId = String(body.deskId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,16}$/.test(deskId)) return res.status(400).json({ error: 'deskId required (1-16 alphanumeric chars)' });
        const order = body.order || {};
        if (!order.prompt || !String(order.prompt).trim()) return res.status(400).json({ error: 'order.prompt required' });
        const created = await createOrder(deskId, order);
        return res.status(200).json({ ok: true, orderId: created.id, order: created });
      }

      if (action === 'order.update') {
        const deskId = String(body.deskId || '').trim();
        const orderId = String(body.orderId || '').trim();
        if (!/^[A-Za-z0-9_-]{1,16}$/.test(deskId)) return res.status(400).json({ error: 'deskId required (1-16 alphanumeric chars)' });
        if (!/^[0-9]{15}-[a-f0-9]{8}$/.test(orderId)) return res.status(400).json({ error: 'valid orderId required' });
        if (body.status && !VALID_ORDER_STATUS.has(String(body.status))) return res.status(400).json({ error: `status must be one of ${[...VALID_ORDER_STATUS].join(', ')}` });
        const updated = await updateOrder(deskId, orderId, { status: body.status, result: body.result });
        if (!updated) return res.status(404).json({ error: 'order not found' });
        return res.status(200).json({ ok: true, order: updated });
      }

      if (action === 'situation.set') {
        if (!body.situation || typeof body.situation !== 'object') return res.status(400).json({ error: 'situation object required' });
        const entry = await setLatest(SITUATION_PREFIX, body.situation, body.by || 'operator');
        return res.status(200).json({ ok: true, situation: entry });
      }

      if (action === 'advice.set') {
        if (!body.advice || typeof body.advice !== 'object') return res.status(400).json({ error: 'advice object required' });
        const entry = await setLatest(ADVICE_PREFIX, body.advice, body.by || 'consultant');
        return res.status(200).json({ ok: true, advice: entry });
      }

      if (action === 'deploy.acquire') {
        const result = await acquireDeployLock(body.holder, body.purpose);
        return res.status(result.ok ? 200 : 409).json(result);
      }

      if (action === 'deploy.release') {
        return res.status(200).json(await releaseDeployLock(body.token));
      }

      if (action === 'deploy.status') {
        return res.status(200).json(await deployLockStatus());
      }

      // ── Default: desk-state report (original PR #380 behavior, unchanged) ──
      if (action === 'report') {
        const deskId = String(body.deskId || '').trim();
        if (!deskId || !/^[A-Za-z0-9_-]{1,16}$/.test(deskId)) {
          return res.status(400).json({ error: 'deskId required (1-16 alphanumeric chars)' });
        }
        const entry = { receivedAt: new Date().toISOString() };
        for (const k of ALLOWED_FIELDS) {
          if (body[k] !== undefined) entry[k] = body[k];
        }
        entry.deskId = deskId;
        const fleet = await getFleet();
        const desks = { ...(fleet.desks || {}), [deskId]: entry };
        const next = { desks, updatedAt: new Date().toISOString() };
        await saveFleet(next);
        return res.status(200).json({ ok: true, deskId, ...withStaleness(next) });
      }

      return res.status(400).json({ error: `unknown action '${action}'` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

export default requireTenant(handler);
