// GET /api/places-autocomplete?q=<text> — server-side Google Places address
// autocomplete proxy for the field app's New Job address field.
//
// Proxied (not a browser key) so GOOGLE_MAPS_API_KEY stays server-side. Session
// gated so it's not an open quota-burning proxy. Returns a short list of address
// predictions; on any upstream/config problem it returns an empty list so the
// caller silently falls back to plain typing.
import { resolveSession } from '../lib/portalAuth.js';

const KEY = (process.env.GOOGLE_MAPS_API_KEY || '').trim();

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });

  const q = String(req.query.q || '').trim();
  if (q.length < 3) return res.json({ predictions: [] });
  if (!KEY) return res.json({ predictions: [], unconfigured: true });

  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}`
      + `&components=country:ca&types=address&key=${KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      // REQUEST_DENIED (Places API not enabled on the key), OVER_QUERY_LIMIT, etc.
      return res.json({ predictions: [], status: data.status || 'error' });
    }
    const predictions = (data.predictions || []).slice(0, 6).map(p => ({ description: p.description }));
    return res.json({ predictions });
  } catch (e) {
    return res.json({ predictions: [], status: 'unreachable' });
  }
}
