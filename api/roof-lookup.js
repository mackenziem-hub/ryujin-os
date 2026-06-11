// ═══════════════════════════════════════════════════════════════
// ROOF LOOKUP: instant roof measurement from a street address.
//
// POST /api/roof-lookup
//   body: { address, city? }
//   1. Google Geocoding (country:CA) → lat/lng
//   2. Google Solar buildingInsights:findClosest → roof area + pitch
//   3. Returns { ok:true, roofSqft, sq, pitchBand, ... } on a confident hit
//
// Soft misses return 200 { ok:false, reason } so the estimator falls back
// to its manual questions without surfacing an error to the homeowner.
//
// Two confidence gates, both from the 2026-06-10 batch validation of 10
// addresses against paid EagleView reports (median abs delta 7.5%):
//   GATE 1: geocode location_type must be ROOFTOP. An APPROXIMATE result
//           (town centroid) measures a stranger's roof with full confidence.
//   GATE 2: Solar building center must be ≤15 m from the geocoded pin.
//           The one +29% outlier in validation sat 24 m out; every roof
//           within ±10% was ≤4 m.
// ═══════════════════════════════════════════════════════════════

import { requireTenant } from '../lib/tenant.js';

const KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
const MAX_CENTER_DIST_M = 15;
const FETCH_TIMEOUT_MS = 4000;
const SQFT_PER_M2 = 10.764;

// Per-instance soft rate limit. This endpoint spends Google quota on every
// call and sits unauthenticated behind a public form, so a runaway client
// gets cut off per warm lambda. Not durable across instances by design.
const RATE_LIMIT = 20;
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

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bands match the instant estimator's PITCH_MAP options
// (walkable 4/12 · moderate 8/12 · steep 10/12 · very_steep 13/12).
function pitchBand(x12) {
  if (x12 <= 6.49) return 'walkable';
  if (x12 <= 9.49) return 'moderate';
  if (x12 <= 12.49) return 'steep';
  return 'very_steep';
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function miss(res, reason, extra = {}) {
  return res.status(200).json({ ok: false, reason, ...extra });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!KEY) return miss(res, 'not_configured');

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (rateLimited(ip)) return miss(res, 'rate_limited');

  const body = req.body || {};
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim();
  if (address.length < 5 || !/\d/.test(address)) {
    return res.status(400).json({ ok: false, reason: 'address_required' });
  }

  try {
    // 1. geocode
    const q = encodeURIComponent(city ? `${address}, ${city}` : address);
    const geo = await fetchJson(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&components=country:CA&key=${KEY}`
    );
    const g = geo.json || {};
    if (g.status !== 'OK' || !g.results?.length) {
      return miss(res, `geocode_${String(g.status || 'error').toLowerCase()}`);
    }
    const result = g.results[0];
    const locType = result.geometry?.location_type;
    if (locType !== 'ROOFTOP') {
      return miss(res, 'geocode_not_rooftop', { locationType: locType || null });
    }
    const { lat, lng } = result.geometry.location;
    const postal = (result.address_components || [])
      .find(c => (c.types || []).includes('postal_code'))?.long_name || null;

    // 2. solar building insights
    const sol = await fetchJson(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=MEDIUM&key=${KEY}`
    );
    if (sol.status === 404) return miss(res, 'no_building');
    if (sol.status !== 200) return miss(res, `solar_${sol.status}`);
    const ins = sol.json || {};

    const center = ins.center;
    const centerDistM = center
      ? Math.round(haversineMeters(lat, lng, center.latitude, center.longitude))
      : NaN;
    if (!Number.isFinite(centerDistM) || centerDistM > MAX_CENTER_DIST_M) {
      return miss(res, 'low_confidence', { centerDistM: Number.isFinite(centerDistM) ? centerDistM : null });
    }

    const areaM2 = ins.solarPotential?.wholeRoofStats?.areaMeters2 || 0;
    if (!areaM2) return miss(res, 'no_roof_area');

    const segs = ins.solarPotential?.roofSegmentStats || [];
    const segArea = segs.reduce((s, x) => s + (x.stats?.areaMeters2 || 0), 0);
    const pitchDeg = segArea
      ? segs.reduce((s, x) => s + (x.pitchDegrees || 0) * (x.stats?.areaMeters2 || 0), 0) / segArea
      : 0;
    const pitchX12 = Math.tan(pitchDeg * Math.PI / 180) * 12;
    const roofSqft = Math.round(areaM2 * SQFT_PER_M2);

    return res.status(200).json({
      ok: true,
      lat,
      lng,
      roofSqft,
      sq: Math.round(roofSqft / 10) / 10,
      pitchX12: Math.round(pitchX12 * 10) / 10,
      pitchBand: pitchBand(pitchX12),
      segments: segs.length,
      imageryQuality: ins.imageryQuality || null,
      imageryYear: ins.imageryDate?.year || null,
      centerDistM,
      formattedAddress: result.formatted_address || null,
      postal
    });
  } catch (e) {
    return miss(res, e.name === 'AbortError' ? 'timeout' : 'lookup_failed');
  }
}

export default requireTenant(handler);
