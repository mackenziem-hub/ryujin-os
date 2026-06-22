import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { ghlDateToIso } from '../lib/ghl.js';
import { cleanPipeline, dedupeByContact, isTestContact } from '../lib/pipelineHygiene.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const GHL_VERSION = '2021-07-28';

// PIPELINE_NAMES + PIPELINE_STAGES re-verified against live GHL on 2026-06-15.
// Source: GET /opportunities/pipelines?locationId=aHotOUdq9D8m3JPrRz9n (mode=stages).
// Live API is the source of truth; the prior 2026-05-09 map was missing 4 whole
// pipelines (Hiring, Recruiting, Operations was present, Revive Rejuvenation) and
// had a hand-stubbed Internal Pipeline whose stage IDs resolved to wrong names
// (d2c91d4c was labelled 'Proposal Sent' but is really 'Follow Up Text Sent';
// e7ea3e84 was 'Closed' but is 'Client Responded'). When the chat brain
// hallucinates a pipeline/stage name, re-pull and replace these maps.

export const PIPELINE_NAMES = {
  'OF6SJPdnmQS7KcgRffrb': '10 CM Pipeline',
  'jTAc7D9RMHBb3Gzb5bQz': "Darcy's Pipeline",
  'Kn9x4OuSdLZRdEPDhcf5': 'Hiring Pipeline',
  'eJm8vgBePJStA1QdZqmA': 'Instant Estimator',
  's78IPqC050pvYTGUDvFe': 'Internal Pipeline',
  'zpBXZwtiHHNQQKJoEIIU': 'Operations Pipeline',
  '1xCcKvSynQ1vb1FCKH13': 'Recruiting Pipeline',
  'MLroVluZOjTsbvs1rrkC': 'Repair Pipeline',
  'PwZ2WtgZZuuQ2UWKaMtP': 'Revive Rejuvenation Pipeline',
  'nJqJ681y17CWjkCRzVhH': 'Voice AI'
};

export const PIPELINE_STAGES = {
  // Internal Pipeline (re-pulled from live 2026-06-20: this stage was unmapped,
  // so the deal bar / snapshot byStage rendered a raw UUID).
  'e4f6e820-bafc-43fa-8fcc-e18782561dd6': 'Inspection Complete',
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
  // Hiring Pipeline
  '5590eea2-2ff1-4499-9ffb-c4cb3025f55e': 'New Applicant',
  'f8cf264c-b96d-4e1e-b5d3-cb0b7825378a': 'Phone Screen Booked',
  '31c4418e-fa8a-4001-a8db-11c43491340f': 'Interview',
  '00013df2-6f39-42fc-be32-9faef673759c': 'Trial Day',
  '9c9d73db-7d2a-425b-a7b5-aa0789aeda69': 'Offer',
  '735d0668-8eab-47aa-89fb-9792a287049a': 'Hired',
  'ea93a201-aba1-4c40-9a1e-ea471f5b63e1': 'Not a Fit',
  // Instant Estimator
  '1e82765c-2ef2-4810-bcbf-9d6a926dba7b': 'New IE Submission',
  '201128e6-98a0-4aef-8c81-e8226ca11135': 'Personal Video Sent',
  '3f86ad5a-6515-42c1-9dd2-ab47db8619da': 'Follow Up 1',
  'c57ed297-da41-44ea-aac8-731aeff46416': 'Follow Up 2',
  '1c749b02-2bbb-40e3-837e-92e74989aa40': 'Follow Up 3',
  'e56cc6af-b1d3-42a5-b1a5-e39cc47f14fe': 'Follow Up 4',
  '867ff167-6f39-4a97-a5cf-dde0b4d7e3b0': 'Follow Up 5',
  '6ab8cc69-dddd-4432-b9d9-6bb7df4ee9f6': 'Client Responded',
  'e0248e36-84b9-44f9-af57-9fff54039915': 'Inspection Booked',
  '4f4dc4bf-c2b0-48e9-a921-0c40436c2df1': 'Inspection Completed',
  '5cef659b-c45c-410b-ac9e-2defda447b64': 'Quote Ready',
  'eeb9dd8d-7127-416c-aa11-a2d5a7d2e2d1': 'Day 14 Check-in',
  '496b9e21-3d00-48d1-8fbf-9e83123af3ee': 'Day 21 Lost',
  'bd7eff09-04c5-41eb-9fb2-edf0c2374780': 'DND',
  '2a5b6252-0551-4433-a9fe-ee94358d2f47': 'Nurture Started',
  '70b551ea-0578-405a-b82c-8c5b0e912c37': 'Qualified',
  '32c45d0b-33fe-43b6-be74-a0988a803778': 'Nurture Stalled',
  // Internal Pipeline
  'f0823692-8a3a-4512-a780-ad7739edd7cc': 'New Lead',
  'a645cca6-b900-486e-b2b3-3d11d28828f6': 'Text Sent- Awaiting Response',
  'd2c91d4c-3fb6-46be-98cd-1465e5f75213': 'Follow Up Text Sent',
  'e7ea3e84-8e88-4451-be28-ed0291a23bdf': 'Client Responded',
  '14ddb9bf-13fb-47db-af8e-2642f5bd2fa0': 'Unresponsive',
  'dc61e703-0c7f-4e38-bcc3-f7e1658637f9': 'Inspection Scheduled',
  'e59f1ae5-0f59-4e91-ab25-c0696b407b49': 'Quote Sent',
  'd9c77919-a7b2-468a-bc97-b0a5f94e5c6c': 'Contract Signed',
  '61e5b1ce-f277-4052-be52-37a7414933b0': 'DND/ Out of Town',
  'bc4147ca-10f8-42d3-9e99-cc3ab449484d': 'Lost',
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
  // Recruiting Pipeline
  '576457f2-95ce-426c-8858-ffe7f7862528': 'New Applicant',
  '9a61211f-6ffe-4a5e-a388-263923754c34': 'Qualified to Call',
  'a58fa27c-7e44-424c-949e-097ed8bf246a': 'Contacted',
  '1fcb864f-445e-4895-b340-5d37530812fc': 'Interview Requested',
  '866ba359-3092-481d-a529-9c8f2fe0b139': 'Interview Scheduled',
  'ea5dcc55-2ab6-4d73-8b88-eac8fbcd7bfd': 'Trial / Working Interview',
  '71aa6485-fc19-44bb-875f-46daf0d87bbe': 'Offer Made',
  '3be6c4be-97ff-423c-bb7f-588f7222e8c3': 'Hired',
  '83c36163-552d-4c27-a408-5c1e587d517e': 'Not a Fit',
  // Repair Pipeline
  '1f6a7d30-a537-4bac-9725-aceedaae5c2a': 'Repair Requested',
  '3e4e1a9b-8b74-4b97-801a-1547f3c5a0d9': 'Repair Confirmed',
  '2208dfab-2774-4b0e-9ba2-24d50969dda5': 'Repair Assigned',
  '4f2ad3be-d3ac-4394-ad19-e210e9a7c2a7': 'Repair Complete',
  'e68789b9-cfcb-4019-8863-7fc71520cf97': 'Invoice Sent',
  '2cd5c35f-64a3-4d26-aa1a-4609f691e795': 'Invoice Paid',
  // Revive Rejuvenation Pipeline
  'b7754ce6-ef21-4b20-a837-43765fef315c': 'PDF Downloaded',
  '9179e827-cfd4-454e-a435-ba792d396a1a': 'Follow Up 1',
  '4e93b3dc-e05e-41fa-8f4a-bd48e1f59a11': 'Follow Up 2',
  '53452242-4bda-4ab1-b51e-6c25db92d9ae': 'Follow Up 3',
  '9e32b0de-506a-4846-aef8-b9d63710118f': 'Follow Up 4',
  '080e6efe-7585-4daf-92d4-01841c3b4462': 'Follow Up 5',
  '8310770d-31dc-4247-bd05-31afcafc6bd3': 'Spray Feasibility Booked',
  '3a7aeb5c-a962-4cb5-9a36-85df7c46ebba': 'Client Responded',
  'fccc2db8-ca51-488b-999a-88b00e657f97': 'May Not Qualify',
  'b72f0e06-1995-43d5-bb7e-a310ce3ec4cf': 'DND Stopped',
  'a0ea877b-f22f-4e87-947b-4feb906facca': 'Lost - Reactivation Eligible',
  // Voice AI
  'a94b67a4-174d-4004-b122-8d2ae646fa41': 'Customer Called',
  '25022415-6343-49b2-bae3-6140711bd8f3': 'Telemarketers',
  'f17181c8-ef31-4c35-8ee4-efac41161b75': 'Quote Requested',
  // Legacy stage IDs (renamed/removed in GHL but may still be referenced by old
  // opportunities; kept so they resolve to a name instead of a raw UUID)
  '1a33335e-ae57-4c4e-984b-ccd0678ff14a': 'Day 1 Bump',
  '2abe3fa1-7fa2-4732-9204-04b219a03ec1': 'Day 3 Bump',
  '13584262-7832-4c17-b17c-26df8d7659f0': 'Contacted'
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

export function enrichOpportunity(opp) {
  return {
    id: opp.id,
    name: opp.name,
    // email/phone live on the nested contact object in the GHL search payload;
    // the old top-level opp.email/opp.phone were always undefined (latent bug).
    email: opp.email || opp.contact?.email || null,
    phone: opp.phone || opp.contact?.phone || null,
    value: opp.monetaryValue || 0,
    status: opp.status,
    contactId: opp.contactId || opp.contact?.id || null,
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

// ── Proposal-build data join (CRM warm-close unblock, ord-20260616-1402-D) ────
// The CRM card needs the two inputs a proposal is built from: roof measurements
// and the prior proposal numbers. Estimator OS holds both for digitized jobs;
// the Instant Estimator holds a measurement plus an auto-estimate for web leads.
// Matched to the GHL contact by email, then phone, then address, then name.
// Fail-open: a source that is down just yields no match plus a data gap note,
// never a hollow card pretending the data exists.
const PROPOSAL_SOURCES = {
  estimates: {
    label: 'Estimator OS',
    url: 'https://estimator-os.replit.app/api/estimates',
    key: (process.env.ESTIMATOR_KEY || process.env.ESTIMATOR_OS_KEY || 'pu-estimator-2026').trim(),
  },
  leads: {
    label: 'Instant Estimator',
    url: 'https://plus-ultra-roof-estimator.replit.app/api/leads',
    key: (process.env.INSTANT_EST_KEY || process.env.INSTANT_ESTIMATOR_KEY || 'pu-instantest-2026').trim(),
  },
};

const digits10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const normAddr = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);

async function fetchProposalSource(src) {
  try {
    const r = await fetch(src.url, { headers: { 'x-api-key': src.key } });
    if (!r.ok) return null; // null = source unreachable (distinct from empty set)
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.data || d.estimates || d.leads || []);
    return Array.isArray(arr) ? arr : [];
  } catch { return null; }
}

// Returns { roof, lastProposal, dataGaps } for a GHL contact. Nulls plus an
// explicit gap note when a datum is genuinely not in a reachable source.
async function joinProposalBuildData(contact) {
  const email = String(contact.email || '').toLowerCase().trim();
  const phone = digits10(contact.phone);
  const name = String(contact.contactName || [contact.firstName, contact.lastName].filter(Boolean).join(' ')).toLowerCase().trim();
  const addr = normAddr(contact.address1 || contact.address);
  const gaps = [];
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

  const [estimates, leads] = await Promise.all([
    fetchProposalSource(PROPOSAL_SOURCES.estimates),
    fetchProposalSource(PROPOSAL_SOURCES.leads),
  ]);
  if (estimates === null) gaps.push('Estimator OS was unreachable this request, so a digitized estimate could not be checked. Retry, or confirm the estimator-os API key.');
  if (leads === null) gaps.push('Instant Estimator was unreachable this request, so a web auto-estimate could not be checked.');

  const score = (cEmail, cPhone, cAddr, cName) => {
    if (email && cEmail && String(cEmail).toLowerCase().trim() === email) return 4;
    if (phone && cPhone && digits10(cPhone) === phone) return 3;
    if (addr && cAddr && normAddr(cAddr) === addr) return 2;
    if (name && cName && name.length > 4 && String(cName).toLowerCase().includes(name)) return 1;
    return 0;
  };

  let est = null, estScore = 0;
  for (const e of (estimates || [])) {
    const c = e.customer || {};
    const s = score(c.email, c.phone, c.address, c.fullName);
    if (s > estScore) { estScore = s; est = e; }
  }
  let lead = null, leadScore = 0;
  for (const l of (leads || [])) {
    const c = l.customerInfo || {};
    const s = score(c.email, c.phone, c.address, c.name);
    if (s > leadScore) { leadScore = s; lead = l; }
  }

  let roof = null, lastProposal = null;
  if (est) {
    const rm = est.roofMeasurements || {};
    const pricing = est.pricing || {};
    const tier = est.selectedPackage || null;
    const tierKey = tier ? String(tier).toLowerCase() : null;
    // pricing[tier] is an object ({hardCost, multiplier, sellingPrice, ...}),
    // so the customer-facing number is .sellingPrice, never the block itself.
    const tierBlock = (tierKey && pricing[tierKey] && typeof pricing[tierKey] === 'object') ? pricing[tierKey] : null;
    const tierSell = tierBlock ? num(tierBlock.sellingPrice) : null;
    roof = {
      squares: rm.roofAreaSq ?? null,
      pitch: rm.roofPitch ?? null,
      complexity: rm.complexity ?? null,
      facets: { eavesLf: rm.eavesLf ?? null, rakesLf: rm.rakesLf ?? null, ridgeLf: rm.ridgeLf ?? null, valleysLf: rm.valleysLf ?? null, hipsLf: rm.hipsLf ?? null },
      chimney: rm.chimneyType ?? null,
      wasteFactor: rm.wasteFactor ?? null,
      source: 'Estimator OS', sourceId: est.id, matchedBy: estScore,
    };
    lastProposal = {
      tier,
      total: num(est.finalAcceptedTotal) ?? tierSell ?? null,
      status: est.proposalStatus || est.jobStatus || null,
      date: est.publishedAt || est.updatedAt || est.createdAt || null,
      url: est.proposalUrl || est.proposalPdfUrl || est.loomVideoUrl || null,
      source: 'Estimator OS', sourceId: est.id,
    };
    if (estScore < 4) gaps.push('Estimator OS matched by ' + (estScore === 3 ? 'phone' : estScore === 2 ? 'address' : 'name') + ' not email, so confirm it is the same customer before quoting.');
  } else if (lead) {
    roof = {
      squares: lead.roofSizeSq ?? null,
      pitch: lead.pitch ?? null,
      complexity: lead.complexity ?? null,
      facets: null,
      chimney: null,
      source: 'Instant Estimator', sourceId: lead.id, matchedBy: leadScore,
    };
    lastProposal = {
      tier: null,
      total: num(lead.estimatedPrice),
      status: lead.status || null,
      date: lead.createdAt || null,
      url: null,
      source: 'Instant Estimator auto-estimate (web self-serve, not a sent proposal)', sourceId: lead.id,
    };
    gaps.push('Only an Instant Estimator auto-estimate matched, not a sent proposal. The actual sent-proposal tier and total, if one went out, may live in the contact notes or Automator.');
  }

  if (!roof && estimates !== null && leads !== null) {
    gaps.push('No Estimator OS or Instant Estimator record matched this contact by email, phone, address, or name. Note: the Instant Estimator feed returns only its most recent ~50 leads (the Replit /api/leads endpoint ignores limit and email params), so an older web lead can exist but be out of reach until that endpoint gains a query. Otherwise the roof was likely measured offline via EagleView, or the proposal lives in Automator/Supabase. Pull an EagleView or read the contact notes.');
  }

  return { roof, lastProposal, dataGaps: gaps };
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

    // --- Update calendar config (POST action=update-calendar-config&id=<calendarId>) ---
    // Owner/admin only (top-of-handler gate). Updates a calendar's post-booking
    // behavior and slot timing. Primary use: point a booking calendar's
    // confirmation at a redirect URL — so a conversion pixel on that landing page
    // (Google Ads / Meta) fires — instead of an inline thank-you message.
    //
    // Two GHL gotchas, both verified against the official CalendarUpdateDTO spec
    // and live 422/diff testing:
    //  1) Casing: the WRITE DTO uses formSubmitRedirectURL (upper) + enum value
    //     RedirectURL, but the GET *response* returns lowercase formSubmitRedirectUrl.
    //     We send write casing and read either casing back.
    //  2) Default-reset: omitting a field that has a DTO default can reset it to
    //     that default (observed: a form-only write reset slotDuration/slotInterval
    //     60 -> 30). So before writing we GET the calendar and carry the current
    //     value of every defaulted field forward, unless the caller overrides it.
    //     We do NOT echo the full object — its openHours shape fails write validation.
    //   body: { formSubmitType?: 'RedirectURL' | 'ThankYouMessage',
    //           formSubmitRedirectURL?: string, formSubmitThanksMessage?: string,
    //           slotDuration?: number, slotInterval?: number }
    if (postAction === 'update-calendar-config' && !cId) {
      return res.status(400).json({ error: 'Missing id query parameter. Pass ?id=<calendarId>.' });
    }
    if (postAction === 'update-calendar-config' && cId) {
      const body = req.body || {};
      const ALLOWED = ['formSubmitType', 'formSubmitRedirectURL', 'formSubmitThanksMessage', 'slotDuration', 'slotInterval'];
      const update = {};
      for (const k of ALLOWED) if (body[k] !== undefined) update[k] = body[k];
      if (!Object.keys(update).length) {
        return res.status(400).json({
          error: 'No updatable fields. Send at least one of: ' + ALLOWED.join(', '),
          example: { formSubmitType: 'RedirectURL', formSubmitRedirectURL: 'https://booking.example.com/success-booking' }
        });
      }
      if (update.formSubmitType && !['RedirectURL', 'ThankYouMessage'].includes(update.formSubmitType)) {
        return res.status(400).json({ error: "formSubmitType must be 'RedirectURL' or 'ThankYouMessage'." });
      }
      if (update.formSubmitType === 'RedirectURL' && !update.formSubmitRedirectURL) {
        return res.status(400).json({ error: 'formSubmitRedirectURL is required when formSubmitType is RedirectURL.' });
      }
      if (update.formSubmitRedirectURL && !/^https?:\/\//i.test(update.formSubmitRedirectURL)) {
        return res.status(400).json({ error: 'formSubmitRedirectURL must be an absolute http(s) URL.' });
      }
      for (const k of ['slotDuration', 'slotInterval']) {
        if (update[k] !== undefined && (!Number.isInteger(update[k]) || update[k] < 1 || update[k] > 1440)) {
          return res.status(400).json({ error: `${k} must be an integer number of minutes (1-1440).` });
        }
      }
      try {
        // Default-reset guard (gotcha #2): carry forward the current value of every
        // CalendarUpdateDTO field that has a default, so a targeted write never
        // silently resets an unrelated setting. These are all simple scalars that
        // are safe to echo back; complex fields (openHours, availabilities) are NOT
        // defaulted and are left untouched by omission.
        const cur = await ghlFetch(`/calendars/${cId}`, {});
        const c = cur.calendar || cur;
        const preserve = {};
        for (const k of ['widgetType', 'eventColor', 'slotDuration', 'slotInterval', 'enableRecurring', 'formSubmitType']) {
          if (c[k] !== undefined && c[k] !== null) preserve[k] = c[k];
        }
        // If the effective form type is RedirectURL, the URL must travel with it
        // (write casing); the GET returns it lowercase, so map it.
        const effectiveType = update.formSubmitType ?? preserve.formSubmitType;
        if (effectiveType === 'RedirectURL' && update.formSubmitRedirectURL === undefined) {
          const curRedirect = c.formSubmitRedirectURL ?? c.formSubmitRedirectUrl;
          if (curRedirect) preserve.formSubmitRedirectURL = curRedirect;
        }
        const payload = { ...preserve, ...update };
        const data = await ghlFetch(`/calendars/${cId}`, {}, { method: 'PUT', body: payload });
        const cal = data.calendar || data;
        return res.json({
          action: 'calendar_config_updated',
          calendarId: cId,
          applied: update,
          preserved: Object.keys(preserve).filter(k => !(k in update)),
          formSubmit: {
            formSubmitType: cal.formSubmitType ?? null,
            formSubmitRedirectURL: cal.formSubmitRedirectURL ?? cal.formSubmitRedirectUrl ?? null,
            formSubmitThanksMessage: cal.formSubmitThanksMessage ?? null
          },
          slotDuration: cal.slotDuration ?? null,
          slotInterval: cal.slotInterval ?? null,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        return res.status(500).json({ error: err.message, hint: `Inspect current shape via GET ?mode=calendar-config&id=${cId}` });
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
    // === CALENDAR CONFIG (read a calendar's settings, incl. post-booking behavior) ===
    // Gated owner/admin-or-service by the top-of-handler auth gate. Without &id,
    // lists the location's calendars so the caller can pick the right calendarId.
    // With &id=<calendarId>, returns the full calendar object plus a curated
    // formSubmit summary: formSubmitType ('ThankYouMessage' | 'RedirectURL'),
    // formSubmitRedirectURL, formSubmitThanksMessage. Pairs with the POST
    // action=update-calendar-config write mode below.
    if (resolvedMode === 'calendar-config') {
      if (!id) {
        const data = await ghlFetch('/calendars/', { locationId: LOCATION_ID });
        const calendars = (data.calendars || []).map(c => ({
          id: c.id, name: c.name || 'Untitled calendar', isActive: c.isActive !== false
        }));
        return res.json({
          mode: 'calendar-config',
          hint: 'Pass &id=<calendarId> to inspect one calendar\'s settings.',
          calendars,
          timestamp: new Date().toISOString()
        });
      }
      const data = await ghlFetch(`/calendars/${id}`, {});
      const cal = data.calendar || data;
      return res.json({
        mode: 'calendar-config',
        calendar: cal,
        formSubmit: {
          formSubmitType: cal.formSubmitType ?? null,
          formSubmitRedirectURL: cal.formSubmitRedirectUrl ?? cal.formSubmitRedirectURL ?? null,
          formSubmitThanksMessage: cal.formSubmitThanksMessage ?? null
        },
        timestamp: new Date().toISOString()
      });
    }

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
            dateAdded: m.dateAdded,
            // TYPE_ACTIVITY_* entries ("Opportunity updated" etc.) are system events,
            // NOT a real human touch. Flag them so context resolution can strip them.
            isActivity: /^TYPE_ACTIVITY/i.test(m.messageType || m.type || '')
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

      // Honest context summary (the no-customer-without-context spine): strip the
      // TYPE_ACTIVITY_* system events and report the last REAL human touch + what they
      // last said, or flag plainly when there is no real conversation on file.
      const chan = (t) => t ? String(t).replace(/^TYPE_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : 'message';
      const ageOf = (iso) => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null; };
      const realMsgs = messages.filter(m => !m.isActivity && m.body && String(m.body).trim());
      const byNewest = realMsgs.slice().sort((a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')));
      const lastReal = byNewest[0] || null;
      const lastInbound = byNewest.find(m => m.direction === 'inbound') || null;
      const lastOutbound = byNewest.find(m => m.direction === 'outbound') || null;
      const context = {
        realMessageCount: realMsgs.length,
        activityCount: messages.length - realMsgs.length,
        noRealConversation: realMsgs.length === 0,
        lastTouch: lastReal ? { who: lastReal.direction === 'inbound' ? 'them' : 'us', direction: lastReal.direction, channel: chan(lastReal.type), dateAdded: lastReal.dateAdded, ageDays: ageOf(lastReal.dateAdded), preview: String(lastReal.body || '').slice(0, 160) } : null,
        lastAsk: lastInbound ? { body: String(lastInbound.body || '').slice(0, 240), channel: chan(lastInbound.type), dateAdded: lastInbound.dateAdded, ageDays: ageOf(lastInbound.dateAdded) } : null,
        lastOutreach: lastOutbound ? { channel: chan(lastOutbound.type), preview: String(lastOutbound.body || '').slice(0, 160), dateAdded: lastOutbound.dateAdded, ageDays: ageOf(lastOutbound.dateAdded) } : null
      };

      // Join the proposal-build data (roof measurements + prior proposal) for
      // this specific contact. The warm-close unblock (ord-20260616-1402-D):
      // resolve a NAMED customer on demand, never a random sample.
      const proposalBuild = await joinProposalBuildData(contactData).catch(() => ({ roof: null, lastProposal: null, dataGaps: ['Proposal-build data join failed this request.'] }));

      return res.json({
        mode: 'contact-detail',
        contact: detailContact,
        opportunities,
        context,
        roof: proposalBuild.roof,
        lastProposal: proposalBuild.lastProposal,
        dataGaps: proposalBuild.dataGaps,
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

    // === CONTACTS (search + pagination) ===
    // GHL /contacts/ hard-caps at 100 per request. The old version made a single
    // call, so any limit above 100 silently returned only the newest 100 and every
    // consumer was blind to all but the newest slice of ~1900 contacts. Now we page
    // via meta.startAfter + meta.startAfterId (same pattern as the pipeline path).
    // Pagination is OPT-IN: limit<=100 makes exactly one upstream call, so the
    // default response (limit defaults to 100) is byte-identical for existing
    // consumers. Pass limit>100 to page deeper. To fetch one contact by id use
    // ?action=contact&id=<id> (handled above), not the list path.
    if (resolvedMode === 'contacts' || (!resolvedMode && q)) {
      const requested = Math.min(parseInt(limit, 10) || 100, 2000);
      const PAGE = 100;
      const baseParams = { locationId: LOCATION_ID };
      if (q) baseParams.query = q;

      const contacts = [];
      let metaTotal = null;
      let startAfter = null;
      let startAfterId = null;
      while (contacts.length < requested) {
        const params = { ...baseParams, limit: String(Math.min(PAGE, requested - contacts.length)) };
        if (startAfter) params.startAfter = startAfter;
        if (startAfterId) params.startAfterId = startAfterId;
        const data = await ghlFetch('/contacts/', params);
        const page = (data.contacts || []).map(enrichContact);
        if (metaTotal == null) metaTotal = data.meta?.total ?? null;
        if (!page.length) break;
        contacts.push(...page);
        startAfter = data.meta?.startAfter || null;
        startAfterId = data.meta?.startAfterId || null;
        if (!startAfter && !startAfterId) break;
        if (page.length < PAGE) break;
      }

      return res.json({
        mode: 'contacts',
        query: q || null,
        total: metaTotal ?? contacts.length,
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
      // clean=1 pages the FULL book so the cleaned counts are complete + stable (not a function of
      // page size) and returns the test-filtered + deduped set (no test personas, no cross-pipeline dupes).
      const clean = String(req.query?.clean || '') === '1';
      const requested = clean ? 1000 : Math.min(parseInt(limit, 10) || 100, 1000);
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

      // Deduped, test-filtered, sales-qualified figures. `stats` above stays raw
      // (existing consumers rely on it); cleanStats is the trustworthy view that
      // the snapshot/briefing/scan-check-in should read going forward.
      const { salesOpen, counts: cleanStats } = cleanPipeline(opportunities);
      // In clean mode hand back the test-filtered + deduped set so the board never renders a test
      // persona or a cross-pipeline duplicate; salesOpen is the sales-qualified (Internal) open subset.
      const outOpps = clean ? dedupeByContact(opportunities.filter(o => !isTestContact(o))) : opportunities;

      return res.json({
        mode: 'pipeline',
        query: q || null,
        pipelineFilter: pipeline ? (PIPELINE_NAMES[pipeline] || pipeline) : 'all',
        stats,
        cleanStats,
        salesOpen: clean ? salesOpen : undefined,
        opportunities: outOpps,
        clean,
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
        lastMessageAt: ghlDateToIso(c.lastMessageDate),
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
    // openOpportunities is a SAMPLE stat: open-status count within the 10 most
    // recent opportunities fetched above, so it can never exceed 10. It is NOT
    // the global open count (GHL held ~92 status-open while this read 10).
    // The key name is a stable contract for snapshot/_shared/dashboards, so
    // consumers label it honestly instead of renaming it here.
    const openOpps = opps.filter(o => o.status === 'open');

    return res.json({
      mode: 'overview',
      totalContacts: contactsData.meta?.total || 0,
      totalOpportunities: oppsData.meta?.total || 0,
      openOpportunities: openOpps.length,
      openOpportunitiesNote: 'open within the 10 most recent opportunities (sample, max 10), not the global open count',
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
