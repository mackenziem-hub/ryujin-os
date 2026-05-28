// ═══════════════════════════════════════════════════════════════
// LEADS — inbound + list endpoint for the marketing panel.
//
// Closes the silent-fail gap from instant-estimator.html and gives
// marketing-leads.html a unified read path even if the source of truth
// changes (today: GHL contacts; tomorrow: maybe a leads table).
//
// POST /api/leads
//   body: { source, name, email, phone?, address?, city?, metadata? }
//   1. Splits name → firstName/lastName
//   2. Creates GHL contact via /api/ghl ?action=create-contact
//      with tags ['source:<source>', 'lead']
//   3. Optionally adds a contact note with metadata for context
//   4. Returns { ok, contact_id, ghl }
//
// GET /api/leads
//   ?source=instant-estimator   filter by source tag
//   ?since_days=7                limit to recent
//   Proxies to /api/ghl?mode=contacts with light filtering.
// ═══════════════════════════════════════════════════════════════

import { requireTenant } from '../lib/tenant.js';
import { gmailSend } from '../lib/google.js';

const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const LOCATION_ID = (process.env.GHL_LOCATION_ID || 'aHotOUdq9D8m3JPrRz9n').trim();
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || 'mackenzie.m@plusultraroofing.com').trim();

// Per-source pipeline routing. Pipeline + stage IDs verified against live GHL
// 2026-05-09 (see api/ghl.js PIPELINE_NAMES / PIPELINE_STAGES). Map a lead
// source to the right pipeline so the opp lands on the right kanban.
const OPP_ROUTING = {
  'instant-estimator-v3': {
    pipelineId: 'eJm8vgBePJStA1QdZqmA',           // Instant Estimator
    pipelineStageId: '1e82765c-2ef2-4810-bcbf-9d6a926dba7b' // New IE Submission
  }
};

function splitName(full) {
  const t = (full || '').trim();
  if (!t) return { firstName: '', lastName: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function ghlFetch(path, query = {}, opts = {}) {
  const url = new URL(`https://services.leadconnectorhq.com${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GHL ${res.status}: ${txt.slice(0, 240)}`);
  }
  return res.json();
}

// Strip CR/LF from any value interpolated into the email subject or body.
// Public lead form is the untrusted boundary — without this an attacker
// could inject MIME headers (Bcc, Reply-To) through the Subject line.
function safeHeader(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
}

async function createOpportunity({ contactId, source, name, metadata }) {
  const route = OPP_ROUTING[source];
  if (!route) return { ok: false, error: `no routing for source: ${source}` };

  const md = metadata || {};
  const cleanName = (name || '').trim();
  const descBits = [];
  if (md.sqft) descBits.push(`${md.sqft} sqft`);
  if (md.complexity) descBits.push(md.complexity);
  const oppName = cleanName
    ? `${cleanName} - Instant Estimator${descBits.length ? ' (' + descBits.join(', ') + ')' : ''}`
    : `Instant Estimator${descBits.length ? ' (' + descBits.join(', ') + ')' : ''}`;

  const body = {
    locationId: LOCATION_ID,
    pipelineId: route.pipelineId,
    pipelineStageId: route.pipelineStageId,
    contactId,
    name: oppName,
    monetaryValue: 0,
    status: 'open',
    source: source || 'ryujin-leads-api'
  };

  const data = await ghlFetch('/opportunities/', {}, { method: 'POST', body });
  return { ok: true, opportunity_id: data?.opportunity?.id || data?.id || null };
}

async function notifyOwner({ contactId, source, name, email, phone, address, city, metadata }) {
  if (!NOTIFY_EMAIL) return;
  const md = metadata || {};
  const safeName    = safeHeader(name);
  const safeEmail   = safeHeader(email);
  const safePhone   = safeHeader(phone);
  const safeAddress = safeHeader(address);
  const safeCity    = safeHeader(city);
  const safeSource  = safeHeader(source) || 'unknown';

  const subjectName = safeName || safeEmail || safePhone || 'New lead';
  const subject = safeHeader(`New lead · ${safeSource} · ${subjectName}`);

  const ghlUrl = `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/contacts/detail/${contactId}`;
  const lines = [
    `New lead from ${safeSource}.`,
    '',
    `Name:    ${safeName    || '(not provided)'}`,
    `Phone:   ${safePhone   || '(not provided)'}`,
    `Email:   ${safeEmail   || '(not provided)'}`,
    `Address: ${[safeAddress, safeCity].filter(Boolean).join(', ') || '(not provided)'}`,
    ''
  ];

  if (Object.keys(md).length > 0) {
    lines.push('Estimator inputs:');
    if (md.sizePreset || md.sqft) lines.push(`  Size:        ${safeHeader(md.sqft) || '?'} sq ft (${safeHeader(md.sizePreset) || 'custom'})`);
    if (md.pitch)                  lines.push(`  Pitch:       ${safeHeader(md.pitch)}`);
    if (md.complexity)             lines.push(`  Complexity:  ${safeHeader(md.complexity)}`);
    if (md.chimneyType)            lines.push(`  Chimney:     ${safeHeader(md.chimneyType)}`);
    if (md.postal)                 lines.push(`  Postal:      ${safeHeader(md.postal)}`);
    lines.push('');
  }

  lines.push(`GHL contact: ${ghlUrl}`);
  lines.push('');
  lines.push('Ryujin OS');

  await gmailSend(NOTIFY_EMAIL, subject, lines.join('\n'));
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!GHL_TOKEN) return res.status(500).json({ error: 'GHL_TOKEN not configured' });

  // ── POST: inbound lead ──
  if (req.method === 'POST') {
    const body = req.body || {};
    const { source, name, email, phone, address, city, metadata } = body;

    if (!email && !phone) {
      return res.status(400).json({ error: 'email or phone required' });
    }
    const { firstName, lastName } = splitName(name);

    const contactPayload = {
      locationId: LOCATION_ID,
      firstName: firstName || (email ? email.split('@')[0] : 'Unknown'),
      lastName: lastName || '',
      email: email || undefined,
      phone: phone || undefined,
      address1: address || undefined,
      city: city || undefined,
      tags: ['lead', source ? `source:${source}` : 'source:unknown'],
      source: source || 'ryujin-leads-api'
    };

    let contactId = null;
    let ghlError = null;
    try {
      const created = await ghlFetch('/contacts/', {}, { method: 'POST', body: contactPayload });
      contactId = created?.contact?.id || created?.id || null;
    } catch (e) {
      ghlError = e.message;
    }

    // Optional: add a context note with metadata when contact created
    if (contactId && metadata && Object.keys(metadata).length > 0) {
      try {
        const noteBody = `Inbound from ${source || 'unknown'}\n\n${JSON.stringify(metadata, null, 2).slice(0, 4000)}`;
        await ghlFetch(`/contacts/${contactId}/notes`, {}, {
          method: 'POST',
          body: { body: noteBody }
        });
      } catch { /* note failure is non-blocking */ }
    }

    if (!contactId) {
      return res.status(502).json({ ok: false, error: ghlError || 'GHL contact create failed' });
    }

    // Run opp creation + owner notification in parallel so a slow GHL or
    // Gmail doesn't double the customer-facing wait. Combined bound 3.5s.
    // Both are best-effort — the contact is already saved above, so even
    // if both fail the lead is recoverable from GHL contacts. The email
    // intentionally does not link to the opportunity (it links to the
    // contact, which surfaces opps anyway) so the two tasks have no
    // ordering dependency.
    let opportunityId = null;
    let opportunityError = null;
    let notifyError = null;

    const oppPromise = OPP_ROUTING[source]
      ? createOpportunity({ contactId, source, name, metadata })
          .then(r => {
            if (r && r.ok) opportunityId = r.opportunity_id;
            else opportunityError = (r && r.error) || 'unknown';
          })
          .catch(e => {
            opportunityError = e.message;
            console.warn(`[leads] createOpportunity failed: ${e.message} (contact ${contactId})`);
          })
      : Promise.resolve();

    const notifyPromise = notifyOwner({ contactId, source, name, email, phone, address, city, metadata })
      .catch(e => {
        notifyError = e.message;
        console.warn(`[leads] notifyOwner failed: ${e.message} (contact ${contactId})`);
      });

    await Promise.race([
      Promise.allSettled([oppPromise, notifyPromise]),
      new Promise(r => setTimeout(r, 3500))
    ]);

    return res.status(201).json({
      ok: true,
      contact_id: contactId,
      opportunity_id: opportunityId,
      source,
      ghlError,
      opportunityError,
      notifyError
    });
  }

  // ── GET: list contacts (lead view) ──
  if (req.method === 'GET') {
    const source = req.query.source;
    const sinceDays = parseInt(req.query.since_days) || 30;
    try {
      const data = await ghlFetch('/contacts/', { locationId: LOCATION_ID, limit: '100' });
      const cutoff = Date.now() - sinceDays * 86400000;
      const contacts = (data?.contacts || []).map(c => ({
        id: c.id,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown',
        email: c.email || null,
        phone: c.phone || null,
        address: c.address1 || null,
        city: c.city || null,
        source: c.source || null,
        tags: c.tags || [],
        date_added: c.dateAdded,
        last_activity: c.lastActivity || c.dateUpdated || c.dateAdded
      })).filter(c => {
        if (source && !(c.tags || []).some(t => t === `source:${source}` || t === source)) return false;
        const ts = c.date_added ? new Date(c.date_added).getTime() : 0;
        if (ts && ts < cutoff) return false;
        return true;
      }).sort((a, b) => new Date(b.date_added || 0) - new Date(a.date_added || 0));

      // Lightweight stats for KPI rail
      const now = Date.now();
      const oneDay = 86400000;
      const stats = {
        total: contacts.length,
        last_24h: contacts.filter(c => c.date_added && (now - new Date(c.date_added).getTime()) < oneDay).length,
        last_7d:  contacts.filter(c => c.date_added && (now - new Date(c.date_added).getTime()) < 7 * oneDay).length,
        sources: {}
      };
      for (const c of contacts) {
        for (const t of c.tags || []) {
          if (typeof t === 'string' && t.startsWith('source:')) {
            const s = t.slice(7);
            stats.sources[s] = (stats.sources[s] || 0) + 1;
          }
        }
      }
      return res.status(200).json({ contacts, stats, source: source || null, since_days: sinceDays });
    } catch (e) {
      return res.status(502).json({ error: `GHL fetch failed: ${e.message}` });
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
}

export default requireTenant(handler);
