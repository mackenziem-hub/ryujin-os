const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const GHL_VERSION = '2021-07-28';

const PIPELINE_STAGES = {
  // Main Pipeline
  'a86f1fc9-cfc7-4943-8318-de6e907b5cba': 'Unverified Lead',
  '16ddb0ec-ec32-44b2-9fae-a65b89e555c7': 'Verified Lead - Quote Pending',
  'a37a2218-e80e-4ff0-bf5a-360842de70b4': 'Quote Sent',
  'f872cb17-7e0d-47ca-b1b3-f2bbd38274d9': 'Client Signed',
  '66e83c51-aa6c-4b1f-8db1-ec03b78e5f87': 'Unresponsive',
  'd6b4e607-fa8b-4f0d-a493-cb48fcb5c32a': 'Lost',
  // Lead Pipeline
  'cc572375-5a1e-4f63-a7c8-d944b9098819': 'Unverified Lead',
  '6935b24b-b233-423e-8cb9-71d81c5a1f04': 'Verified Lead | Ready to Prep Quote',
  '60338039-6373-4e98-840e-c878d670dea6': 'Quote Prepped',
  '2b21e880-7538-40f6-94ab-bca6b697b8fb': 'Appointment Booked',
  '41f3a016-1894-4469-ba57-512078f4b7ac': 'Quote Sent',
  // Client Pipeline
  '0b016549-a67f-4ddd-8741-cf81a19551e6': 'Scheduled & Starting',
  'ec78a47c-6edd-4264-84f3-f4b068eb46f3': 'Deposit Invoice Sent',
  '0e6f43dc-3cdf-4328-ad9a-06a299191d9e': 'Deposit Invoice Paid',
  '62ba1072-7a9c-42c3-86f3-96fdf96ede04': 'Job In Progress',
  '38dbbcd8-a5e3-4595-8a28-840ef621fe57': 'Job Complete',
  'f906a79f-b93f-4024-8779-7226010ae941': 'Post Production',
  '097ec4c4-1fed-4f35-a1b3-fb2c3859c1fc': 'Invoice Paid',
  '4b1c01b4-b9d6-475a-8b47-397d2d352fd9': 'The End',
  // Darcy's Pipeline (updated Apr 13 2026)
  '749ba027-c321-4325-a521-3f441fc1480b': 'New Lead',
  '22aba604-4876-4bbc-b796-6be7d392da3b': 'Text Sent- Awaiting Response',
  '3e796404-ada4-40e9-8458-a4863bccc8cf': 'Follow Up Text Sent',
  '5f9d8eb0-8810-4523-b07b-ef64e71ff739': 'Client Responded',
  '4fc0e114-06ca-4ce0-a051-8b6b1dd1b913': 'Unresponsive',
  '1b11eb16-a0e0-4865-899c-f876cb1bc614': 'Inspection Scheduled',
  '61e0e9b8-a2c7-45dd-b9dd-16f238b54cbd': 'Quote Sent',
  'aabfe851-86ff-461d-88d3-b6cbad34de56': 'Contract Signed',
  'ee8bf132-4d11-4943-bb67-1b979fe7f64d': 'DND',
  '4ff006c7-5eda-40b9-b0ee-239134487b80': 'Lost',
  // Mack's Pipeline
  '20576ed3-fc88-4810-ac95-e618445a1b12': 'New Lead',
  'b0742a38-8480-4c4b-8ead-49d538fdc387': 'Quote Sent',
  '25b51d70-231f-433b-a545-d885b5a7fd6a': 'Approved',
  '602f58a5-41e0-4418-af64-aff6a5887425': 'Lost',
  // Repairs
  '5becfb7e-64b8-4417-8403-0b26be6dac13': 'Under Review',
  '71005d25-255b-419f-864c-b84303e249c4': 'Needs Attention (Urgent)',
  'a7e08fe6-3a3a-4c14-98c0-66a3bb7a14de': 'Proposal Sent',
  'ad35de61-1864-41a9-ada5-d39c2ddc6fdd': 'Closed - Repaired',
  // Proposal Sent Pipeline
  'a29226e2-3c7e-4d76-b7f1-7e7609a09be8': 'Proposal Sent',
  'eb0a8ca2-b9c4-44b7-b0a6-fa0c1287217f': 'Approved',
  'bbf0b6d4-e352-4f71-a747-9d1d55696bca': 'Not Moving Forward'
};

const PIPELINE_NAMES = {
  'l2xOb5ApmVbAWADKtra5': 'Main Pipeline',
  'H59xoVuJ37aZnJA0gSzg': 'Lead',
  'Nn9VSlLSjC7FKI86oZrE': 'Email Sequence',
  'N3RNQE1tZescb5KLwD7W': 'Client',
  'E1Bv1tPgfTlRpapF18fY': 'Lead Revival',
  'jTAc7D9RMHBb3Gzb5bQz': "Darcy's Pipeline",
  'OF6SJPdnmQS7KcgRffrb': "Mack's Pipeline",
  '6yjSlNWT1AUncuxrlz20': 'Past Customers',
  'ahWs3qwCDkByRb1e8QSM': 'Proposal Sent',
  'ELHzu5NIjIvIJOvIzkOS': 'Repairs',
  'nJqJ681y17CWjkCRzVhH': 'Voice AI'
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
          example: { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '+15065551234', tags: ['roof-lead'], source: 'Shenron' }
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
      const params = { location_id: LOCATION_ID, limit };
      if (pipeline) params.pipeline_id = pipeline;
      if (q) params.q = q;
      const data = await ghlFetch('/opportunities/search', params);
      const opportunities = (data.opportunities || []).map(enrichOpportunity);

      // Summary stats
      const stats = {
        total: data.meta?.total || opportunities.length,
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
