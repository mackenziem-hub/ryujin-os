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
import { sendCAPIEvent } from '../lib/meta.js';
import { supabaseAdmin } from '../lib/supabase.js';

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

// Automator.ai follow-up workflows fire on a CONTACT TAG, not on pipeline
// stage. The old Replit -> Zapier chain stamped this exact tag so its
// follow-up automation (immediate SMS + email, reply branch) fired. We stamp
// the same canonical tag here so a Ryujin-API lead triggers that same
// workflow with no other changes. Canonical source: Plus Ultra/40-CONTENT/
// Instant Estimator.md frontmatter (ghl_tag: "Instant Estimator Submission").
// NOTE: GHL stores tags lowercased; the Automator trigger must match the same
// tag (case-insensitive in the GHL UI).
const AUTOMATOR_TAGS = {
  'instant-estimator-v3': 'Instant Estimator Submission'
};

// GHL custom field IDs for the Instant Estimator values (pre-existing fields,
// originally populated by the old Zapier chain). The estimator now sends a
// flat `estimator` object {low, high, material, address, size}; we map those
// keys to these field IDs and write them on the contact AT CREATION so the
// values are present when the Automator follow-up email fires (no second-call
// race). low/high are MONETORY fields (numeric); the rest are TEXT.
// IDs verified live against location aHotOUdq9D8m3JPrRz9n on 2026-05-28.
const ESTIMATOR_FIELD_IDS = {
  low:      'PyzDSpA08Gwqtu9wU5tW',
  high:     'dOjnqLvXnPfCat2k6etr',
  material: '15ZVvX8Z3Q5CbcCyOIBy',
  address:  '8dYsptjZpaGXeEUBFlF8',
  size:     'czp6Qb4UkZBpvWqcMcXu'
};

// Build the GHL customFields array from an untrusted `estimator` object.
// Iterates OUR field map (controlled keys), reading values off the payload, so
// a hostile payload can't inject arbitrary field writes. Empty/missing values
// are skipped (leaves the GHL field untouched rather than blanking it).
function buildEstimatorCustomFields(estimator) {
  if (!estimator || typeof estimator !== 'object') return [];
  const out = [];
  for (const key of Object.keys(ESTIMATOR_FIELD_IDS)) {
    const v = estimator[key];
    if (v === undefined || v === null || v === '') continue;
    // GHL v2 contacts create accepts either `value` or `field_value` (both
    // verified live 2026-05-28); use `field_value`, the documented property.
    out.push({ id: ESTIMATOR_FIELD_IDS[key], field_value: v });
  }
  return out;
}

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
    const { source, name, email, phone, address, city, metadata, meta_event_id, attribution } = body;

    if (!email && !phone) {
      return res.status(400).json({ error: 'email or phone required' });
    }
    const { firstName, lastName } = splitName(name);

    // Ad attribution (utm/fbclid) captured by the funnel. Normalize + derive
    // the paid channel, and build the Meta _fbc click id for CAPI matching.
    const attr = (attribution && typeof attribution === 'object') ? attribution : {};
    const adChannel =
      (attr.fbclid || /facebook|instagram|meta|\bfb\b/i.test(attr.utm_source || '')) ? 'meta'
        : (attr.gclid || /google/i.test(attr.utm_source || '')) ? 'google'
          : (attr.utm_source ? 'other-paid' : 'direct');
    const fbc = attr.fbclid ? `fb.1.${Math.floor(Date.now() / 1000)}.${attr.fbclid}` : null;

    // Base tags drive the marketing-leads view (source: filter + stats).
    // The Automator trigger tag (when the source has one) is what fires the
    // existing follow-up workflow. Added on top, not in place of, the others.
    const tags = ['lead', source ? `source:${source}` : 'source:unknown'];
    // Own-property lookup only: a public `source` like "constructor" or
    // "__proto__" must not resolve to an inherited prototype value and get
    // pushed as a non-string tag (would make GHL reject the contact).
    const automatorTag = Object.prototype.hasOwnProperty.call(AUTOMATOR_TAGS, source)
      ? AUTOMATOR_TAGS[source]
      : null;
    if (automatorTag) tags.push(automatorTag);

    // Estimator values -> GHL custom fields, written at creation (see map above).
    const estimatorCustomFields = buildEstimatorCustomFields(body.estimator);

    const contactPayload = {
      locationId: LOCATION_ID,
      firstName: firstName || (email ? email.split('@')[0] : 'Unknown'),
      lastName: lastName || '',
      email: email || undefined,
      phone: phone || undefined,
      address1: address || undefined,
      city: city || undefined,
      tags,
      source: source || 'ryujin-leads-api',
      ...(estimatorCustomFields.length ? { customFields: estimatorCustomFields } : {})
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

    // Single 5s deadline across opp creation + owner notification combined.
    // Both run in parallel starting now; whichever finishes within the
    // remaining budget gets recorded, slow ones time out with an error
    // tag. Total form-blocking wait capped at 5s no matter what.
    const POST_LEAD_BUDGET_MS = 5000;
    const startedAt = Date.now();
    const remaining = () => Math.max(0, POST_LEAD_BUDGET_MS - (Date.now() - startedAt));

    const notifyPromise = notifyOwner({ contactId, source, name, email, phone, address, city, metadata })
      .then(() => ({ ok: true }))
      .catch(e => {
        console.warn(`[leads] notifyOwner failed: ${e.message} (contact ${contactId})`);
        return { ok: false, error: e.message };
      });

    const oppPromise = OPP_ROUTING[source]
      ? createOpportunity({ contactId, source, name, metadata })
          .catch(e => {
            console.warn(`[leads] createOpportunity failed: ${e.message} (contact ${contactId})`);
            return { ok: false, error: e.message };
          })
      : Promise.resolve(null);

    // Server-side Meta CAPI Lead. Shares meta_event_id with the browser
    // pixel so Meta dedupes the two signals. Fires for any source — Meta
    // can use the tag to attribute back to the right campaign. Best-effort:
    // failures don't block the lead, just logged + surfaced in the response.
    const capiClientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
    const capiClientUa = req.headers['user-agent'] || null;
    const capiPromise = sendCAPIEvent({
      eventName: 'Lead',
      eventTime: Math.floor(Date.now() / 1000),
      eventId: meta_event_id || `ryujin_lead_${contactId}_${Date.now()}`,
      sourceUrl: req.headers.referer || 'https://ryujin-os.vercel.app/instant-estimator.html',
      userData: {
        ...(email ? { em: email } : {}),
        ...(phone ? { ph: phone } : {}),
        ...(name ? (() => {
          const { firstName, lastName } = splitName(name);
          return { ...(firstName ? { fn: firstName } : {}), ...(lastName ? { ln: lastName } : {}) };
        })() : {}),
        ...(city ? { ct: city } : {}),
        ...(metadata?.postal ? { zp: metadata.postal } : {}),
        ...(capiClientIp ? { ip: capiClientIp } : {}),
        ...(capiClientUa ? { userAgent: capiClientUa } : {}),
        ...(fbc ? { fbc } : {}),
        external_id: contactId
      },
      customData: {
        content_name: attr.utm_campaign || source || 'unknown',
        content_category: 'roofing',
        ...(attr.utm_source ? { utm_source: attr.utm_source } : {}),
        ...(attr.utm_campaign ? { utm_campaign: attr.utm_campaign } : {})
      }
    })
      .then(() => ({ ok: true }))
      .catch(e => {
        console.warn(`[leads] CAPI Lead failed: ${e.message} (contact ${contactId})`);
        return { ok: false, error: e.message };
      });

    // Persist the lead + ad attribution into Ryujin's leads table so the
    // click -> lead -> sale chain is queryable on our side, not only in GHL.
    // Runs CONCURRENTLY with the GHL/CAPI fan-out (no serial latency) and is
    // awaited (bounded) before the response so the serverless freeze can't drop
    // it. Never throws into the request path.
    const leadsPromise = req.tenant?.id
      ? supabaseAdmin.from('leads').insert({
          tenant_id: req.tenant.id,
          source: source || 'unknown',
          campaign: attr.utm_campaign || null,
          channel: adChannel,
          status: 'new',
          metadata: {
            attribution: attr,
            ghl_contact_id: contactId,
            name: name || null,
            email: email || null,
            phone: phone || null,
            meta_event_id: meta_event_id || null
          }
        })
          .then(({ error }) => (error ? { ok: false, error: error.message } : { ok: true }))
          .catch(e => ({ ok: false, error: e.message }))
      : Promise.resolve(null);

    let opportunityId = null;
    let opportunityError = null;
    let notifyError = null;
    let capiError = null;

    // Await opp first (it's higher value — kanban presence is the point).
    // Bound to whatever remains of the deadline.
    if (OPP_ROUTING[source]) {
      try {
        const oppRes = await Promise.race([
          oppPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('opp timeout')), remaining()))
        ]);
        if (oppRes && oppRes.ok) opportunityId = oppRes.opportunity_id;
        else opportunityError = (oppRes && oppRes.error) || 'unknown';
      } catch (e) {
        opportunityError = e.message;
      }
    }

    // Wait the rest of the budget for notify (often already settled).
    try {
      const notifyRes = await Promise.race([
        notifyPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('notify timeout')), remaining()))
      ]);
      if (notifyRes && !notifyRes.ok) notifyError = notifyRes.error;
    } catch (e) {
      notifyError = e.message;
    }

    // CAPI bounded await. Browser pixel is the primary Meta signal but
    // CAPI is the necessary backup for ad-blocked clients. Give it a 2s
    // cap (or whatever remains of the overall budget, whichever is less)
    // so a slow Meta endpoint doesn't drag the submit, while still
    // giving it enough time to land in normal conditions (Meta typically
    // responds in 200-800ms).
    const CAPI_CAP_MS = 2000;
    const capiBudget = Math.min(remaining(), CAPI_CAP_MS);
    try {
      const capiRes = await Promise.race([
        capiPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('capi timeout')), capiBudget))
      ]);
      if (capiRes && !capiRes.ok) capiError = capiRes.error;
    } catch (e) {
      capiError = e.message;
    }

    // Bounded wait for the concurrent leads-table capture. It started with the
    // fan-out so it is usually already resolved; the cap stops a slow/hung DB
    // from stalling the form.
    let leadsError = null;
    try {
      const leadsRes = await Promise.race([
        leadsPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('leads insert timeout')), 1500))
      ]);
      if (leadsRes && !leadsRes.ok) leadsError = leadsRes.error;
    } catch (e) {
      leadsError = e.message;
    }
    if (leadsError) console.warn(`[leads] leads capture: ${leadsError} (contact ${contactId})`);

    return res.status(201).json({
      ok: true,
      contact_id: contactId,
      opportunity_id: opportunityId,
      source,
      ghlError,
      opportunityError,
      notifyError,
      capiError
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
