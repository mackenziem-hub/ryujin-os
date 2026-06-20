// Ryujin OS — Unified Customer 360
// GET /api/customer-360?id=<native customer uuid | ghl contact id>
// GET /api/customer-360?ghl=<ghl contact id>
//
// One payload that stitches the two-headed customer model into a single
// client-relations view: the Ryujin-native record (customer, estimates,
// workorders, job photos, LTV, linked job folders) PLUS the GoHighLevel side
// (contact, opportunities/deal stage, full multi-channel conversation history,
// notes, appointments, tasks) merged into ONE chronological interaction
// timeline. This is the backbone the rebuilt customer profile renders.
//
// Live-from-GHL by design: per-customer reads are always fresh (no cache to go
// stale). Every source is fetched fail-open with Promise.allSettled so one slow
// or 404ing GHL endpoint never blanks the whole profile; `sources` reports what
// resolved. Research (Talking Points) is wired in Unit 6.
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { ghlFetch, getConversationMessages, getContactByPhone, ghlDateToIso, normalizeChannel } from '../lib/ghl.js';
import { PIPELINE_NAMES, PIPELINE_STAGES, enrichOpportunity } from './ghl.js';
import { list as blobList } from '@vercel/blob';
import { normalizeAddress } from './agents/production.js';

const LOCATION_ID = (process.env.GHL_LOCATION_ID || 'aHotOUdq9D8m3JPrRz9n').trim();

// Mirror customer-profile.html / lib/customerLtvCalc.js so the 360 LTV matches
// the navigator list exactly.
const WON_STATUSES = ['signed', 'accepted', 'scheduled', 'in_progress', 'complete', 'won'];
const LOST_STATES = ['closed_lost', 'lost', 'rejected'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estKind(e) {
  const status = String(e.status || '').toLowerCase();
  const state = String(e.state || '').toLowerCase();
  if (state === 'closed_won' || WON_STATUSES.includes(status)) return 'signed';
  if (state === 'closed_lost' || LOST_STATES.includes(status)) return 'lost';
  if (state.includes('draft') || status.includes('draft')) return 'draft';
  return 'open';
}
function tierVal(p) {
  if (!p) return null;
  const v = p.total ?? p.summary?.sellingPrice ?? p.sellingPrice;
  return v != null ? Number(v) || 0 : null;
}
function sellingPrice(e) {
  if (e.final_accepted_total != null) return Number(e.final_accepted_total) || 0;
  const pkgs = e.calculated_packages || {};
  const sel = tierVal(pkgs[String(e.selected_package || 'gold').toLowerCase()]);
  if (sel != null) return sel;
  let best = 0;
  for (const k of Object.keys(pkgs)) { const v = tierVal(pkgs[k]); if (v != null && v > best) best = v; }
  return best;
}

// Settle a labelled promise: never throws, records why a source failed.
async function settle(label, sources, fn) {
  try { return await fn(); }
  catch (e) { sources[label] = { ok: false, error: String(e?.message || e).slice(0, 200) }; return null; }
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tenantId = req.tenant.id;
  const rawId = String(req.query.id || '').trim();
  const explicitGhl = String(req.query.ghl || '').trim();
  if (!rawId && !explicitGhl) return res.status(400).json({ error: 'Missing id or ghl' });

  const sources = {};

  // ── Resolve the native customer + its GHL contact id ──────────────────────
  // id may be a native uuid OR a GHL contact id. Try native-by-uuid, then
  // native-by-ghl_contact_id, then fall through to GHL-only (lead with no
  // native record yet).
  let customer = null;
  let ghlContactId = explicitGhl || null;

  if (rawId && UUID_RE.test(rawId)) {
    const { data } = await supabaseAdmin
      .from('customers').select('*, estimates(*)')
      .eq('tenant_id', tenantId).eq('id', rawId).maybeSingle();
    if (data) { customer = data; ghlContactId = ghlContactId || data.ghl_contact_id || null; }
  }
  if (!customer && (rawId || explicitGhl)) {
    const lookupGhl = explicitGhl || rawId;
    const { data } = await supabaseAdmin
      .from('customers').select('*, estimates(*)')
      .eq('tenant_id', tenantId).eq('ghl_contact_id', lookupGhl).maybeSingle();
    if (data) { customer = data; ghlContactId = data.ghl_contact_id || lookupGhl; }
    else if (!ghlContactId && !UUID_RE.test(rawId)) ghlContactId = rawId; // treat as GHL id
  }
  if (customer) sources.native = { ok: true };

  // The native<->GHL join (customers.ghl_contact_id) is largely unpopulated for
  // Estimator-originated customers, so resolve the GHL contact live by phone
  // (last-10 match) then exact email when the stored link is missing. Without
  // this the signed-customer 360s show no conversation history at all.
  let ghlMatch = ghlContactId ? 'link' : null;
  if (!ghlContactId && customer) {
    const byPhone = await settle('ghlResolve', sources, () => getContactByPhone(customer.phone));
    if (byPhone?.id) { ghlContactId = byPhone.id; ghlMatch = 'phone'; }
    else if (customer.email) {
      const em = String(customer.email).toLowerCase();
      const search = await settle('ghlResolve', sources, () => ghlFetch('/contacts/', { query: { locationId: LOCATION_ID, query: customer.email, limit: '10' } }));
      const hit = (search?.contacts || []).find(c => String(c.email || '').toLowerCase() === em);
      if (hit?.id) { ghlContactId = hit.id; ghlMatch = 'email'; }
    }
  }

  const estimates = (customer?.estimates) || [];

  // ── Native side (Supabase, parallel) ──────────────────────────────────────
  const estimateIds = estimates.map(e => e.id).filter(Boolean);
  const nativeJobs = await settle('workorders', sources, async () => {
    if (!estimateIds.length) return [];
    const { data } = await supabaseAdmin
      .from('workorders').select('*')
      .eq('tenant_id', tenantId).in('linked_estimate_id', estimateIds);
    return data || [];
  });
  const jobFolders = await settle('jobFolders', sources, async () => {
    // Match by the GHL link AND by the customer's normalized address, so locally
    // pushed Work Order / Material folders surface even for native customers not
    // yet linked to a GHL contact (most signed Estimator customers). Two
    // parameterized .eq() queries merged + deduped — normalizeAddress output has
    // spaces (e.g. '79 willow'), which a raw .or() filter string can't carry.
    const found = new Map();
    if (ghlContactId) {
      const { data } = await supabaseAdmin.from('job_folders').select('*')
        .eq('tenant_id', tenantId).eq('linked_ghl_contact_id', ghlContactId);
      for (const r of (data || [])) found.set(r.id, r);
    }
    const addrKey = customer?.address ? normalizeAddress(customer.address) : null;
    if (addrKey) {
      const { data } = await supabaseAdmin.from('job_folders').select('*')
        .eq('tenant_id', tenantId).eq('address_key', addrKey);
      for (const r of (data || [])) found.set(r.id, r);
    }
    return [...found.values()];
  });
  const photos = await settle('photos', sources, async () => {
    if (!customer?.id) return [];
    const { data: projects } = await supabaseAdmin
      .from('projects').select('id').eq('tenant_id', tenantId).eq('customer_id', customer.id).limit(4);
    if (!projects?.length) return [];
    const sets = await Promise.all(projects.map(p =>
      supabaseAdmin.from('files').select('url,thumbnail_url,mime_type,category,uploaded_at,caption')
        .eq('tenant_id', tenantId).eq('project_id', p.id).then(r => r.data || []).catch(() => [])));
    return sets.flat()
      .filter(f => f && f.url && (String(f.mime_type || '').startsWith('image/') || !f.mime_type) && f.category !== 'document')
      .sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
  });

  // ── GHL side (live, parallel, fail-open per source) ───────────────────────
  let ghlContact = null, opportunities = [], notes = [], appointments = [], tasks = [], conversations = [];
  if (ghlContactId) {
    const cd = await settle('ghlContact', sources, () => ghlFetch(`/contacts/${ghlContactId}`, {}));
    ghlContact = cd?.contact || null;
    if (ghlContact) sources.ghlContact = { ok: true };

    const contactName = ghlContact
      ? (ghlContact.contactName || [ghlContact.firstName, ghlContact.lastName].filter(Boolean).join(' '))
      : (customer?.full_name || '');
    const contactEmail = (ghlContact?.email || customer?.email || '').toLowerCase();

    const [oppsRes, notesRes, apptRes, taskRes, convRes] = await Promise.all([
      settle('opportunities', sources, () => ghlFetch('/opportunities/search', { query: { location_id: LOCATION_ID, q: contactName || contactEmail, limit: '25' } })),
      settle('notes', sources, () => ghlFetch(`/contacts/${ghlContactId}/notes`, {})),
      settle('appointments', sources, () => ghlFetch(`/contacts/${ghlContactId}/appointments`, {})),
      settle('tasks', sources, () => ghlFetch(`/contacts/${ghlContactId}/tasks`, {})),
      settle('conversations', sources, () => ghlFetch('/conversations/search', { query: { locationId: LOCATION_ID, contactId: ghlContactId } })),
    ]);

    // Opportunities: keep only this contact's (name/email match), enrich to readable pipeline/stage.
    const cn = contactName.toLowerCase();
    opportunities = (oppsRes?.opportunities || [])
      .filter(o => {
        const on = (o.name || '').toLowerCase(), oe = (o.email || '').toLowerCase();
        return (cn && on.includes(cn)) || (contactEmail && oe === contactEmail);
      })
      .map(enrichOpportunity);
    if (oppsRes) sources.opportunities = { ok: true, count: opportunities.length };

    notes = (notesRes?.notes || notesRes || []).map(n => ({
      id: n.id, body: n.body || '', createdAt: ghlDateToIso(n.dateAdded || n.createdAt), userId: n.userId || null,
    })).filter(n => n.body);

    const apptList = apptRes?.appointments || apptRes?.events || (Array.isArray(apptRes) ? apptRes : []);
    appointments = apptList.map(a => ({
      id: a.id, title: a.title || a.calendarName || 'Appointment',
      startTime: ghlDateToIso(a.startTime), endTime: ghlDateToIso(a.endTime),
      status: a.appointmentStatus || a.status || 'confirmed', address: a.address || null, notes: a.notes || null,
    })).filter(a => (a.status !== 'cancelled' && a.status !== 'invalid'));

    tasks = (taskRes?.tasks || []).map(t => ({
      id: t.id, title: t.title || 'Task', body: t.body || '',
      dueDate: ghlDateToIso(t.dueDate), completed: !!t.completed, createdAt: ghlDateToIso(t.dateAdded),
    }));

    // All conversations (cap 5 newest), all messages each (cap 50) — the full
    // multi-channel history, not just the first thread contact-detail returned.
    const convs = (convRes?.conversations || []).slice(0, 5);
    if (convs.length) {
      const threads = await Promise.all(convs.map(c =>
        getConversationMessages(c.id, { limit: 50 })
          .then(msgs => ({ conv: c, msgs }))
          .catch(() => ({ conv: c, msgs: [] }))));
      conversations = threads.map(({ conv, msgs }) => ({
        id: conv.id, channel: normalizeChannel(conv.lastMessageType),
        messages: msgs.filter(m => m.body && String(m.body).trim() && !/^TYPE_ACTIVITY/i.test(m.type || '')),
      }));
    }
  }

  // ── Research / talking points (Vercel Blob, written by the research worker) ──
  let research = null;
  if (ghlContactId) {
    research = await settle('research', sources, async () => {
      const key = `crm-research-v/${tenantId}/${ghlContactId}.json`;
      const { blobs } = await blobList({ prefix: key, limit: 1 });
      const exact = blobs.find(b => b.pathname === key); // list() is prefix-based
      if (!exact) return null;
      const r = await fetch(exact.url + '?t=' + Date.now(), { cache: 'no-store' });
      return r.ok ? r.json() : null;
    });
  }

  // ── Stats / deal ──────────────────────────────────────────────────────────
  const won = estimates.filter(e => estKind(e) === 'signed');
  const open = estimates.filter(e => ['open', 'draft'].includes(estKind(e)));
  const ltv = won.reduce((s, e) => s + sellingPrice(e), 0);
  const lastJobAt = won.map(e => e.closed_won_at || e.updated_at).filter(Boolean).sort().reverse()[0] || null;
  const jobCount = (nativeJobs || []).filter(w => String(w.status || '').toLowerCase() === 'complete').length || won.length;

  // Primary deal = the open opportunity with the most recent status change, else newest.
  const sortByRecency = (a, b) => String(b.lastStatusChange || b.createdAt || '').localeCompare(String(a.lastStatusChange || a.createdAt || ''));
  const openOpps = opportunities.filter(o => String(o.status || '').toLowerCase() === 'open').sort(sortByRecency);
  const deal = (openOpps[0] || opportunities.slice().sort(sortByRecency)[0]) || null;

  // ── Unified timeline (newest first) ───────────────────────────────────────
  const timeline = [];
  for (const c of conversations) {
    for (const m of c.messages) {
      timeline.push({
        ts: m.dateAdded, kind: 'message', channel: c.channel,
        direction: m.direction, title: `${c.channel} ${m.direction === 'inbound' ? 'received' : 'sent'}`,
        body: m.body, meta: { conversationId: c.id },
      });
    }
  }
  for (const n of notes) timeline.push({ ts: n.createdAt, kind: 'note', title: 'Note', body: n.body, meta: { userId: n.userId } });
  for (const a of appointments) timeline.push({ ts: a.startTime, kind: 'appointment', title: a.title, body: [a.status, a.address].filter(Boolean).join(' · '), meta: { status: a.status, notes: a.notes } });
  for (const t of tasks) timeline.push({ ts: t.dueDate || t.createdAt, kind: 'task', title: t.title, body: t.body, meta: { completed: t.completed } });
  for (const o of opportunities) timeline.push({ ts: o.lastStatusChange || o.createdAt, kind: 'stage_change', title: `${o.pipeline} → ${o.stage}`, body: [o.status, o.value ? '$' + Math.round(o.value).toLocaleString() : ''].filter(Boolean).join(' · '), meta: { oppId: o.id } });
  for (const e of estimates) {
    timeline.push({ ts: e.created_at, kind: 'estimate', title: `Estimate ${e.estimate_number || (e.id || '').slice(0, 8)}`, body: [estKind(e), e.proposal_mode].filter(Boolean).join(' · '), meta: { id: e.id, shareToken: e.share_token } });
    if (e.final_accepted_total != null && estKind(e) === 'signed') {
      timeline.push({ ts: e.closed_won_at || e.updated_at, kind: 'estimate_accepted', title: `Signed ${e.estimate_number || ''}`.trim(), body: '$' + Math.round(Number(e.final_accepted_total) || 0).toLocaleString(), meta: { id: e.id } });
    }
  }
  for (const w of (nativeJobs || [])) {
    timeline.push({ ts: w.start_date || w.created_at, kind: 'workorder', title: w.wo_number || 'Work Order', body: String(w.status || 'draft').replace(/_/g, ' '), meta: { id: w.id } });
    if (w.completed_at) timeline.push({ ts: w.completed_at, kind: 'workorder_done', title: `${w.wo_number || 'Work Order'} complete`, body: w.job_type ? String(w.job_type).replace(/_/g, ' ') : '', meta: { id: w.id } });
  }
  timeline.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0, tb = b.ts ? Date.parse(b.ts) : 0;
    return tb - ta;
  });

  // ── Merged customer header (native wins, GHL fills gaps) ───────────────────
  const merged = {
    id: customer?.id || null,
    ghl_contact_id: ghlContactId,
    full_name: customer?.full_name || ghlContact?.contactName || [ghlContact?.firstName, ghlContact?.lastName].filter(Boolean).join(' ') || 'Unnamed',
    email: customer?.email || ghlContact?.email || null,
    phone: customer?.phone || ghlContact?.phone || null,
    address: customer?.address || ghlContact?.address1 || null,
    city: customer?.city || ghlContact?.city || null,
    province: customer?.province || ghlContact?.state || null,
    created_at: customer?.created_at || ghlDateToIso(ghlContact?.dateAdded) || null,
    notes: customer?.notes || null,
    source: ghlContact?.source || customer?.source || null,
    tags: ghlContact?.tags || [],
    company: ghlContact?.companyName || null,
    dnd: ghlContact?.dnd || false,
  };

  return res.json({
    ok: true,
    customer: merged,
    stats: { ltv, jobCount, openCount: open.length, lastJobAt },
    deal,
    opportunities,
    estimates,
    workorders: nativeJobs || [],
    photos: photos || [],
    jobFolders: jobFolders || [],
    research, // talking points from the research worker (Vercel Blob), or null
    timeline,
    ghlResolvedBy: ghlMatch, // 'link' | 'phone' | 'email' | null — how the GHL contact was matched
    sources,
    generatedAt: new Date().toISOString(),
  });
}

export default requirePortalSessionAndTenant(handler);
