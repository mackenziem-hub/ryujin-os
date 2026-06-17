// api/proposals-index.js - the unified proposal index behind proposals.html.
//
// Joins every pending proposal from all THREE stores into ONE deduped list so
// Mac can review his whole proposal book on a single surface:
//   1. Estimator OS (Replit app /api/estimates, x-api-key)        store: "Estimator OS"
//   2. Ryujin-native custom_proposals (Supabase)                  store: "Ryujin-native"
//   3. GHL pipeline opportunities (+ contacts for address)        store: "GHL"
//
// Same data-join shape as /api/crm-proposals (PR #496): GHL opps paged, contacts
// mapped for address, native pulled best-effort, all normalized to one row shape
// then deduped by customer + normalized-address. Read-only. No writes, no sends.
//
// Auth: any valid portal session OR the RYUJIN_SERVICE_TOKEN (server-to-server),
// the same gate as /api/ghl and /api/crm-proposals.
//
// No em dashes.

import { resolveSession } from '../lib/portalAuth.js';
import { ghlFetch } from '../lib/ghl.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getManualProposals } from '../lib/manualProposals.js';
import { norm, num, addrKey, bucketFor, PENDING_BUCKETS, dedupe } from '../lib/proposalsDedupe.js';

const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const ESTIMATOR_URL = 'https://estimator-os.replit.app/api/estimates';
const ESTIMATOR_KEY = (process.env.ESTIMATOR_KEY || process.env.ESTIMATOR_OS_KEY || 'pu-estimator-2026').trim();

// Test / demo records that must never show in the proposal book. Mirrors the
// pattern filter in api/crm-proposals.js. Matches on name + email tells only.
const TEST_NAME_RE = /\btest(er)?\b|cat ?(test|livetest)|catherine test|june tester|fire smoke|smoke test|john doe/i;
const TEST_EMAIL_RE = /@example\.com$|^testfire@|^catdummy123@|catherinezeta|@test\./i;
function isTestRecord(name, email) {
  if (TEST_NAME_RE.test(String(name || ''))) return true;
  if (TEST_EMAIL_RE.test(String(email || ''))) return true;
  return false;
}

// norm / num / addrKey live in lib/proposalsDedupe.js (pure, dependency-free,
// unit-tested) and are imported above.

// Lowest live "from" price across the Estimator OS package tiers. The pricing
// object carries gold / platinum / diamond / economy each with a sellingPrice;
// the cheapest sellable tier is the headline "from" number.
function estimatorFromPrice(e) {
  if (num(e.finalAcceptedTotal)) return num(e.finalAcceptedTotal);
  const p = e.pricing || {};
  let lo = 0;
  for (const tier of ['economy', 'gold', 'platinum', 'diamond']) {
    const sp = num(p[tier] && p[tier].sellingPrice);
    if (sp && (!lo || sp < lo)) lo = sp;
  }
  return lo || null;
}

// bucketFor / PENDING_BUCKETS live in lib/proposalsDedupe.js and are imported above.

// ── Store 1: Estimator OS (Replit) ──────────────────────────────────────────
async function loadEstimatorOS() {
  const out = [];
  try {
    const r = await fetch(ESTIMATOR_URL, { headers: { 'x-api-key': ESTIMATOR_KEY }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return { rows: out, error: 'Estimator OS HTTP ' + r.status };
    const data = await r.json();
    const arr = Array.isArray(data) ? data : (data.estimates || data.data || []);
    for (const e of arr) {
      const c = e.customer || {};
      const name = c.fullName || c.full_name || c.name || null;
      if (isTestRecord(name, c.email)) continue;
      const statusText = e.proposalStatus || e.jobStatus || 'Draft';
      const fromPrice = estimatorFromPrice(e);
      out.push({
        store: 'Estimator OS',
        customer: name || '(no name)',
        address: [c.address, c.city].filter(Boolean).join(', '),
        fromPrice,
        status: statusText,
        bucket: bucketFor(e.jobStatus || e.proposalStatus),
        lastUpdated: e.updatedAt || e.createdAt || null,
        openUrl: e.proposalUrl || e.proposalPdfUrl || null,
        ref: 'EST-' + e.id,
        _nameKey: norm(name), _addrKey: addrKey([c.address, c.city].filter(Boolean).join(' '))
      });
    }
    return { rows: out };
  } catch (e) {
    return { rows: out, error: 'Estimator OS: ' + e.message };
  }
}

// ── Store 2: Ryujin-native proposals (Supabase) ──────────────────────────────
// The real native proposal book lives in the `estimates` table (each row carries
// a share_token + /proposal-client.html link), the SAME source the snapshot
// nativeProposalStats() reads. An earlier cut read `custom_proposals`, which holds
// a single legacy row, so the index under-counted native proposals 20-to-1. We now
// read estimates (primary) and UNION the one legacy custom_proposals row so nothing
// is lost; dedupe() collapses any overlap by customer + address. Filtered by the
// session tenant for isolation (proven: the custom_proposals read on the same
// tenant_id returns this tenant's rows). limit 300 = the whole book, not the
// snapshot's recent-20 cap.
async function loadNative(tenantId) {
  const out = [];
  if (!tenantId) return { rows: out };
  let err = null;

  // PRIMARY: estimates with a share_token (mirrors nativeProposalStats select).
  // Test filter is name-only on purpose: the customers embed does not select
  // email (matching the proven snapshot query), so adding it risks a column
  // error that would regress native to zero. The name patterns catch test rows.
  try {
    const { data, error } = await supabaseAdmin
      .from('estimates')
      .select('estimate_number, share_token, status, proposal_mode, calculated_packages, created_at, updated_at, customer:customers(full_name, address, city)')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .order('updated_at', { ascending: false })
      .limit(300);
    if (error) err = 'native(estimates): ' + error.message;
    for (const e of (data || [])) {
      const cust = e.customer || {};
      const name = cust.full_name || ('Proposal ' + (e.estimate_number || e.share_token));
      if (isTestRecord(name)) continue;
      const cp = e.calculated_packages || {};
      const tier = cp.gold || cp.platinum || cp.diamond || null;
      const fromPrice = tier ? (tier.total ?? tier.summary?.sellingPrice ?? null) : null;
      const address = [cust.address, cust.city].filter(Boolean).join(', ');
      out.push({
        store: 'Ryujin-native',
        customer: name,
        address,
        fromPrice: num(fromPrice) || null,
        status: e.status || 'draft',
        bucket: bucketFor(e.status),
        lastUpdated: e.updated_at || e.created_at || null,
        openUrl: e.share_token ? ('/proposal-client.html?share=' + encodeURIComponent(e.share_token)) : null,
        ref: 'NP-' + (e.estimate_number || e.share_token),
        _nameKey: norm(name), _addrKey: addrKey(address)
      });
    }
  } catch (e) { err = 'native(estimates): ' + e.message; }

  // UNION: keep the single legacy custom_proposals row (NP-330) so nothing is lost.
  try {
    const { data } = await supabaseAdmin
      .from('custom_proposals')
      .select('id, slug, customer_name, customer_email, address, total_incl_hst, status, issued_date, updated_at, tenant_id')
      .eq('tenant_id', tenantId)
      .order('issued_date', { ascending: false })
      .limit(300);
    for (const p of (data || [])) {
      const name = p.customer_name || ('Proposal ' + (p.slug || p.id));
      if (isTestRecord(name, p.customer_email)) continue;
      out.push({
        store: 'Ryujin-native',
        customer: name,
        address: p.address || '',
        fromPrice: num(p.total_incl_hst) || null,
        status: p.status || 'draft',
        bucket: bucketFor(p.status),
        lastUpdated: p.updated_at || p.issued_date || null,
        openUrl: p.slug ? '/p/' + p.slug : null,
        ref: 'NP-' + (p.slug || p.id),
        _nameKey: norm(name), _addrKey: addrKey(p.address)
      });
    }
  } catch (e) { /* legacy custom_proposals optional */ }

  return err ? { rows: out, error: err } : { rows: out };
}

// ── Store 3: GHL pipeline opportunities (+ contacts for address) ─────────────
async function pageAll(path, baseParams, cap) {
  const out = [];
  let startAfter = null, startAfterId = null;
  while (out.length < cap) {
    const params = { ...baseParams, limit: String(Math.min(100, cap - out.length)) };
    if (startAfter) params.startAfter = startAfter;
    if (startAfterId) params.startAfterId = startAfterId;
    let data;
    // lib/ghl.js ghlFetch takes params under a `query` key, not flat. Passing
    // the flat object drops locationId entirely and GHL 400s into an empty book.
    try { data = await ghlFetch(path, { query: params }); } catch (e) { break; }
    const page = (path.includes('opportunities') ? data.opportunities : data.contacts) || [];
    if (!page.length) break;
    out.push(...page);
    startAfter = data.meta?.startAfter || null;
    startAfterId = data.meta?.startAfterId || null;
    if (!startAfter && !startAfterId) break;
    if (page.length < 100) break;
  }
  return out;
}

// Resolve opaque pipelineStageId -> human stage name so GHL rows bucket the same
// way (quote sent -> sent, signed -> accepted). Mirrors api/crm-proposals.js.
async function loadStageMaps() {
  const stages = {};
  try {
    const data = await ghlFetch('/opportunities/pipelines', { query: { locationId: LOCATION_ID } });
    for (const p of (data.pipelines || [])) for (const s of (p.stages || [])) stages[s.id] = s.name;
  } catch (e) { /* fall back to raw status */ }
  return stages;
}

async function loadGHL() {
  const out = [];
  try {
    const [opps, contacts, stageMap] = await Promise.all([
      pageAll('/opportunities/search', { location_id: LOCATION_ID }, 600),
      pageAll('/contacts/', { locationId: LOCATION_ID }, 2000),
      loadStageMaps()
    ]);
    const addrByContact = new Map();
    for (const c of contacts) {
      const a = [c.address1 || c.address, c.city].filter(Boolean).join(', ');
      if (c.id) addrByContact.set(c.id, { addr: a, name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') });
    }
    for (const o of opps) {
      const status = norm(o.status);
      if (status === 'lost' || status === 'abandoned') continue;
      const stageName = stageMap[o.pipelineStageId] || o.status || '';
      const bucket = bucketFor(o.status === 'won' ? 'signed' : stageName);
      if (bucket === 'dead') continue;
      const value = num(o.monetaryValue);
      // Keep real quotes (carry a dollar value) + anything in a sent/ready/accepted
      // stage + signed deals. Drop raw valueless leads so the book stays a proposal
      // book, not the whole CRM. Signed orphans (200 Lonsdale) survive on value+stage.
      if (!value && !['ready', 'sent', 'accepted'].includes(bucket)) continue;
      const ci = addrByContact.get(o.contactId) || {};
      const name = o.name || ci.name || '(no name)';
      if (isTestRecord(name, o.email)) continue;
      const address = ci.addr || '';
      out.push({
        store: 'GHL',
        customer: name,
        address,
        fromPrice: value || null,
        status: o.status === 'won' ? 'Signed' : (stageName || o.status || 'open'),
        bucket,
        lastUpdated: o.lastStatusChangeAt || o.updatedAt || o.createdAt || null,
        openUrl: null,
        ref: 'GHL-' + String(o.id || '').slice(0, 8),
        _nameKey: norm(name), _addrKey: addrKey(address)
      });
    }
    return { rows: out };
  } catch (e) {
    return { rows: out, error: 'GHL: ' + e.message };
  }
}

// ── Store 4: Manual entries (committed source) ───────────────────────────────
// Signed deals that never landed in any of the three live stores in a reviewable
// shape (200 Lonsdale: signed + complete, only a stuck native "sent" row + a
// local PDF). Read from lib/manualProposals.js so a known deal renders in the
// unified book. Each row carries _addrKey, so dedupe folds it onto the matching
// store row and the manual "Signed" bucket wins the merge via BUCKET_RANK.
function loadManual(tenantId) {
  const out = [];
  for (const m of getManualProposals(tenantId)) {
    if (isTestRecord(m.customer)) continue;
    out.push({
      store: 'manual',
      customer: m.customer || '(no name)',
      address: m.address || '',
      fromPrice: num(m.fromPrice) || null,
      status: m.status || 'Signed',
      bucket: bucketFor(m.status || 'signed'),
      lastUpdated: m.lastUpdated || null,
      openUrl: m.openUrl || null,
      ref: m.ref || ('MAN-' + norm(m.address || m.customer)),
      _nameKey: norm(m.customer), _addrKey: addrKey(m.address)
    });
  }
  return { rows: out };
}

// mergeRows / dedupe (ADDRESS-FIRST cross-store merge, including the PR #516
// follow-up staleness fields) live in lib/proposalsDedupe.js and are imported
// above.

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. GET only.' });
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  const tenantId = session.tenant_id || null;

  try {
    const [est, native, ghl] = await Promise.all([loadEstimatorOS(), loadNative(tenantId), loadGHL()]);
    const manual = loadManual(tenantId);
    const errors = [est.error, native.error, ghl.error, manual.error].filter(Boolean);
    const raw = [...est.rows, ...native.rows, ...ghl.rows, ...manual.rows];
    const merged = dedupe(raw);

    // Default sort: pending first, then most-recently-updated, then no-price
    // stubs sink within their bucket so the actionable rows lead.
    // ?sort=followup = the warm-book work queue: stale + high-value pending
    // quotes lead (followUpScore desc) so the book Mac should chase is on top
    // instead of buried at the bottom. Non-pending rows still sink.
    const sortMode = String(req.query?.sort || '').toLowerCase();
    if (sortMode === 'followup') {
      merged.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending ? -1 : 1;
        return (b.followUpScore || 0) - (a.followUpScore || 0);
      });
    } else {
      merged.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending ? -1 : 1;
        const at = a.lastUpdated || '', bt = b.lastUpdated || '';
        return bt.localeCompare(at);
      });
    }

    const counts = { total: merged.length, pending: 0, byBucket: {}, byStore: { 'Estimator OS': est.rows.length, 'Ryujin-native': native.rows.length, 'GHL': ghl.rows.length, 'manual': manual.rows.length }, noPrice: 0, stale: 0, staleValue: 0 };
    for (const m of merged) {
      counts.byBucket[m.bucket] = (counts.byBucket[m.bucket] || 0) + 1;
      if (m.pending) counts.pending++;
      if (m.noPrice) counts.noPrice++;
      if (m.stale) { counts.stale++; counts.staleValue += num(m.fromPrice); }
    }

    return res.json({
      ok: true,
      counts,
      proposals: merged,
      sourceErrors: errors,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ error: 'proposals_index_failed', message: e.message });
  }
}
