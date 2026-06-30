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

function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Normalize a street address for dedup: lowercase, collapse whitespace, drop
// punctuation, and fold common street-type spellings (Drive/Dr, Street/St, ...)
// so "125 Kelly Dr" and "125 Kelly Drive" collapse to the same key.
const STREET_TYPES = [
  [/\b(drive|dr)\b/g, 'dr'],
  [/\b(street|st)\b/g, 'st'],
  [/\b(avenue|ave|av)\b/g, 'ave'],
  [/\b(road|rd)\b/g, 'rd'],
  [/\b(court|crt|ct)\b/g, 'ct'],
  [/\b(crescent|cres)\b/g, 'cres'],
  [/\b(boulevard|blvd|blv)\b/g, 'blvd'],
  [/\b(route|rte|rt)\b/g, 'rte'],
  [/\b(lane|ln)\b/g, 'ln'],
  [/\b(place|pl)\b/g, 'pl']
];
function addrKey(addr) {
  let s = norm(addr).replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, rep] of STREET_TYPES) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

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

// One normalized lifecycle bucket per row so the UI can default to "pending"
// (everything still in front of Mac) and tuck closed / dead behind a toggle.
// "accepted" stays pending on purpose: a signed proposal still awaiting work
// (200 Lonsdale: signed, needs color + neighbor add-on) is exactly what Mac
// asked to keep visible.
function bucketFor(statusText) {
  const s = norm(statusText);
  if (/(lost|declined|rejected|cancelled|abandon|dnd|unresponsive|not a fit|junk|telemarketer|dead|expired|archived)/.test(s)) return 'dead';
  if (/(complete|completed|paid|invoiced|in progress|in-progress|job in progress)/.test(s)) return 'closed';
  if (/(accept|signed|deposit|contract signed|won)/.test(s)) return 'accepted';
  if (/(published|sent|viewed|client responded|video sent|inspection completed)/.test(s)) return 'sent';
  if (/(ready|proposal ready)/.test(s)) return 'ready';
  return 'draft';
}
const PENDING_BUCKETS = new Set(['draft', 'ready', 'sent', 'accepted']);

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
  const estIdRows = []; // [{id, row}] so we can attach activity_log opens after the fetch
  try {
    const { data, error } = await supabaseAdmin
      .from('estimates')
      .select('id, estimate_number, share_token, status, proposal_mode, calculated_packages, created_at, updated_at, customer:customers(full_name, address, city)')
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
      const row = {
        store: 'Ryujin-native',
        customer: name,
        address,
        fromPrice: num(fromPrice) || null,
        status: e.status || 'draft',
        bucket: bucketFor(e.status),
        lastUpdated: e.updated_at || e.created_at || null,
        openUrl: e.share_token ? ('/proposal-client.html?share=' + encodeURIComponent(e.share_token)) : null,
        ref: 'NP-' + (e.estimate_number || e.share_token),
        shareToken: e.share_token || null,
        views: 0,
        lastViewedAt: null,
        _nameKey: norm(name), _addrKey: addrKey(address)
      };
      out.push(row);
      if (e.id) estIdRows.push({ id: e.id, row });
    }
  } catch (e) { err = 'native(estimates): ' + e.message; }

  // Canonical customer link: prefer the v2 /p/<slug> page when a materialized
  // instance exists. Overwrites the legacy v1 openUrl set above. Best-effort.
  if (estIdRows.length) {
    try {
      const byId = new Map(estIdRows.map(x => [x.id, x.row]));
      const { data: insts } = await supabaseAdmin
        .from('proposal_instances')
        .select('estimate_id, slug, created_at')
        .in('estimate_id', estIdRows.map(x => x.id))
        .order('created_at', { ascending: false });
      const seen = new Set();
      for (const i of (insts || [])) {
        if (!i.estimate_id || !i.slug || seen.has(i.estimate_id)) continue;
        seen.add(i.estimate_id);
        const row = byId.get(i.estimate_id);
        if (row) row.openUrl = '/p/' + i.slug;
      }
    } catch (e) { /* keep legacy openUrl on failure */ }
  }

  // Open-tracking lives in activity_log (one row per proposal_opened event keyed by
  // entity_id = estimate id), NOT on the estimates table. One grouped read attaches
  // a view count + last-viewed time per native estimate. View events come under
  // MULTIPLE action names: proposal_viewed (the main page-view), proposal_opened,
  // envelope_opened. Match both 'viewed' and 'opened' so we do not undercount or
  // report a stale last-seen (matching only '%opened%' missed proposal_viewed and
  // made recently-active proposals look quiet). beacon_selftest / pdf / video / tier
  // do not contain those substrings, so a lone self-test stays 0 views. Best-effort:
  // a failure here must never regress the proposal list, so it is fully isolated.
  if (estIdRows.length) {
    try {
      const byId = new Map(estIdRows.map(x => [x.id, x.row]));
      const { data: ev } = await supabaseAdmin
        .from('activity_log')
        .select('entity_id, action, created_at')
        .in('entity_id', estIdRows.map(x => x.id))
        .or('action.ilike.*opened*,action.ilike.*viewed*')
        .limit(8000);
      for (const a of (ev || [])) {
        const row = byId.get(a.entity_id);
        if (!row) continue;
        row.views += 1;
        if (!row.lastViewedAt || (a.created_at && a.created_at > row.lastViewedAt)) row.lastViewedAt = a.created_at;
      }
    } catch (e) { /* opens are a bonus; never break the index */ }
  }

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

// Merge rows that are the same physical proposal across stores into one entry.
const BUCKET_RANK = { dead: 0, draft: 1, ready: 2, sent: 3, accepted: 4, closed: 5 };
function mergeRows(group) {
  const stores = [...new Set(group.map(r => r.store))];
  let best = group[0];
  for (const r of group) if ((BUCKET_RANK[r.bucket] ?? 1) > (BUCKET_RANK[best.bucket] ?? 1)) best = r;
  const prices = group.map(r => num(r.fromPrice)).filter(Boolean);
  const fromPrice = prices.length ? Math.max(...prices) : null;
  const withLink = group.find(r => r.openUrl);
  const withAddr = group.find(r => r.address);
  const lastUpdated = group.map(r => r.lastUpdated).filter(Boolean).sort().slice(-1)[0] || null;
  const pending = PENDING_BUCKETS.has(best.bucket);
  // Engagement (open-tracking) lives on Ryujin-native estimate rows only; aggregate
  // across the group so a multi-source dedupe keeps the highest open count + most
  // recent view. Estimator OS / GHL rows contribute nothing here (no tracking).
  const views = Math.max(0, ...group.map(r => num(r.views)));
  const lastViewedAt = group.map(r => r.lastViewedAt).filter(Boolean).sort().slice(-1)[0] || null;
  const shareToken = (group.find(r => r.shareToken) || {}).shareToken || null;
  // Follow-up signal: how long this pending quote has sat untouched, plus a
  // value-weighted urgency score so the warm book can be worked highest-dollar
  // x most-stale first. The default sort buries stale quotes (most-recent-first);
  // ?sort=followup surfaces them. A pending quote 30+ days untouched is `stale`.
  const daysSinceUpdate = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 86400000))
    : null;
  const stale = pending && daysSinceUpdate != null && daysSinceUpdate >= 30;
  const followUpScore = pending ? Math.round((fromPrice || 0) * (daysSinceUpdate || 0)) : 0;
  return {
    customer: (withAddr || best).customer,
    address: (withAddr || best).address || '',
    fromPrice,
    noPrice: !fromPrice,
    status: best.status,
    bucket: best.bucket,
    pending,
    lastUpdated,
    daysSinceUpdate,
    stale,
    followUpScore,
    stores,
    openUrl: withLink ? withLink.openUrl : null,
    views,
    lastViewedAt,
    shareToken,
    sources: group.map(r => ({ store: r.store, ref: r.ref, status: r.status, fromPrice: r.fromPrice, openUrl: r.openUrl }))
  };
}

function dedupe(rows) {
  const byName = new Map();
  for (const r of rows) {
    const k = r._nameKey || ('__' + r.store + (r.ref || ''));
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  const out = [];
  for (const group of byName.values()) {
    const withAddr = group.filter(r => r._addrKey);
    const noAddr = group.filter(r => !r._addrKey);
    const addrGroups = new Map();
    for (const r of withAddr) {
      if (!addrGroups.has(r._addrKey)) addrGroups.set(r._addrKey, []);
      addrGroups.get(r._addrKey).push(r);
    }
    // A no-address row (often a GHL opp or native proposal) folds into the only
    // addressed deal for that customer; if the customer has multiple distinct
    // addresses we cannot guess, so it stands on its own.
    if (addrGroups.size === 1 && noAddr.length) {
      [...addrGroups.values()][0].push(...noAddr);
      noAddr.length = 0;
    }
    for (const g of addrGroups.values()) out.push(mergeRows(g));
    for (const r of noAddr) out.push(mergeRows([r]));
  }
  return out;
}

// Short-TTL in-memory cache of the expensive join (3-store fetch + dedupe). A warm
// serverless instance reuses module scope, so repeat loads + proposals.html polling
// within the TTL skip the ~7s GHL-contacts paging + Estimator cold start. The book
// is a read-only review surface (not transactional), so a 60s stale window is fine.
const _idxCache = new Map();
const IDX_TTL = 60000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. GET only.' });
  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  const tenantId = session.tenant_id || null;

  try {
    // Expensive part (3-store fetch + dedupe + counts) is cached per tenant for
    // IDX_TTL; the sort is cheap and varies by ?sort so it runs per request.
    const cacheKey = tenantId || '__default';
    let entry = _idxCache.get(cacheKey);
    if (!entry || (Date.now() - entry.at) >= IDX_TTL) {
      const [est, native, ghl] = await Promise.all([loadEstimatorOS(), loadNative(tenantId), loadGHL()]);
      const errors = [est.error, native.error, ghl.error].filter(Boolean);
      const raw = [...est.rows, ...native.rows, ...ghl.rows];
      const merged = dedupe(raw);
      const counts = { total: merged.length, pending: 0, byBucket: {}, byStore: { 'Estimator OS': est.rows.length, 'Ryujin-native': native.rows.length, 'GHL': ghl.rows.length }, noPrice: 0, stale: 0, staleValue: 0 };
      for (const m of merged) {
        counts.byBucket[m.bucket] = (counts.byBucket[m.bucket] || 0) + 1;
        if (m.pending) counts.pending++;
        if (m.noPrice) counts.noPrice++;
        if (m.stale) { counts.stale++; counts.staleValue += num(m.fromPrice); }
      }
      entry = { at: Date.now(), merged, counts, errors };
      _idxCache.set(cacheKey, entry);
    }

    // Default sort: pending first, then most-recently-updated, then no-price
    // stubs sink within their bucket so the actionable rows lead.
    // ?sort=followup = the warm-book work queue: stale + high-value pending
    // quotes lead (followUpScore desc). Sort a COPY so the cached array is never
    // mutated under a concurrent request.
    const sortMode = String(req.query?.sort || '').toLowerCase();
    const proposals = entry.merged.slice();
    if (sortMode === 'followup') {
      proposals.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending ? -1 : 1;
        return (b.followUpScore || 0) - (a.followUpScore || 0);
      });
    } else {
      proposals.sort((a, b) => {
        if (a.pending !== b.pending) return a.pending ? -1 : 1;
        const at = a.lastUpdated || '', bt = b.lastUpdated || '';
        return bt.localeCompare(at);
      });
    }

    return res.json({
      ok: true,
      counts: entry.counts,
      proposals,
      sourceErrors: entry.errors,
      generatedAt: new Date(entry.at).toISOString(),
      cachedAgeMs: Date.now() - entry.at
    });
  } catch (e) {
    return res.status(500).json({ error: 'proposals_index_failed', message: e.message });
  }
}
