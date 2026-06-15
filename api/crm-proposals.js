// /api/crm-proposals — the joined, dated, scored dataset behind the CRM artifact (crm.html).
//
// Collapses Mac's "top 20 follow-up", "top 50 warm 360d", and "proposal activity"
// asks into ONE dataset: the full GHL book (contacts x opportunities = proposals/quotes)
// joined to Ryujin-native proposals (Supabase), scored for follow-up worthiness.
// The artifact runs all the filter presets client-side on this one payload.
//
// Read-only. Auth: any valid portal session OR the RYUJIN_SERVICE_TOKEN (server-to-server),
// same gate as /api/ghl. The deep drill-down (notes + conversation per contact) is NOT
// pulled here — it lazy-loads via /api/ghl?mode=contact-detail on bubble-expand, so this
// stays one bounded set of calls instead of ~1900 conversation fetches.
//
// No em dashes.

import { resolveSession } from '../lib/portalAuth.js';
import { ghlFetch, ghlDateToIso } from '../lib/ghl.js';
import { supabaseAdmin } from '../lib/supabase.js';

const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const MS_DAY = 86400000;

// Reps (GHL userId -> name), mirrors the map in api/ghl.js tasks mode.
const USER_NAMES = {
  'k3jdWA78r6EyiBEDDHd9': 'Mackenzie',
  'ri1tt8RZPuABuBwE8kmS': 'Darcy',
  '1hpihSwkZ5saFcNPXpMp': 'Diego'
};

// Rep attribution lives in TWO places, never the contact alone: the per-opportunity
// assignedTo (GHL userId), and the estimate `tags` array as `sales_owner:<name>`
// (the sales_owner COLUMN is null on most rows). Decode tags as the fallback.
function repFromTags(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    const m = /^sales_owner:(\w+)/i.exec(String(t || ''));
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (k.startsWith('mack')) return 'Mackenzie';
    if (k === 'darcy') return 'Darcy';
    if (k === 'diego') return 'Diego';
    return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  return null;
}

// Stage classification. We resolve stage NAMES live from /opportunities/pipelines
// (so a renamed stage never silently mis-scores), then bucket by name keywords.
// "sent" = a live quote/proposal is out and awaiting the customer = follow-up territory.
const SENT_STAGE_RE = /(quote sent|proposal sent|quote pending|quote ready|quote follow up|follow up \d|client responded|inspection booked|inspection completed|personal video sent)/i;
const DEAD_STAGE_RE = /(lost|dnd|unresponsive|not a fit|contract signed|deposit|paid|completed|invoice|job in progress|bundles|may not qualify|telemarketers)/i;
const RESPONDED_RE = /(client responded|inspection booked|inspection completed|quote ready)/i;

function norm(s) { return String(s || '').trim().toLowerCase(); }
function digits(s) { return String(s || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); }

function ageDays(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / MS_DAY));
}

// Pull all pages of a GHL search endpoint up to `cap`.
async function pageAll(path, baseParams, cap) {
  const out = [];
  let startAfter = null, startAfterId = null;
  while (out.length < cap) {
    const params = { ...baseParams, limit: String(Math.min(100, cap - out.length)) };
    if (startAfter) params.startAfter = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;
    let data;
    // lib/ghl.js ghlFetch takes params under a `query` key, not flat. Passing
    // the flat object dropped locationId entirely and GHL 400'd -> empty book.
    try { data = await ghlFetch(path, { query: params }); }
    catch (e) { break; }
    const key = path.includes('opportunities') ? 'opportunities' : 'contacts';
    const page = data[key] || [];
    if (!page.length) break;
    out.push(...page);
    startAfter = data.meta?.startAfter || null;
    startAfterId = data.meta?.startAfterId || null;
    if (!startAfter && !startAfterId) break;
    if (page.length < 100) break;
  }
  return out;
}

// Build the live pipelineId->name + stageId->name maps from GHL.
async function loadStageMaps() {
  const pipelines = {}, stages = {};
  try {
    const data = await ghlFetch('/opportunities/pipelines', { query: { locationId: LOCATION_ID } });
    for (const p of (data.pipelines || [])) {
      pipelines[p.id] = p.name;
      for (const s of (p.stages || [])) stages[s.id] = s.name;
    }
  } catch (e) { /* fall back to raw ids */ }
  return { pipelines, stages };
}

// C2 follow-up score. Higher = chase first. Pure function of the opp signals.
function scoreFollowup({ value, touchAge, stageName, responded, hasOpenTask }) {
  let score = 0;
  const reasons = [];
  // $ value: log-ish bands so a 20k job clearly outranks a 3k one without swamping age.
  if (value >= 18000) { score += 34; reasons.push('high value ($' + Math.round(value / 1000) + 'k)'); }
  else if (value >= 10000) { score += 26; reasons.push('strong value ($' + Math.round(value / 1000) + 'k)'); }
  else if (value >= 5000) { score += 16; reasons.push('mid value ($' + Math.round(value / 1000) + 'k)'); }
  else if (value > 0) { score += 8; }
  // age since last touch: 14-45d is the "gone quiet but not cold" sweet spot.
  if (touchAge == null) { score += 4; }
  else if (touchAge < 7) { score += 6; reasons.push('still fresh (' + touchAge + 'd)'); }
  else if (touchAge <= 45) { score += 30; reasons.push('quiet ' + touchAge + 'd, prime to nudge'); }
  else if (touchAge <= 90) { score += 16; reasons.push('cooling (' + touchAge + 'd)'); }
  else { score += 5; reasons.push('cold (' + touchAge + 'd)'); }
  // stage weight
  if (responded) { score += 22; reasons.push('client already responded'); }
  else if (/quote sent|proposal sent|quote ready/i.test(stageName)) { score += 18; reasons.push('quote is out'); }
  else if (/follow up/i.test(stageName)) { score += 8; }
  // no open task already = don't double-chase
  if (!hasOpenTask) { score += 8; } else { score -= 6; reasons.push('already has an open task'); }
  return { score, reasons };
}

// Voice-aligned DRAFT follow-up. Re-engagement register from voice-skill.md:
// "Hey [First]," + the specific quote/$ + open-both-doors close. No AI tells,
// no "circle back", no em dashes. DRAFT ONLY: Mac edits and sends himself.
function draftFollowup(c) {
  const first = (c.name || '').trim().split(/\s+/)[0] || 'there';
  const top = c.proposals.slice().sort((a, b) => (b.value || 0) - (a.value || 0))[0];
  const dollars = top && top.value ? ('$' + Number(top.value).toLocaleString('en-CA')) : 'the quote';
  const what = c.address ? ('the ' + c.address + ' roof') : 'your roof';
  const gap = c.lastTouchAgeDays != null ? (c.lastTouchAgeDays + ' days') : 'a little while';
  const body =
    'Hey ' + first + ', wanted to check in on the quote we sent for ' + what + ' (' + dollars + '). '
    + "It's been about " + gap + " so figured I'd see where your head's at. "
    + 'Happy to walk through any of it or adjust the scope if something felt off. '
    + 'Either way just let me know if you want to move ahead or if the timing is not right for now.\n\n'
    + '-Mackenzie';
  return {
    channel: 'sms_or_email',
    body,
    why: c.followupReasons.join(' · '),
    readForcingQuestion: 'Send to ' + (c.name || 'this contact') + ' about ' + dollars + '? Adjust the quote reference or the scope line before it goes.',
    draftOnly: true
  };
}

// Best-effort Supabase native-proposal pull (enrichment, not core). Wrapped so a
// schema drift degrades to GHL-only instead of 500ing the whole artifact.
async function loadNativeProposals(tenantId) {
  const out = [];
  try {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500);
    for (const e of (data || [])) {
      const email = norm(e.customer_email || e.email || e.client_email);
      const phone = digits(e.customer_phone || e.phone || e.client_phone);
      const name = e.customer_name || e.client_name || e.name || null;
      const value = Number(e.total || e.grand_total || e.amount || e.price || 0) || 0;
      out.push({
        id: 'ryujin:' + e.id,
        label: name || ('Estimate ' + e.id),
        value,
        status: e.status || 'sent',
        stage: e.status || 'Ryujin estimate',
        date: e.created_at || e.issued_date || null,
        source: 'ryujin',
        shareUrl: '/api/proposal?id=' + encodeURIComponent(e.id),
        _email: email, _phone: phone, _name: norm(name), _tags: e.tags || []
      });
    }
  } catch (e) { /* estimates shape unknown; skip */ }
  try {
    const { data } = await supabaseAdmin
      .from('custom_proposals')
      .select('id, slug, title, client_name, client_email, total, status, issued_date, tenant_id')
      .eq('tenant_id', tenantId)
      .order('issued_date', { ascending: false })
      .limit(200);
    for (const p of (data || [])) {
      out.push({
        id: 'ryujin:cp:' + p.id,
        label: p.title || p.client_name || ('Proposal ' + p.slug),
        value: Number(p.total || 0) || 0,
        status: p.status || 'sent',
        stage: p.status || 'Ryujin proposal',
        date: p.issued_date || null,
        source: 'ryujin',
        shareUrl: '/p/' + p.slug,
        _email: norm(p.client_email), _phone: '', _name: norm(p.client_name)
      });
    }
  } catch (e) { /* custom_proposals optional */ }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. GET only.' });
  }
  const session = await resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  const tenantId = session.tenant_id || null;

  try {
    const [opps, contacts, maps, native, tasksData] = await Promise.all([
      pageAll('/opportunities/search', { location_id: LOCATION_ID }, 1000),
      pageAll('/contacts/', { locationId: LOCATION_ID }, 2000),
      loadStageMaps(),
      tenantId ? loadNativeProposals(tenantId) : Promise.resolve([]),
      ghlFetch(`/locations/${LOCATION_ID}/tasks`, { query: { isLocation: 'true' } }).catch(() => ({ tasks: [] }))
    ]);

    // Contacts with an OPEN task (skip double-chasing).
    const openTaskContacts = new Set(
      (tasksData.tasks || []).filter(t => !t.completed).map(t => t.contactId).filter(Boolean)
    );

    // Index contacts by email + phone for opp matching.
    const byEmail = new Map(), byPhone = new Map(), byId = new Map();
    const customers = new Map(); // key -> customer record
    function customerFromContact(c) {
      const key = 'c:' + c.id;
      if (customers.has(key)) return customers.get(key);
      const rec = {
        id: c.id, key,
        name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown',
        email: c.email || null, phone: c.phone || null,
        address: c.address1 || null, city: c.city || null,
        source: c.source || null, dnd: c.dnd || false,
        rep: USER_NAMES[c.assignedTo] || repFromTags(c.tags) || null,
        tags: c.tags || [],
        stage: null, pipeline: null,
        lastTouchAt: c.lastActivity || c.dateAdded || null,
        proposals: [], oppCount: 0, totalProposalValue: 0,
        followupScore: 0, followupReasons: [], isTop20: false, isWarm360: false,
        activity7d: false, activity24h: false, draftFollowup: null,
        hasOpenTask: openTaskContacts.has(c.id)
      };
      customers.set(key, rec);
      return rec;
    }
    for (const c of contacts) {
      byId.set(c.id, c);
      if (c.email) byEmail.set(norm(c.email), c);
      if (c.phone) byPhone.set(digits(c.phone), c);
    }

    // Attach each opportunity (= a proposal/quote in the pipeline) to its contact.
    for (const o of opps) {
      const stageName = maps.stages[o.pipelineStageId] || o.pipelineStageId || '';
      const pipeName = maps.pipelines[o.pipelineId] || o.pipelineId || '';
      const value = Number(o.monetaryValue || 0) || 0;
      const touchIso = ghlDateToIso(o.lastStatusChangeAt) || o.lastStatusChangeAt || o.updatedAt || o.createdAt || null;
      let contact = (o.contactId && byId.get(o.contactId))
        || (o.email && byEmail.get(norm(o.email)))
        || (o.phone && byPhone.get(digits(o.phone)))
        || null;
      let rec;
      if (contact) {
        rec = customerFromContact(contact);
        // The owner lives on the opportunity, not the contact. Fill rep from the
        // opp's assignedTo when the contact did not carry one (the common case).
        if (!rec.rep) rec.rep = USER_NAMES[o.assignedTo] || null;
      }
      else {
        // Orphan opp: synthesize a customer so nothing is lost.
        const key = 'o:' + (norm(o.email) || digits(o.phone) || o.id);
        rec = customers.get(key) || {
          id: o.id, key, name: o.name || 'Unknown', email: o.email || null, phone: o.phone || null,
          address: null, city: null, source: o.source || null, dnd: false,
          rep: USER_NAMES[o.assignedTo] || null, tags: [], stage: null, pipeline: null,
          lastTouchAt: touchIso, proposals: [], oppCount: 0, totalProposalValue: 0,
          followupScore: 0, followupReasons: [], isTop20: false, isWarm360: false,
          activity7d: false, activity24h: false, draftFollowup: null, hasOpenTask: false
        };
        customers.set(key, rec);
      }
      rec.proposals.push({
        id: 'ghl:' + o.id, label: o.name || rec.name, value,
        status: o.status || 'open', stage: stageName, pipeline: pipeName,
        date: ghlDateToIso(o.createdAt) || o.createdAt || null, source: 'ghl'
      });
      rec.oppCount += 1;
      rec.totalProposalValue += value;
      // The most advanced/recent opp drives the customer's headline stage.
      if (!rec.stage || (touchIso && rec.lastTouchAt && touchIso > rec.lastTouchAt)) {
        rec.stage = stageName; rec.pipeline = pipeName; rec.lastTouchAt = touchIso || rec.lastTouchAt;
      }
      const a = ageDays(touchIso);
      if (a != null && a <= 7) rec.activity7d = true;
      if (a != null && a <= 1) rec.activity24h = true;
    }

    // Fold native proposals onto matching customers (or create a record).
    for (const np of native) {
      let rec = (np._email && byEmail.get(np._email) && customerFromContact(byEmail.get(np._email)))
        || [...customers.values()].find(r => np._email && norm(r.email) === np._email)
        || null;
      if (!rec) {
        const key = 'r:' + (np._email || np._name || np.id);
        rec = customers.get(key) || {
          id: np.id, key, name: np.label, email: np._email || null, phone: null, address: null, city: null,
          source: 'ryujin', dnd: false, rep: repFromTags(np._tags) || null, tags: np._tags || [], stage: 'Ryujin proposal', pipeline: 'Ryujin',
          lastTouchAt: np.date, proposals: [], oppCount: 0, totalProposalValue: 0,
          followupScore: 0, followupReasons: [], isTop20: false, isWarm360: false,
          activity7d: false, activity24h: false, draftFollowup: null, hasOpenTask: false
        };
        customers.set(key, rec);
      }
      // Estimate tags are an owner source too; fill rep if GHL did not set one.
      if (!rec.rep) rec.rep = repFromTags(np._tags) || null;
      rec.proposals.push({ id: np.id, label: np.label, value: np.value, status: np.status, stage: np.stage, date: np.date, source: 'ryujin', shareUrl: np.shareUrl });
      rec.totalProposalValue += np.value || 0;
    }

    // Score every customer + flag warm-360 + finalize.
    const all = [...customers.values()];
    for (const rec of all) {
      rec.lastTouchAgeDays = ageDays(rec.lastTouchAt);
      const stageName = rec.stage || '';
      const responded = RESPONDED_RE.test(stageName);
      const isDead = DEAD_STAGE_RE.test(stageName) || /won|lost|abandoned/i.test(rec.proposals.map(p => p.status).join(' '));
      const isSent = SENT_STAGE_RE.test(stageName);
      const best = rec.proposals.reduce((m, p) => Math.max(m, p.value || 0), 0);
      // C3 warm-360: got a proposal in last 360d, has value, not explicitly dead.
      rec.isWarm360 = !rec.dnd && !isDead && best > 0 && rec.lastTouchAgeDays != null && rec.lastTouchAgeDays <= 360;
      // C2 follow-up candidacy: live sent quote, open, not dead, this year-ish.
      if (isSent && !isDead && !rec.dnd && rec.lastTouchAgeDays != null && rec.lastTouchAgeDays <= 200) {
        const { score, reasons } = scoreFollowup({ value: best, touchAge: rec.lastTouchAgeDays, stageName, responded, hasOpenTask: rec.hasOpenTask });
        rec.followupScore = score; rec.followupReasons = reasons;
      }
    }

    // Rank top-20 follow-up candidates + draft a voice-aligned follow-up for each.
    const ranked = all.filter(r => r.followupScore > 0).sort((a, b) => b.followupScore - a.followupScore);
    ranked.slice(0, 20).forEach(r => { r.isTop20 = true; r.draftFollowup = draftFollowup(r); });

    // Strip internal join keys before sending.
    const customersOut = all.map(({ key, hasOpenTask, ...rest }) => rest)
      .sort((a, b) => (b.totalProposalValue || 0) - (a.totalProposalValue || 0));

    return res.json({
      generatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      counts: {
        customers: customersOut.length,
        withProposals: customersOut.filter(c => c.proposals.length).length,
        opportunities: opps.length,
        contacts: contacts.length,
        nativeProposals: native.length,
        top20: ranked.slice(0, 20).length,
        warm50: customersOut.filter(c => c.isWarm360).length,
        activity7d: customersOut.filter(c => c.activity7d).length,
        activity24h: customersOut.filter(c => c.activity24h).length
      },
      customers: customersOut
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, timestamp: new Date().toISOString() });
  }
}
