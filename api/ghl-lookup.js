// Ryujin OS — GHL Contact Lookup (proxied via Shenron)
// GET /api/ghl-lookup?q=Amy       — Search contacts by name/phone/email
// GET /api/ghl-lookup?id=<ghl_id> — Fetch single contact with opportunities
//
// Shenron holds the GHL token and pipeline mappings; Ryujin proxies through
// to avoid duplicating credentials. Only tenants with GHL wired return data.
import { requireTenant } from '../lib/tenant.js';

const SHENRON_URL = (process.env.SHENRON_URL || 'https://shenron-app.vercel.app').trim();
const GHL_TENANTS = new Set(['plus-ultra']);

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!GHL_TENANTS.has(req.tenant.slug)) {
    return res.json({ contacts: [], ghl_enabled: false });
  }

  const { q = '', id } = req.query;

  try {
    if (id) {
      const r = await fetch(`${SHENRON_URL}/api/ghl?mode=contact-detail&id=${encodeURIComponent(id)}`);
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      const data = await r.json();
      return res.json({ contact: normalize(data.contact, data.opportunities) });
    }

    const trimmed = String(q).trim();
    if (trimmed.length < 2) return res.json({ contacts: [] });

    const [contactsResp, oppsResp] = await Promise.all([
      fetch(`${SHENRON_URL}/api/ghl?mode=contacts&q=${encodeURIComponent(trimmed)}&limit=10`),
      fetch(`${SHENRON_URL}/api/ghl?mode=pipeline&q=${encodeURIComponent(trimmed)}&limit=20`)
    ]);
    if (!contactsResp.ok) return res.status(contactsResp.status).json({ error: await contactsResp.text() });
    const contactsData = await contactsResp.json();
    const oppsData = oppsResp.ok ? await oppsResp.json() : { opportunities: [] };

    const contacts = dedupeByName((contactsData.contacts || [])
      .map(c => normalize(c, matchOpps(c, oppsData.opportunities || [])))
      .filter(c => c && (c.name || c.phone || c.email)));
    return res.json({ contacts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function dedupeByName(contacts) {
  const score = c => (c.phone ? 2 : 0) + (c.email ? 2 : 0) + (c.address ? 1 : 0) + (c.opportunity ? 3 : 0);
  const byKey = new Map();
  for (const c of contacts) {
    const key = (c.name || '').toLowerCase().trim();
    if (!key) { byKey.set(Symbol(), c); continue; }
    const existing = byKey.get(key);
    if (!existing || score(c) > score(existing)) byKey.set(key, c);
  }
  return [...byKey.values()];
}

function matchOpps(contact, allOpps) {
  const name = (contact.name || '').toLowerCase().trim();
  const email = (contact.email || '').toLowerCase().trim();
  if (!name && !email) return [];
  return allOpps.filter(o => {
    const oppName = (o.name || '').toLowerCase();
    const oppEmail = (o.email || '').toLowerCase();
    if (email && oppEmail === email) return true;
    if (name && oppName.includes(name)) return true;
    return false;
  });
}

function normalize(c, opportunities) {
  if (!c) return null;
  const openOpps = Array.isArray(opportunities)
    ? opportunities.filter(o => o.status !== 'lost' && o.status !== 'abandoned')
    : [];
  const topOpp = openOpps.length
    ? [...openOpps].sort((a, b) => (b.value || 0) - (a.value || 0))[0]
    : (Array.isArray(opportunities) ? [...opportunities].sort((a, b) => (b.value || 0) - (a.value || 0))[0] : null);
  const addressParts = [c.address, c.city, c.state].filter(Boolean);
  return {
    id: c.id,
    name: c.name || '',
    email: c.email || '',
    phone: c.phone || '',
    address: addressParts.join(', '),
    tags: Array.isArray(c.tags) ? c.tags : [],
    source: c.source || '',
    opportunity: topOpp ? {
      name: topOpp.name,
      value: topOpp.value || 0,
      stage: topOpp.stage,
      pipeline: topOpp.pipeline
    } : null
  };
}

export default requireTenant(handler);
