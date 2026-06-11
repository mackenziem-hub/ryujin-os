// ═══════════════════════════════════════════════════════════════
// ROOF TILE: satellite image proxy for the instant estimator's
// "that's my roof" confirm moment.
//
// GET /api/roof-tile?lat=46.08&lng=-64.77&tenant=plus-ultra
//   Streams a Google Static Maps satellite tile centered on the
//   coordinates roof-lookup already returned. The key stays server
//   side (it is marked sensitive in Vercel and must never reach the
//   browser).
//
// Fail-open by design: any upstream failure (Static Maps API not
// enabled on the key yet, quota, bad coords) returns a non-200 with
// no body, and the estimator's <img onerror> hides the tile while
// the confirm card still renders the measured numbers.
// ═══════════════════════════════════════════════════════════════

import { requireTenant } from '../lib/tenant.js';

const KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const FETCH_TIMEOUT_MS = 5000;

// Hotlink guard: this is otherwise an open proxy that spends Google quota on
// arbitrary world coordinates. A third-party page embedding the URL sends its
// own origin as Referer and gets a 403. Empty referer is allowed (privacy
// strippers; those callers still hit the rate limit).
const ALLOWED_REFERER_HOSTS = new Set([
  'ryujin-os.vercel.app',
  'plusultraroofing.com',
  'www.plusultraroofing.com',
  'localhost',
  '127.0.0.1'
]);

function refererBlocked(req) {
  const ref = req.headers.referer || req.headers.origin || '';
  if (!ref) return false;
  try {
    return !ALLOWED_REFERER_HOSTS.has(new URL(ref).hostname);
  } catch {
    return true;
  }
}

// Same soft per-instance limiter as roof-lookup: public unauthenticated
// endpoint that spends Google quota per call.
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 1000) hits.clear();
  const rec = hits.get(ip);
  if (!rec || now - rec.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();
  if (!KEY) return res.status(404).end();
  if (refererBlocked(req)) return res.status(403).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) return res.status(429).end();

  const lat = Number(req.query?.lat);
  const lng = Number(req.query?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).end();
  }

  const url = 'https://maps.googleapis.com/maps/api/staticmap'
    + `?center=${lat.toFixed(6)},${lng.toFixed(6)}`
    + '&zoom=20&size=640x400&scale=2&maptype=satellite'
    + `&key=${KEY}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(url, { signal: ctrl.signal });
    const type = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !type.startsWith('image/')) {
      return res.status(502).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', type);
    // Imagery for a fixed coordinate is stable; let the CDN keep it a day.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(e.name === 'AbortError' ? 504 : 502).end();
  } finally {
    clearTimeout(timer);
  }
}

export default requireTenant(handler);
