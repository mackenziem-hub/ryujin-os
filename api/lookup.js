const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';

// Hardcoded fallbacks match heartbeat/_shared.js — the Vercel env var names diverged from
// local .env and silently broke /api/lookup?mode=stats (HTTP 401 → snapshot signedRevenue=0).
const APIS = {
  estimates: {
    label: 'Estimator OS',
    url: 'https://estimator-os.replit.app/api/estimates',
    statsUrl: 'https://estimator-os.replit.app/api/stats',
    key: (process.env.ESTIMATOR_KEY || process.env.ESTIMATOR_OS_KEY || 'pu-estimator-2026').trim()
  },
  tickets: {
    label: 'Action Board',
    url: 'https://ultra-task-manager.replit.app/api/tickets',
    statsUrl: 'https://ultra-task-manager.replit.app/api/stats',
    key: (process.env.ACTION_BOARD_KEY || 'pu-actionboard-2026').trim()
  },
  leads: {
    label: 'Instant Estimator',
    url: 'https://plus-ultra-roof-estimator.replit.app/api/leads',
    statsUrl: 'https://plus-ultra-roof-estimator.replit.app/api/stats',
    key: (process.env.INSTANT_EST_KEY || process.env.INSTANT_ESTIMATOR_KEY || 'pu-instantest-2026').trim()
  }
};

async function fetchAPI(api, query) {
  try {
    const url = new URL(api.url);
    if (query) url.searchParams.set('q', query);
    const resp = await fetch(url.toString(), {
      headers: { 'x-api-key': api.key }
    });
    if (!resp.ok) return { source: api.label, error: `HTTP ${resp.status}`, data: [] };
    const data = await resp.json();
    return { source: api.label, data: Array.isArray(data) ? data : (data.data || data.estimates || data.tickets || data.leads || []) };
  } catch (e) {
    return { source: api.label, error: e.message, data: [] };
  }
}

async function fetchStats(api) {
  try {
    const resp = await fetch(api.statsUrl, {
      headers: { 'x-api-key': api.key }
    });
    if (!resp.ok) return { source: api.label, error: `HTTP ${resp.status}`, stats: {} };
    const stats = await resp.json();
    return { source: api.label, stats };
  } catch (e) {
    return { source: api.label, error: e.message, stats: {} };
  }
}

async function fetchGHLContacts(query) {
  if (!GHL_TOKEN) return { source: 'GoHighLevel CRM', data: [], error: 'GHL_TOKEN not configured' };
  try {
    const url = new URL(GHL_BASE + '/contacts/');
    url.searchParams.set('locationId', GHL_LOCATION_ID);
    url.searchParams.set('limit', '10');
    if (query) url.searchParams.set('query', query);
    const resp = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Version': '2021-07-28',
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) return { source: 'GoHighLevel CRM', error: `HTTP ${resp.status}`, data: [] };
    const data = await resp.json();
    const contacts = (data.contacts || []).map(c => ({
      id: c.id,
      name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' '),
      email: c.email,
      phone: c.phone,
      tags: c.tags,
      address: c.address1,
      city: c.city,
      source: c.source,
      createdAt: c.dateAdded
    }));
    return { source: 'GoHighLevel CRM', data: contacts };
  } catch (e) {
    return { source: 'GoHighLevel CRM', error: e.message, data: [] };
  }
}

function searchResults(results, query) {
  if (!query) return results;
  const q = query.toLowerCase();
  return results.map(r => ({
    ...r,
    data: r.data.filter(item => {
      const str = JSON.stringify(item).toLowerCase();
      return str.includes(q);
    })
  }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, source, mode } = req.query;

  // Stats mode — return KPIs from all 3 apps
  if (mode === 'stats') {
    const sources = source ? [APIS[source]].filter(Boolean) : Object.values(APIS);
    const stats = await Promise.all(sources.map(s => fetchStats(s)));
    return res.json({ mode: 'stats', results: stats, timestamp: new Date().toISOString() });
  }

  // Lookup mode — query data across all apps + GHL CRM
  const sources = source ? [APIS[source]].filter(Boolean) : Object.values(APIS);
  if (source && sources.length === 0 && source !== 'ghl') {
    return res.status(400).json({ error: `Invalid source. Use: estimates, tickets, leads, ghl` });
  }

  const fetches = sources.map(s => fetchAPI(s, q));
  // Include GHL contacts unless filtering to a specific non-GHL source
  if (!source || source === 'ghl') {
    fetches.push(fetchGHLContacts(q));
  }
  const rawResults = await Promise.all(fetches);
  const results = searchResults(rawResults, q);

  const totalHits = results.reduce((sum, r) => sum + r.data.length, 0);

  return res.json({
    query: q || null,
    totalHits,
    results,
    timestamp: new Date().toISOString()
  });
}
