// GHL Tasks — Simplified task creation with name-to-ID resolution
// Routes: POST /api/ghl-tasks (create task on contact)
// Wraps the GHL Contacts Tasks API with user-friendly assignedTo names

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';
const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const SHENRON_KEY = process.env.SHENRON_API_KEY || 'shenron-write-2026';

// GHL User ID mappings
const USER_MAP = {
  'mackenzie': process.env.GHL_MACKENZIE_ID || 'k3jdWA78r6EyiBEDDHd9',
  'mack': process.env.GHL_MACKENZIE_ID || 'k3jdWA78r6EyiBEDDHd9',
  'darcy': process.env.GHL_DARCY_ID || 'ri1tt8RZPuABuBwE8kmS',
  'diego': process.env.GHL_DIEGO_ID || '1hpihSwkZ5saFcNPXpMp'
};

// Mackenzie's own contact ID for general tasks not tied to a client
const MACKENZIE_CONTACT_ID = '02IhxZfSwZZAZ2fooVGu';

function checkAuth(req) {
  const key = req.headers['x-api-key'];
  const origin = req.headers.origin || req.headers.referer || '';
  const isSameOrigin = origin.includes('ryujin-os.vercel.app') || origin.includes('localhost');
  if (isSameOrigin) return true;
  return key === SHENRON_KEY;
}

async function ghlFetch(path, options = {}) {
  const url = new URL(GHL_BASE + path);
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

async function findContactByName(query) {
  const data = await ghlFetch(`/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(query)}&limit=1`);
  return (data.contacts || [])[0] || null;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!GHL_TOKEN) {
    return res.status(500).json({ error: 'GHL_TOKEN not configured' });
  }

  // === GET: List tasks for a contact ===
  if (req.method === 'GET') {
    const { contactId, contactName } = req.query;
    let resolvedContactId = contactId;

    if (!resolvedContactId && contactName) {
      const contact = await findContactByName(contactName);
      if (!contact) return res.status(404).json({ error: `Contact not found: ${contactName}` });
      resolvedContactId = contact.id;
    }

    if (!resolvedContactId) {
      return res.status(400).json({ error: 'Provide contactId or contactName query parameter' });
    }

    const data = await ghlFetch(`/contacts/${resolvedContactId}/tasks`);
    return res.json({
      contactId: resolvedContactId,
      tasks: data.tasks || [],
      timestamp: new Date().toISOString()
    });
  }

  // === POST: Create task ===
  if (req.method === 'POST') {
    const { title, description, assignedTo, dueDate, contactId, contactName } = req.body || {};

    if (!title) {
      return res.status(400).json({
        error: 'Missing required field: title',
        example: {
          title: 'Follow up on shingle estimate',
          description: 'Check if client has questions about pricing',
          assignedTo: 'mackenzie',
          dueDate: '2026-04-15T12:00:00Z',
          contactName: 'Brian Northrup'
        },
        assignableUsers: Object.keys(USER_MAP)
      });
    }

    // Resolve contact ID
    let resolvedContactId = contactId;
    if (!resolvedContactId && contactName) {
      const contact = await findContactByName(contactName);
      if (!contact) {
        return res.status(404).json({ error: `Contact not found: ${contactName}` });
      }
      resolvedContactId = contact.id;
    }
    // If no contact specified, attach to Mackenzie's contact
    if (!resolvedContactId) {
      resolvedContactId = MACKENZIE_CONTACT_ID;
    }

    // Resolve assignedTo name to GHL user ID
    const resolvedAssignedTo = assignedTo
      ? (USER_MAP[assignedTo.toLowerCase()] || assignedTo)
      : USER_MAP['mackenzie'];

    // Default dueDate to tomorrow if not provided (GHL requires it)
    const resolvedDueDate = dueDate || new Date(Date.now() + 86400000).toISOString();

    try {
      const data = await ghlFetch(`/contacts/${resolvedContactId}/tasks`, {
        method: 'POST',
        body: {
          title,
          body: description || '',
          dueDate: resolvedDueDate,
          assignedTo: resolvedAssignedTo,
          completed: false
        }
      });

      return res.status(201).json({
        action: 'ghl_task_created',
        contactId: resolvedContactId,
        contactName: contactName || null,
        task: data.task || data,
        assignedTo: assignedTo || 'mackenzie',
        assignedToId: resolvedAssignedTo,
        visibleIn: `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/contacts/detail/${resolvedContactId}`,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      return res.status(500).json({ error: err.message, timestamp: new Date().toISOString() });
    }
  }

  return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
}
