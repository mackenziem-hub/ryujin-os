import { resolveSession } from '../lib/portalAuth.js';
import { supabaseAdmin } from '../lib/supabase.js';

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
  leads: {
    label: 'Instant Estimator',
    url: 'https://plus-ultra-roof-estimator.replit.app/api/leads',
    statsUrl: 'https://plus-ultra-roof-estimator.replit.app/api/stats',
    key: (process.env.INSTANT_EST_KEY || process.env.INSTANT_ESTIMATOR_KEY || 'pu-instantest-2026').trim()
  }
};

// Crew tickets migrated to the native Ryujin `tickets` table on 2026-05-11;
// the Replit Action Board is read-only history and stopped reflecting reality
// (chat answered "4 open tickets" while the cockpit/load-scan counted 46).
// Same open-ticket definition as scripts/load-scan.mjs so every surface agrees.
const OPEN_TICKET_EXCLUDE = '(completed,closed,done,cancelled)';

async function fetchNativeTickets(tenantId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('ticket_number, title, status, priority, assigned_to, created_at')
      .eq('tenant_id', tenantId)
      .not('status', 'in', OPEN_TICKET_EXCLUDE)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return { source: 'Crew Tickets', error: error.message, data: [] };
    return { source: 'Crew Tickets', data: data || [] };
  } catch (e) {
    return { source: 'Crew Tickets', error: e.message, data: [] };
  }
}

// Legacy-compatible stats shape ({totalTickets, byStatus, overdueCount,
// byAssignee}) so runPiccolo/runBulma in api/agents/_shared.js keep working,
// now fed by live data instead of the dead board.
async function fetchNativeTicketStats(tenantId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('status, assigned_to, due_date')
      .eq('tenant_id', tenantId)
      .limit(2000);
    if (error) return { source: 'Crew Tickets', error: error.message, stats: {} };
    const rows = data || [];
    // NULL status is excluded, matching NOT IN semantics in the search query + load-scan
    const isOpen = (s) => s != null && !['completed', 'closed', 'done', 'cancelled'].includes(String(s).toLowerCase());
    const byStatus = {};
    for (const r of rows) {
      const k = r.status || 'unknown';
      byStatus[k] = (byStatus[k] || 0) + 1;
    }
    const open = rows.filter((r) => isOpen(r.status));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Moncton' });
    const overdueCount = open.filter((r) => r.due_date && r.due_date < today).length;
    const byAssignee = {};
    const ids = [...new Set(open.map((r) => r.assigned_to).filter(Boolean))];
    if (ids.length) {
      const { data: users } = await supabaseAdmin.from('users').select('id, name').in('id', ids);
      const nameOf = Object.fromEntries((users || []).map((u) => [u.id, u.name || u.id.slice(0, 8)]));
      for (const r of open) {
        const key = r.assigned_to ? (nameOf[r.assigned_to] || 'Unknown') : 'Unassigned';
        byAssignee[key] = (byAssignee[key] || 0) + 1;
      }
    } else if (open.length) {
      byAssignee.Unassigned = open.length;
    }
    return {
      source: 'Crew Tickets',
      stats: { totalTickets: rows.length, totalOpen: open.length, byStatus, overdueCount, byAssignee }
    };
  } catch (e) {
    return { source: 'Crew Tickets', error: e.message, stats: {} };
  }
}

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

  // Auth gate: this endpoint proxies GHL contact PII + the Replit estimator/leads
  // apps (with hardcoded fallback keys), so it must never be reachable
  // unauthenticated. Owner/admin session required. Server-to-server callers
  // (snapshot rebuild, EA agents, chat lookup_data tool) authenticate with
  // RYUJIN_SERVICE_TOKEN + x-tenant-id, which resolveSession maps to a synthetic
  // admin session. Fail closed: 401 with no session, 403 if role is not owner/admin.
  const session = await resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  if (session.role !== 'owner' && session.role !== 'admin') {
    return res.status(403).json({ error: 'Owner or admin role required', current_role: session.role });
  }

  const { q, source, mode } = req.query;

  // Stats mode: KPIs from the external apps + native crew tickets
  if (mode === 'stats') {
    const sources = source ? [APIS[source]].filter(Boolean) : Object.values(APIS);
    const statFetches = sources.map(s => fetchStats(s));
    if (!source || source === 'tickets') {
      statFetches.push(fetchNativeTicketStats(session.tenant_id));
    }
    const stats = await Promise.all(statFetches);
    return res.json({ mode: 'stats', results: stats, timestamp: new Date().toISOString() });
  }

  // Lookup mode: query data across the apps + native tickets + GHL CRM
  const sources = source ? [APIS[source]].filter(Boolean) : Object.values(APIS);
  if (source && sources.length === 0 && source !== 'ghl' && source !== 'tickets') {
    return res.status(400).json({ error: `Invalid source. Use: estimates, tickets, leads, ghl` });
  }

  const fetches = sources.map(s => fetchAPI(s, q));
  // Native crew tickets (the Ryujin tickets table, NOT the retired Replit board)
  if (!source || source === 'tickets') {
    fetches.push(fetchNativeTickets(session.tenant_id));
  }
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
