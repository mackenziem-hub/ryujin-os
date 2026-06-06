import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const GHL_VERSION = '2021-07-28';

// PIPELINE_NAMES + PIPELINE_STAGES last verified against live GHL on 2026-05-09.
// Source: GET /opportunities/pipelines?locationId=aHotOUdq9D8m3JPrRz9n
// When chat brain hallucinates a pipeline name, re-pull and replace these maps.

const PIPELINE_NAMES = {
  'OF6SJPdnmQS7KcgRffrb': '10 CM Pipeline',
  'jTAc7D9RMHBb3Gzb5bQz': "Darcy's Pipeline",
  'eJm8vgBePJStA1QdZqmA': 'Instant Estimator',
  's78IPqC050pvYTGUDvFe': 'Internal Pipeline',
  'zpBXZwtiHHNQQKJoEIIU': 'Operations Pipeline',
  'MLroVluZOjTsbvs1rrkC': 'Repair Pipeline',
  'nJqJ681y17CWjkCRzVhH': 'Voice AI'
};

const PIPELINE_STAGES = {
  // 10 CM Pipeline
  '20576ed3-fc88-4810-ac95-e618445a1b12': 'New Lead',
  '6705322a-85e4-4803-9183-00fa4249704c': 'Follow Up 1 Sent',
  'd51e712f-0f04-45c7-8208-e56947422ccf': 'Follow Up 2 Sent',
  'b0742a38-8480-4c4b-8ead-49d538fdc387': 'Follow Up 3 Sent',
  'c2d9aaba-99c4-481d-860a-4e84845fc7da': 'Follow Up 4 Sent',
  '25b51d70-231f-433b-a545-d885b5a7fd6a': 'Follow Up 5 Sent',
  'b5bb4965-5aec-4428-9c5d-b988cac1e97d': 'Follow Up 6 Sent',
  '602f58a5-41e0-4418-af64-aff6a5887425': 'Client Responded',
  'ffa82014-881d-4f7f-bb32-08defa4d7e2c': 'Inspection Booked',
  '7f07e8c9-dcba-419c-8e2c-721e96955f23': 'Quote Pending',
  'f3b6d2c1-a173-428f-a239-e7aa90f21b80': 'Quote Sent',
  'c02e4e0a-5670-4fa2-87b8-9673e32909a0': 'Quote Follow Up 1 Sent',
  '323248a0-842b-4754-b8dc-ed36f34afab1': 'Quote Follow Up 2 Sent',
  '8e313586-df54-49db-bdcc-179498cc6cff': 'Quote Follow Up 3 Sent',
  '8218b56b-581d-4e1b-b866-9edd6342bd78': 'Contract Signed',
  '3b24c169-8d99-49c1-9e96-e2f941a53e62': 'DND',
  'cf9de341-5aa3-42e0-8a4f-7a75c55daba8': 'Lost',
  // Darcy's Pipeline
  '749ba027-c321-4325-a521-3f441fc1480b': 'New Lead',
  '22aba604-4876-4bbc-b796-6be7d392da3b': 'Text Sent- Awaiting Response',
  '3e796404-ada4-40e9-8458-a4863bccc8cf': 'Follow Up Text Sent',
  '5f9d8eb0-8810-4523-b07b-ef64e71ff739': 'Client Responded',
  '4fc0e114-06ca-4ce0-a051-8b6b1dd1b913': 'Unresponsive',
  '1b11eb16-a0e0-4865-899c-f876cb1bc614': 'Inspection Scheduled',
  '61e0e9b8-a2c7-45dd-b9dd-16f238b54cbd': 'Quote Sent',
  'aabfe851-86ff-461d-88d3-b6cbad34de56': 'Contract Signed',
  'ee8bf132-4d11-4943-bb67-1b979fe7f64d': 'DND/ Out of Town',
  '4ff006c7-5eda-40b9-b0ee-239134487b80': 'Lost',
  // Instant Estimator
  '1e82765c-2ef2-4810-bcbf-9d6a926dba7b': 'New IE Submission',
  '201128e6-98a0-4aef-8c81-e8226ca11135': 'Personal Video Sent',
  '1a33335e-ae57-4c4e-984b-ccd0678ff14a': 'Day 1 Bump',
  '2abe3fa1-7fa2-4732-9204-04b219a03ec1': 'Day 3 Bump',
  'e0248e36-84b9-44f9-af57-9fff54039915': 'Inspection Booked',
  '5cef659b-c45c-410b-ac9e-2defda447b64': 'Quote Ready',
  'eeb9dd8d-7127-416c-aa11-a2d5a7d2e2d1': 'Day 14 Check-in',
  '496b9e21-3d00-48d1-8fbf-9e83123af3ee': 'Day 21 Lost',
  'bd7eff09-04c5-41eb-9fb2-edf0c2374780': 'DND',
  // Internal Pipeline
  'f0823692-8a3a-4512-a780-ad7739edd7cc': 'New Lead',
  '13584262-7832-4c17-b17c-26df8d7659f0': 'Contacted',
  'd2c91d4c-3fb6-46be-98cd-1465e5f75213': 'Proposal Sent',
  'e7ea3e84-8e88-4451-be28-ed0291a23bdf': 'Closed',
  // Operations Pipeline
  'b8be34e8-5d97-4718-9708-44641de04b94': 'Contract Signed',
  '4f0a5be4-5b79-47c2-a24f-cd283f289c17': 'Deposit Invoice Sent',
  '5065357a-47eb-45f1-be5e-5fe97254c23e': 'Deposit Invoice Paid',
  '984e1d67-616f-430c-bd19-920184b255f8': 'Pre Job Inspection',
  'd9b41f75-1b66-48ec-a685-3fade71fafad': 'Pre Job Inspection Complete',
  'fc3a0f28-5ca3-4c2a-9214-388842759620': 'Bundles Ordered',
  'a4b09df6-038f-4928-8d0b-5b4a657b201d': 'Bundles Loaded',
  'e43e70f5-8df7-4fb9-ba7a-a17be46cc9eb': 'Job In Progress',
  '6dceec1a-9506-40de-bbfb-cd090c8758a8': 'Completed',
  '0077a593-2548-42d9-ac66-7f46f795bc79': 'Representative Check In',
  'be8b806a-d850-494a-a90b-14656b198bf7': 'Invoice Ready',
  '2c956db9-4f30-4b09-abd6-7a98cb030eb6': 'Paid In Full',
  // Repair Pipeline
  '1f6a7d30-a537-4bac-9725-aceedaae5c2a': 'Repair Requested',
  '3e4e1a9b-8b74-4b97-801a-1547f3c5a0d9': 'Repair Confirmed',
  '2208dfab-2774-4b0e-9ba2-24d50969dda5': 'Repair Assigned',
  '4f2ad3be-d3ac-4394-ad19-e210e9a7c2a7': 'Repair Complete',
  'e68789b9-cfcb-4019-8863-7fc71520cf97': 'Invoice Sent',
  '2cd5c35f-64a3-4d26-aa1a-4609f691e795': 'Invoice Paid',
  // Voice AI
  'a94b67a4-174d-4004-b122-8d2ae646fa41': 'Customer Called',
  '25022415-6343-49b2-bae3-6140711bd8f3': 'Telemarketers',
  'f17181c8-ef31-4c35-8ee4-efac41161b75': 'Quote Requested'
};

async function ghlFetch(path, params = {}, options = {}) {
  const url = new URL(GHL_BASE + path);
  if (!options.method || options.method === 'GET') {
    Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  }
  const headers = {
    'Authorization': `Bearer ${GHL_TOKEN}`,
    'Version': GHL_VERSION,
    'Accept': 'application/json'
  };
  const fetchOpts = { headers, method: options.method || 'GET' };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(options.body);
  }
  const resp = await fetch(url.toString(), fetchOpts);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`GHL ${resp.status}: ${body}`);
  }
  return resp.json();
}

// Cached list of GHL calendars at LOCATION_ID. The appointments mode needs
// to enumerate calendars to pass calendarId to /calendars/events. Stale data
// here just means a newly created calendar won't show up for up to 5 min.
let CALENDAR_CACHE = { ts: 0, data: null };
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;
async function listCalendarsCached() {
  if (CALENDAR_CACHE.data && Date.now() - CALENDAR_CACHE.ts < CALENDAR_CACHE_TTL_MS) {
    return CALENDAR_CACHE.data;
  }
  try {
    const data = await ghlFetch('/calendars/', { locationId: LOCATION_ID });
    const calendars = (data.calendars || []).map(c => ({
      id: c.id,
      name: c.name || 'Untitled calendar',
      isActive: c.isActive !== false
    })).filter(c => c.isActive);
    CALENDAR_CACHE = { ts: Date.now(), data: calendars };
    return calendars;
  } catch (err) {
    console.error('listCalendarsCached failed:', err.message);
    return [];
  }
}

// Fetch notes for a contact via the dedicated GHL notes endpoint.
// GET /contacts/{id} does NOT include notes — they require a separate call.
// Returns sorted-by-date-desc array (newest first), or [] on failure.
async function fetchContactNotes(contactId) {
  try {
    const data = await ghlFetch(`/contacts/${contactId}/notes`, {});
    const notes = (data.notes || []).map(n => ({
      id: n.id,
      body: (n.body || '').trim(),
      userId: n.userId,
      dateAdded: n.dateAdded,
      dateUpdated: n.dateUpdated
    }));
    // Sort newest first
    notes.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''));
    return notes;
  } catch (err) {
    console.error(`fetchContactNotes(${contactId}) failed:`, err.message);
    return [];
  }
}

function enrichOpportunity(opp) {
  return {
    id: opp.id,
    name: opp.name,
    email: opp.email,
    phone: opp.phone,
    value: opp.monetaryValue || 0,
    status: opp.status,
    pipeline: PIPELINE_NAMES[opp.pipelineId] || opp.pipelineId,
    stage: PIPELINE_STAGES[opp.pipelineStageId] || opp.pipelineStageId,
    source: opp.source,
    assignedTo: opp.assignedTo,
    lastStatusChange: opp.lastStatusChangeAt,
    createdAt: opp.createdAt
  };
}

function enrichContact(c, includeNotes = false) {
  const base = {
    id: c.id,
    name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' '),
    email: c.email,
    phone: c.phone,
    type: c.type,
    source: c.source,
    tags: c.tags,
    city: c.city,
    state: c.state,
    address: c.address1,
    company: c.companyName || null,
    lastActivity: c.lastActivity || null,
    dnd: c.dnd || false,
    createdAt: c.dateAdded
  };
  if (includeNotes) {
    base.notes = c.notes || [];
    base.customFields = c.customFields || [];
    base.attributionSource = c.attributionSource || null;
    base.followers = c.followers || [];
    base.assignedTo = c.assignedTo || null;
  }
  return base;
}

export default async function handler(req, res) {
  const allowed = ['GET', 'POST', 'PATCH', 'DELETE'];
  if (!allowed.includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed. Use GET, POST, PATCH, or DELETE.' });
  }

  if (!GHL_TOKEN) {
    return res.status(500).json({ error: 'GHL_TOKEN not configured' });
  }

  // === AUTH GATE (top of handler — applies to ALL verbs) ===
  // The whole GHL CRM proxy exposes contact PII, conversations, pipeline value
  // and accepts create/update/delete. It was previously unauthenticated except
  // for the appointments GET branch. Require a valid session for every request:
  //  - reads (GET): any valid portal session, OR the RYUJIN_SERVICE_TOKEN
  //    (server-to-server callers: snapshot, agents, chat tools, ghl-lookup).
  //  - mutations (POST/PATCH/DELETE): owner/admin only. The service token
  //    resolves to a synthetic role:'admin' session so internal sync still works.
  // resolveSession reads Authorization: Bearer <ryujin_token | RYUJIN_SERVICE_TOKEN>;
  // service-token path additionally needs x-tenant-id / ?tenant= to resolve tenant.
  const session = await resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  if (req.method !== 'GET' && !isPrivileged(session)) {
    return res.status(403).json({ error: 'forbidden', code: 'NOT_PRIVILEGED' });
  }

  // === PATCH: Update opportunity ===
  if (req.method === 'PATCH') {
    const { id: oppId } = req.query;
    if (!oppId) {
      return res.status(400).json({ error: 'Missing id query parameter. Pass the opportunity ID to update.' });
    }
    const body = req.body;
    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({
        error: 'Empty body. Send JSON with fields to update.',
        example: { pipelineStageId: 'STAGE_ID', assignedTo: 'USER_ID', status: 'open|won|lost|abandoned', monetaryValue: 5000, name: 'Client Name' }
      });
    }
    try {
      const data = await ghlFetch(`/opportunities/${oppId}`, {}, { method: 'PUT', body });
      return res.json({
        action: 'updated',
        opportunity: enrichOpportunity(data),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // === DELETE: Remove opportunity ===
  if (req.method === 'DELETE') {
    const { id: oppId } = req.query;
    if (!oppId) {
      return res.status(400).json({ error: 'Missing id query parameter. Pass the opportunity ID to delete.' });
    }
    try {
      await ghlFetch(`/opportunities/${oppId}`, {}, { method: 'DELETE' });
      return res.json({
        action: 'deleted',
        id: oppId,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // === POST: Create or add resources ===
  if (req.method === 'POST') {
    const { id: cId, action: postAction } = req.query;

    // --- Create new contact ---
    if (postAction === 'create-contact') {
      const body = req.body;
      if (!body || !body.firstName) {
        return res.status(400).json({
          error: 'Missing required fields.',
          example: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '+15065551234', tags: ['roof-lead'], source: 'Ryujin' }
        });
      }
      try {
        body.locationId = LOCATION_ID;
        const data = await ghlFetch('/contacts/', {}, { method: 'POST', body });
        return res.json({ action: 'contact_created', contact: enrichContact(data.contact, true), timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Create new opportunity ---
    if (postAction === 'create-opportunity') {
      const body = req.body;
      if (!body || !body.pipelineId || !body.pipelineStageId || !body.contactId || !body.name) {
        return res.status(400).json({
          error: 'Missing required fields.',
          required: ['name', 'contactId', 'pipelineId', 'pipelineStageId'],
          optional: ['monetaryValue', 'status', 'assignedTo', 'source'],
          example: { name: 'John Doe - Roof Replacement', contactId: 'CONTACT_ID', pipelineId: 'l2xOb5ApmVbAWADKtra5', pipelineStageId: 'a86f1fc9-cfc7-4943-8318-de6e907b5cba', monetaryValue: 15000, status: 'open' },
          pipelines: PIPELINE_NAMES,
          stages: PIPELINE_STAGES
        });
      }
      try {
        body.locationId = LOCATION_ID;
        const data = await ghlFetch('/opportunities/', {}, { method: 'POST', body });
        return res.json({ action: 'opportunity_created', opportunity: enrichOpportunity(data), timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Create estimate (POST with action=create-estimate) ---
    if (postAction === 'create-estimate') {
      const body = req.body;
      if (!body || !body.contactId || !Array.isArray(body.items) || body.items.length === 0) {
        return res.status(400).json({
          error: 'Missing required fields.',
          required: ['contactId', 'items'],
          optional: ['name', 'currency', 'termsNotes', 'validDays', 'taxPercentage', 'liveMode'],
          example: {
            contactId: 'CONTACT_ID',
            name: 'Steve Maltais - Siding Patch Repair',
            currency: 'CAD',
            taxPercentage: 15,
            validDays: 30,
            termsNotes: 'Quote valid 30 days.',
            items: [{ name: 'Labor', description: 'Repair labor', qty: 1, amount: 595 }]
          }
        });
      }
      try {
        const contactRes = await ghlFetch(`/contacts/${body.contactId}`, {});
        const contact = contactRes.contact || contactRes;
        const currency = body.currency || 'CAD';
        const validDays = body.validDays || 30;
        const today = new Date();
        const issueDate = today.toISOString().slice(0, 10);
        const expiry = new Date(today.getTime() + validDays * 86400000).toISOString().slice(0, 10);
        const taxPct = typeof body.taxPercentage === 'number' ? body.taxPercentage : 15;

        const items = body.items.map(it => ({
          name: String(it.name || '').slice(0, 100),
          description: it.description || '',
          currency,
          amount: Math.round((Number(it.amount) || 0) * 100) / 100,
          qty: Number(it.qty || it.quantity || 1),
          type: it.type || 'one_time',
          taxes: []
        }));

        const subtotal = items.reduce((s, it) => s + it.amount * it.qty, 0);
        const taxTotal = subtotal * (taxPct / 100);
        const total = subtotal + taxTotal;

        const truncate = (s, n) => String(s || '').slice(0, n);
        const shortName = truncate(body.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Estimate', 40);
        const termsWithTax = (body.termsNotes ? body.termsNotes + '\n\n' : '')
          + `Subtotal: $${subtotal.toFixed(2)} ${currency}\nHST (${taxPct}%): $${taxTotal.toFixed(2)}\nTotal: $${total.toFixed(2)} ${currency}`;

        const payload = {
          altId: LOCATION_ID,
          altType: 'location',
          name: shortName,
          currency,
          items,
          discount: { type: 'percentage', value: 0 },
          termsNotes: termsWithTax,
          title: shortName,
          contactDetails: {
            id: contact.id,
            name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.contactName || '',
            phoneNo: contact.phone || '',
            email: contact.email || ''
          },
          issueDate,
          expiryDate: expiry,
          liveMode: body.liveMode !== false,
          frequencySettings: { enabled: false },
          businessDetails: {
            name: 'Plus Ultra Roofing',
            address: {
              addressLine1: '2-6 McDowell Ave',
              city: 'Riverview',
              state: 'NB',
              countryCode: 'CA',
              postalCode: 'E1B 1A1'
            },
            phoneNo: '(506) 540-1052',
            email: 'plusultraroofing@gmail.com'
          }
        };

        const data = await ghlFetch('/invoices/estimate/', {}, { method: 'POST', body: payload });
        return res.json({
          action: 'estimate_created',
          estimate: data.estimate || data,
          summary: { subtotal, taxTotal, total, currency, validUntil: expiry, items: items.length },
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        return res.status(500).json({ error: err.message, hint: 'GHL estimate API may need different shape — check response body in error for details' });
      }
    }

    // --- Delete estimate (POST with action=delete-estimate&id=<ghl_estimate_id>) ---
    if (postAction === 'delete-estimate' && cId) {
      try {
        await ghlFetch(`/invoices/estimate/${cId}`, {}, {
          method: 'DELETE',
          body: { altId: LOCATION_ID, altType: 'location' }
        });
        return res.json({ action: 'estimate_deleted', estimateId: cId, timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Update contact (POST with action=update-contact&id=X) ---
    if (postAction === 'update-contact' && cId) {
      const body = req.body;
      if (!body || Object.keys(body).length === 0) {
        return res.status(400).json({
          error: 'Empty body. Send JSON with fields to update.',
          example: { firstName: 'John', lastName: 'Doe', email: 'new@email.com', phone: '+15065551234', tags: ['vip'], assignedTo: 'USER_ID' }
        });
      }
      try {
        const data = await ghlFetch(`/contacts/${cId}`, {}, { method: 'PUT', body });
        return res.json({ action: 'contact_updated', contact: enrichContact(data.contact, true), timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Move opportunity pipeline/stage (POST with action=move-pipeline&id=X) ---
    if (postAction === 'move-pipeline' && cId) {
      const { pipelineId, pipelineStageId, status } = req.body || {};
      if (!pipelineStageId) {
        return res.status(400).json({
          error: 'Missing pipelineStageId.',
          required: ['pipelineStageId'],
          optional: ['pipelineId', 'status'],
          stages: PIPELINE_STAGES,
          pipelines: PIPELINE_NAMES
        });
      }
      try {
        const updateBody = { pipelineStageId };
        if (pipelineId) updateBody.pipelineId = pipelineId;
        if (status) updateBody.status = status;
        const data = await ghlFetch(`/opportunities/${cId}`, {}, { method: 'PUT', body: updateBody });
        return res.json({
          action: 'pipeline_moved',
          opportunity: enrichOpportunity(data),
          movedTo: { pipeline: PIPELINE_NAMES[pipelineId] || pipelineId, stage: PIPELINE_STAGES[pipelineStageId] || pipelineStageId },
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Delete note from contact (POST with action=delete-note&id=contactId, body: {noteId}) ---
    if (postAction === 'delete-note' && cId) {
      const { noteId } = req.body || {};
      if (!noteId) return res.status(400).json({ error: 'Missing noteId in request body.' });
      try {
        await ghlFetch(`/contacts/${cId}/notes/${noteId}`, {}, { method: 'DELETE' });
        return res.json({ action: 'note_deleted', contactId: cId, noteId, timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Create task on contact ---
    if (postAction === 'create-task' && cId) {
      const body = req.body;
      if (!body || !body.title) {
        return res.status(400).json({
          error: 'Missing required fields.',
          required: ['title'],
          optional: ['description', 'dueDate', 'assignedTo', 'completed'],
          example: { title: 'Follow up on quote', description: 'Call about pricing', dueDate: '2026-04-10T12:00:00Z', assignedTo: 'USER_ID', completed: false }
        });
      }
      try {
        const data = await ghlFetch(`/contacts/${cId}/tasks`, {}, {
          method: 'POST',
          body: { title: body.title, body: body.description || '', dueDate: body.dueDate || null, assignedTo: body.assignedTo || null, completed: body.completed || false }
        });
        return res.json({ action: 'task_created', contactId: cId, task: data.task || data, timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // --- Default POST: Add note to contact ---
    const { body: noteBody } = req.body || {};
    if (!cId) return res.status(400).json({ error: 'Missing id query parameter (contact ID).' });
    if (!noteBody) return res.status(400).json({ error: 'Missing body field in request body.', example: { body: 'Note text here' } });
    try {
      const data = await ghlFetch(`/contacts/${cId}/notes`, {}, {
        method: 'POST',
        body: { body: noteBody }
      });
      return res.json({ action: 'note_added', contactId: cId, note: data, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // === GET handlers below ===
  const { mode, action, q, id, contactId, pipeline, limit = '100' } = req.query;

  // Map action param to mode for backward compat
  const resolvedMode = mode || (action === 'contact' ? 'contacts' : action === 'conversation' ? 'conversations' : action) || null;

  try {
    // === SINGLE CONTACT BY ID ===
    if ((resolvedMode === 'contacts' || action === 'contact') && id) {
      // Fetch contact + notes in parallel — notes require a separate API call
      const [data, notes] = await Promise.all([
        ghlFetch(`/contacts/${id}`, {}),
        fetchContactNotes(id)
      ]);
      if (!data.contact) {
        return res.status(404).json({ error: 'Contact not found', id });
      }
      const contact = enrichContact(data.contact, true);
      contact.notes = notes;
      return res.json({
        mode: 'contact',
        contact,
        timestamp: new Date().toISOString()
      });
    }

    // === NOTES BY CONTACT ID (dedicated route) ===
    if ((resolvedMode === 'notes' || action === 'notes') && (id || contactId)) {
      const targetId = id || contactId;
      const notes = await fetchContactNotes(targetId);
      return res.json({
        mode: 'notes',
        contactId: targetId,
        total: notes.length,
        notes,
        timestamp: new Date().toISOString()
      });
    }

    // === CONTACT DETAIL — Full profile + opportunities + conversation history ===
    if (resolvedMode === 'contact-detail' && (id || q)) {
      // If searching by name/email, find the contact first
      let detailContactId = id;
      let contactData;
      if (!detailContactId && q) {
        const searchData = await ghlFetch('/contacts/', { locationId: LOCATION_ID, query: q, limit: '1' });
        const found = (searchData.contacts || [])[0];
        if (!found) return res.status(404).json({ error: 'Contact not found', query: q });
        detailContactId = found.id;
        contactData = found;
      }
      if (!contactData) {
        const data = await ghlFetch(`/contacts/${detailContactId}`, {});
        if (!data.contact) return res.status(404).json({ error: 'Contact not found', id: detailContactId });
        contactData = data.contact;
      }

      // Pull opportunities + conversations + notes in parallel
      const [oppsData, convoSearch, contactNotes] = await Promise.all([
        ghlFetch('/opportunities/search', { location_id: LOCATION_ID, q: contactData.contactName || contactData.firstName || q, limit: '20' }),
        ghlFetch('/conversations/search', { locationId: LOCATION_ID, contactId: detailContactId }),
        fetchContactNotes(detailContactId)
      ]);

      // Get conversation messages if conversation exists
      let messages = [];
      const convo = (convoSearch.conversations || [])[0];
      if (convo) {
        try {
          const msgData = await ghlFetch(`/conversations/${convo.id}/messages`, { limit: limit || '30' });
          const rawMessages = Array.isArray(msgData.messages) ? msgData.messages
            : Array.isArray(msgData) ? msgData
            : msgData.messages?.messages ? msgData.messages.messages
            : [];
          messages = rawMessages.map(m => ({
            id: m.id,
            body: m.body,
            direction: m.direction,
            type: m.messageType || m.type,
            status: m.status,
            dateAdded: m.dateAdded
          }));
        } catch (msgErr) {
          messages = [{ error: 'Could not fetch messages', detail: msgErr.message }];
        }
      }

      // Filter opportunities to those matching this contact
      const contactName = (contactData.contactName || [contactData.firstName, contactData.lastName].filter(Boolean).join(' ')).toLowerCase();
      const contactEmail = (contactData.email || '').toLowerCase();
      const opportunities = (oppsData.opportunities || [])
        .filter(o => {
          const oppName = (o.name || '').toLowerCase();
          const oppEmail = (o.email || '').toLowerCase();
          return oppName.includes(contactName) || (contactEmail && oppEmail === contactEmail);
        })
        .map(enrichOpportunity);

      const detailContact = enrichContact(contactData, true);
      detailContact.notes = contactNotes;

      return res.json({
        mode: 'contact-detail',
        contact: detailContact,
        opportunities,
        conversation: {
          total: messages.length,
          messages
        },
        timestamp: new Date().toISOString()
      });
    }

    // === CONVERSATION HISTORY BY CONTACT ID ===
    if ((resolvedMode === 'conversations' || action === 'conversation') && contactId) {
      // First get the conversation ID for this contact
      const searchData = await ghlFetch('/conversations/search', { locationId: LOCATION_ID, contactId });
      const convo = (searchData.conversations || [])[0];
      if (!convo) {
        return res.json({
          mode: 'conversation',
          contactId,
          messages: [],
          total: 0,
          timestamp: new Date().toISOString()
        });
      }
      // Fetch messages from the conversation
      const msgData = await ghlFetch(`/conversations/${convo.id}/messages`, { limit });
      const messages = (msgData.messages || []).map(m => ({
        id: m.id,
        body: m.body,
        direction: m.direction,
        type: m.messageType || m.type,
        status: m.status,
        dateAdded: m.dateAdded
      }));
      return res.json({
        mode: 'conversation',
        contactId,
        conversationId: convo.id,
        contactName: convo.fullName || convo.contactName,
        total: msgData.total || messages.length,
        messages,
        timestamp: new Date().toISOString()
      });
    }

    // === CONTACTS (search) ===
    if (resolvedMode === 'contacts' || (!resolvedMode && q)) {
      const params = { locationId: LOCATION_ID, limit };
      if (q) params.query = q;
      const data = await ghlFetch('/contacts/', params);
      const contacts = (data.contacts || []).map(enrichContact);
      return res.json({
        mode: 'contacts',
        query: q || null,
        total: data.meta?.total || contacts.length,
        contacts,
        timestamp: new Date().toISOString()
      });
    }

    // === STAGES (fetch pipeline stage definitions from GHL) ===
    if (resolvedMode === 'stages') {
      const data = await ghlFetch('/opportunities/pipelines', { locationId: LOCATION_ID });
      const pipelines = (data.pipelines || []).map(p => ({
        id: p.id,
        name: p.name,
        stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position }))
      }));
      // If a specific pipeline was requested, filter to just that one
      const filtered = pipeline ? pipelines.filter(p => p.id === pipeline) : pipelines;
      return res.json({
        mode: 'stages',
        pipelines: filtered,
        timestamp: new Date().toISOString()
      });
    }

    // === PIPELINE / OPPORTUNITIES ===
    if (resolvedMode === 'pipeline') {
      // GHL /opportunities/search caps at 100 per request. Paginate via meta.startAfter / startAfterId
      // up to the caller's requested limit (or a hard ceiling to keep request cost bounded).
      const requested = Math.min(parseInt(limit, 10) || 100, 1000);
      const PAGE = 100;
      const baseParams = { location_id: LOCATION_ID };
      if (pipeline) baseParams.pipeline_id = pipeline;
      if (q) baseParams.q = q;

      const opportunities = [];
      let metaTotal = null;
      let startAfter = null;
      let startAfterId = null;
      while (opportunities.length < requested) {
        const params = { ...baseParams, limit: String(Math.min(PAGE, requested - opportunities.length)) };
        if (startAfter) params.startAfter = startAfter;
        if (startAfterId) params.startAfterId = startAfterId;
        const data = await ghlFetch('/opportunities/search', params);
        const page = (data.opportunities || []).map(enrichOpportunity);
        if (metaTotal == null) metaTotal = data.meta?.total ?? null;
        if (!page.length) break;
        opportunities.push(...page);
        startAfter = data.meta?.startAfter || null;
        startAfterId = data.meta?.startAfterId || null;
        if (!startAfter && !startAfterId) break;
        if (page.length < PAGE) break;
      }

      // Summary stats
      const stats = {
        total: metaTotal ?? opportunities.length,
        totalValue: opportunities.reduce((s, o) => s + o.value, 0),
        byStatus: {},
        byPipeline: {},
        byStage: {}
      };
      opportunities.forEach(o => {
        stats.byStatus[o.status] = (stats.byStatus[o.status] || 0) + 1;
        stats.byPipeline[o.pipeline] = (stats.byPipeline[o.pipeline] || 0) + 1;
        stats.byStage[o.stage] = (stats.byStage[o.stage] || 0) + 1;
      });

      return res.json({
        mode: 'pipeline',
        query: q || null,
        pipelineFilter: pipeline ? (PIPELINE_NAMES[pipeline] || pipeline) : 'all',
        stats,
        opportunities,
        timestamp: new Date().toISOString()
      });
    }

    // === CONVERSATIONS (search) ===
    if (resolvedMode === 'conversations') {
      const params = { locationId: LOCATION_ID, limit };
      if (q) params.query = q;
      const data = await ghlFetch('/conversations/search', params);
      const conversations = (data.conversations || []).map(c => ({
        id: c.id,
        contactId: c.contactId,
        contactName: c.fullName || c.contactName,
        lastMessage: c.lastMessageBody,
        lastMessageAt: c.lastMessageDate,
        type: c.lastMessageType,
        unread: c.unreadCount || 0
      }));
      return res.json({
        mode: 'conversations',
        query: q || null,
        total: data.total || conversations.length,
        conversations,
        timestamp: new Date().toISOString()
      });
    }

    // === USERS (list GHL account users) ===
    if (resolvedMode === 'users') {
      const data = await ghlFetch('/users/', { locationId: LOCATION_ID });
      const users = (data.users || []).map(u => ({
        id: u.id,
        name: u.name,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        role: u.roles?.role || u.role,
        type: u.type
      }));
      return res.json({ mode: 'users', users, timestamp: new Date().toISOString() });
    }

    // === TASKS (list/create tasks for a contact) ===
    if (resolvedMode === 'tasks' && contactId) {
      const data = await ghlFetch(`/contacts/${contactId}/tasks`, {});
      return res.json({ mode: 'tasks', contactId, tasks: data.tasks || [], timestamp: new Date().toISOString() });
    }

    // === TASKS (LOCATION-WIDE — all tasks across all contacts) ===
    if (resolvedMode === 'tasks') {
      const data = await ghlFetch(`/locations/${LOCATION_ID}/tasks`, { isLocation: 'true' });
      const allTasks = data.tasks || [];
      const open = allTasks.filter(t => !t.completed);

      // Enrich with contact name + assignee name. Contact names come from a small lookup batch.
      const contactIds = [...new Set(open.map(t => t.contactId).filter(Boolean))];
      const contactsById = {};
      if (contactIds.length) {
        // Pull from /contacts/?locationId — keeping it simple, fetch top 100
        const contactsData = await ghlFetch('/contacts/', { locationId: LOCATION_ID, limit: '100' }).catch(() => null);
        for (const c of (contactsData?.contacts || [])) {
          contactsById[c.id] = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || 'Unknown';
        }
      }
      const USER_NAMES = {
        'k3jdWA78r6EyiBEDDHd9': 'Mackenzie',
        'ri1tt8RZPuABuBwE8kmS': 'Darcy',
        '1hpihSwkZ5saFcNPXpMp': 'Diego'
      };
      const now = Date.now();
      const enriched = open.map(t => {
        const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
        return {
          id: t.id,
          title: t.title,
          body: (t.body || '').replace(/<[^>]+>/g, '').trim(),
          contactId: t.contactId,
          contactName: contactsById[t.contactId] || null,
          assignedTo: t.assignedTo,
          assignedToName: USER_NAMES[t.assignedTo] || t.assignedTo,
          dueDate: t.dueDate,
          dateAdded: t.dateAdded,
          overdue: due ? due < now : false,
          dueSoon: due ? (due - now) < 86400000 : false
        };
      }).sort((a, b) => {
        // Overdue first, then by due date ascending
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      });
      return res.json({
        mode: 'tasks',
        scope: 'location',
        total: allTasks.length,
        open: enriched.length,
        overdue: enriched.filter(t => t.overdue).length,
        dueSoon: enriched.filter(t => t.dueSoon && !t.overdue).length,
        tasks: enriched,
        timestamp: new Date().toISOString()
      });
    }

    // === APPOINTMENTS (calendar events at the location, e.g. inspection bookings) ===
    // GHL's /calendars/events/appointments endpoint requires one of
    // calendarId / userId / groupId plus a (startTime, endTime) window in
    // millisecond epochs. We enumerate the location's calendars once (cached
    // for 5 min in module scope), fan out one fetch per calendar in parallel,
    // then normalize into a single sorted list. Window defaults to the next
    // 7 days; clamp to 1..30 to keep response time bounded.
    if (resolvedMode === 'appointments') {
      // Codex P1 (PR #108): this mode returns contact PII (name, phone,
      // email, address) for each upcoming inspection. Other ghl.js modes
      // expose aggregate pipeline + opportunity data that internal chat
      // tools rely on without a session, but appointment-level contact
      // detail is the same surface as /api/inspections and must require
      // a valid portal session.
      const session = await resolveSession(req);
      if (!session) return res.status(401).json({ error: 'sign_in_required' });

      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
      const now = new Date();
      const startTime = now.getTime();
      const endTime = startTime + days * 86400000;

      const calendars = await listCalendarsCached();
      if (!calendars.length) {
        return res.json({
          mode: 'appointments',
          locationId: LOCATION_ID,
          window: { startTime, endTime, days },
          calendars: [],
          appointments: [],
          total: 0,
          timestamp: new Date().toISOString()
        });
      }

      const fetches = calendars.map(c =>
        ghlFetch('/calendars/events', {
          locationId: LOCATION_ID,
          calendarId: c.id,
          startTime: String(startTime),
          endTime: String(endTime)
        }).then(d => ({ calendar: c, events: d.events || [] }))
          .catch(err => ({ calendar: c, events: [], error: err.message }))
      );
      const results = await Promise.all(fetches);

      const appointments = [];
      for (const { calendar, events } of results) {
        for (const ev of events) {
          const apptStatus = ev.appointmentStatus || ev.status || 'confirmed';
          if (apptStatus === 'cancelled' || apptStatus === 'invalid') continue;
          // Appointment payload contact info shows up in three shapes depending
          // on calendar config. Try embedded contact object, then top-level
          // first/last, then null. UI shows contactId as a deep-link fallback.
          const contactName = (ev.contact?.name
            || [ev.contact?.firstName, ev.contact?.lastName].filter(Boolean).join(' ').trim()
            || [ev.firstName, ev.lastName].filter(Boolean).join(' ').trim()
            || null) || null;
          appointments.push({
            id: ev.id,
            title: ev.title || calendar.name || 'Appointment',
            startTime: ev.startTime,
            endTime: ev.endTime,
            address: ev.address || null,
            contactId: ev.contactId || null,
            contactName,
            contactPhone: ev.contact?.phone || ev.phone || null,
            contactEmail: ev.contact?.email || ev.email || null,
            assignedUserId: ev.assignedUserId || null,
            status: apptStatus,
            calendarId: calendar.id,
            calendarName: calendar.name,
            notes: ev.notes || null
          });
        }
      }
      appointments.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

      return res.json({
        mode: 'appointments',
        locationId: LOCATION_ID,
        window: { startTime, endTime, days },
        calendars: calendars.map(c => ({ id: c.id, name: c.name })),
        appointments,
        total: appointments.length,
        timestamp: new Date().toISOString()
      });
    }

    // === OVERVIEW (default) ===
    const [contactsData, oppsData] = await Promise.all([
      ghlFetch('/contacts/', { locationId: LOCATION_ID, limit: '5' }),
      ghlFetch('/opportunities/search', { location_id: LOCATION_ID, limit: '10' })
    ]);

    const recentContacts = (contactsData.contacts || []).map(enrichContact);
    const opps = (oppsData.opportunities || []).map(enrichOpportunity);
    const openOpps = opps.filter(o => o.status === 'open');

    return res.json({
      mode: 'overview',
      totalContacts: contactsData.meta?.total || 0,
      totalOpportunities: oppsData.meta?.total || 0,
      openOpportunities: openOpps.length,
      pipelineValue: opps.reduce((s, o) => s + o.value, 0),
      pipelines: Object.values(PIPELINE_NAMES),
      recentContacts,
      recentOpportunities: opps.slice(0, 5),
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, timestamp: new Date().toISOString() });
  }
}
