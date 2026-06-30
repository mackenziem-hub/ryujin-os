// ═══════════════════════════════════════════════════════════════
// RYUJIN SNAPSHOT — Central data cache for all agent intelligence
// GET  /api/snapshot — Read the current snapshot
// POST /api/snapshot — Update snapshot (called by agents after runs)
// PUT  /api/snapshot — Force full refresh
// Storage: Vercel Blob (deterministic URL, no Replit round-trip)
// ═══════════════════════════════════════════════════════════════

import { put, list, del } from '@vercel/blob';
import { supabaseAdmin } from '../lib/supabase.js';
import { computeMetrics } from '../lib/metricsContract.js';
import { resolveSession } from '../lib/portalAuth.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';
import { snapshotHeaders } from '../lib/snapshotClient.js';
import { isTestData } from '../lib/leadTestFilter.js';
import { isTestContact, dedupeByContact } from '../lib/pipelineHygiene.js';

const SNAPSHOT_BLOB_KEY = 'ryujin-snapshot.json';
const LEGACY_SNAPSHOT_BLOB_KEY = 'shenron-snapshot.json';
// Versioned store: every save writes a NEW key so its URL is immutable and the
// CDN can never serve a stale overwrite. The 2026-06-10 brief-wipe bug: edge
// entries cached under the old 1-year TTL kept serving hours-old snapshots
// even after cacheControlMaxAge was added, so the hourly rebuild resurrected
// dead sections. list() is API-backed (never CDN-cached), so newest-by-key
// discovery is always fresh. Old versions are pruned, newest 3 kept.
const SNAPSHOT_VERSIONED_PREFIX = 'ryujin-snapshot-v/';

// Cat-test contact patterns. Catherine's QA personas + system-test threads
// leak into GHL conversations and pipeline opportunities and pollute every
// snapshot consumer (Krillin lead-flow alarm, briefing comms section, chat
// tools). The patterns now live in lib/pipelineHygiene.js as the single source
// of truth (shared with the Vegeta agent + the GHL endpoint); this alias keeps
// the existing isCatTestContact call sites unchanged.
const isCatTestContact = isTestContact;

// Compute "tickets" stats from the WORKORDERS table (the real source of
// truth for active jobs). The legacy `tickets` table went dormant in May
// 2026 -- the cockpit was showing 35 abandoned April checklist items as
// "overdue." Per project_job_folders_source_of_truth, job state derives
// from workorders + job_folders, not tickets. This function keeps the
// same return shape (sections.tickets.*) so dashboard-v2, briefing top3,
// and command-center workspace drawer all read fresh data without UI changes.
//
// Field mapping:
//   workorders.completed_at IS NULL  -> still active
//   workorders.start_date < today (and not completed) -> overdue
//   workorders.status   -> byStatus key ("complete" renamed to "done"
//                                        so the legacy enum stays intact)
//   workorders.sub_crew_lead -> byAssignee key (Unassigned when null)
async function nativeTicketStats() {
  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
    if (!tenant) return null;
    const { data: rows } = await supabaseAdmin
      .from('workorders')
      .select('id, wo_number, customer_name, address, status, start_date, completed_at, sub_crew_lead, job_type, created_at')
      .eq('tenant_id', tenant.id)
      .order('start_date', { ascending: false, nullsFirst: false })
      .limit(500);
    if (!rows) return null;

    const byStatus = {};
    const byAssignee = {};
    let overdueCount = 0;
    const now = new Date();
    const activeToday = [];
    const completedCustomers = new Set();
    const abandoned = [];

    for (const w of rows) {
      // Normalize status: workorders use 'complete', the consumer enum expects 'done'
      const rawStatus = (w.status || 'open').toLowerCase();
      const s = rawStatus === 'complete' ? 'done' : rawStatus;
      byStatus[s] = (byStatus[s] || 0) + 1;

      const owner = w.sub_crew_lead || 'Unassigned';
      byAssignee[owner] = (byAssignee[owner] || 0) + 1;

      // Active = a job genuinely in flight. Keyed on STATUS, not on the absence of
      // completed_at: a finished-on-the-ground WO that was never flipped to
      // complete keeps completed_at NULL and used to count active forever, and
      // draft scaffolds (no start_date) also leaked in. Allowlist fixes both.
      const isActive = rawStatus === 'issued' || rawStatus === 'in_progress';
      const title = w.customer_name
        ? `${w.customer_name} (${w.address || `WO-${w.wo_number}`})`
        : (w.address || `WO-${w.wo_number}`);

      if (isActive && w.start_date && new Date(w.start_date) < now) overdueCount++;
      // Completed-job customers: used downstream to relabel stale "Proposal Accepted"
      // rows in revenue.recentActivity. Key off the real complete status, not
      // !isActive (which now also includes drafts).
      if (rawStatus === 'complete' && w.customer_name) completedCustomers.add(w.customer_name.trim().toLowerCase());

      // Abandoned: issued but more than 7 days past its start date and never
      // moved to in_progress/complete - a job that fell through the cracks.
      if (rawStatus === 'issued' && w.start_date) {
        const daysPast = Math.floor((now - new Date(w.start_date)) / 86400000);
        if (daysPast > 7) {
          abandoned.push({ id: w.id, title, wo_number: w.wo_number, start_date: w.start_date, days_past: daysPast, assignee: owner });
        }
      }

      if (isActive) {
        activeToday.push({
          id: w.id,
          title,
          status: s,
          priority: null,
          assignee: owner,
          due_date: w.start_date,
          days_overdue: w.start_date ? Math.max(0, Math.floor((now - new Date(w.start_date)) / 86400000)) : null,
          wo_number: w.wo_number
        });
      }
    }

    return {
      stats: {
        totalTickets: rows.length,
        byStatus,
        byAssignee,
        overdueCount,
        activeToday: activeToday.sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0)),
        abandoned: abandoned.sort((a, b) => (b.days_past || 0) - (a.days_past || 0)),
        completedCustomers: [...completedCustomers]
      }
    };
  } catch (e) {
    console.warn('[snapshot] nativeTicketStats (workorder rollup) failed:', e.message);
    return null;
  }
}

// Native proposals: the Ryujin-native estimates that live in Supabase
// (instant-estimator quotes, builder drafts). The cockpit's sections.revenue
// is sourced from the LEGACY Estimator OS (Replit) feed via /api/lookup, which
// has no knowledge of these. Result: a native quote like plus-ultra-76 is
// invisible on the Sales cockpit even though it exists. This pulls the most
// recent native estimates (tenant-scoped, service-role read, fixed shape) so the
// cockpit can surface them. Fully rebuilt each snapshot, so no preserveKeys entry
// is needed (those are only for agent-POSTed sections).
async function nativeProposalStats() {
  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
    if (!tenant) return null;
    const { data: rows } = await supabaseAdmin
      .from('estimates')
      .select('id, estimate_number, share_token, status, proposal_mode, calculated_packages, created_at, updated_at, customer:customers(full_name, address, city)')
      .eq('tenant_id', tenant.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!rows) return null;

    // Canonical customer link is the v2 /p/<slug> page when a materialized instance
    // exists; fall back to the legacy v1 share link only when there is none.
    const instByEst = {};
    try {
      const estIds = rows.map(e => e.id).filter(Boolean);
      if (estIds.length) {
        const { data: insts } = await supabaseAdmin
          .from('proposal_instances')
          .select('estimate_id, slug, created_at')
          .eq('tenant_id', tenant.id)
          .in('estimate_id', estIds)
          .order('created_at', { ascending: false });
        for (const i of (insts || [])) {
          if (i.estimate_id && i.slug && !instByEst[i.estimate_id]) instByEst[i.estimate_id] = i.slug;
        }
      }
    } catch (e) { /* best-effort: fall back to the legacy link below */ }

    const proposals = rows.map(e => {
      const cp = e.calculated_packages || {};
      // Entry-tier "from" price: prefer gold, fall back to whichever tier exists.
      const tier = cp.gold || cp.platinum || cp.diamond || null;
      const fromPrice = tier ? (tier.total ?? tier.summary?.sellingPrice ?? null) : null;
      const cust = e.customer || {};
      return {
        number: e.estimate_number,
        shareToken: e.share_token || null,
        status: e.status || 'draft',
        mode: e.proposal_mode || null,
        customer: cust.full_name || 'Unknown',
        address: [cust.address, cust.city].filter(Boolean).join(', '),
        fromPrice,
        url: instByEst[e.id] ? ('/p/' + instByEst[e.id]) : (e.share_token ? ('/proposal-client.html?share=' + encodeURIComponent(e.share_token)) : null),
        createdAt: e.created_at,
        updatedAt: e.updated_at
      };
    });

    return {
      _note: 'Ryujin-native estimates (Supabase), NOT the legacy Estimator OS feed in sections.revenue. Powers the cockpit Recent Quotes so instant-estimator quotes are visible.',
      total: proposals.length,
      drafts: proposals.filter(p => /draft/i.test(p.status)).length,
      proposals
    };
  } catch (e) {
    console.warn('[snapshot] nativeProposalStats failed:', e.message);
    return null;
  }
}
let cachedBlobUrl = null;
let storeBase = null;

function extractStoreBase(url) {
  if (!url) return null;
  const match = url.match(/^(https:\/\/[^/]+)/);
  return match ? match[1] : null;
}

async function ensureStoreBase() {
  if (storeBase) return storeBase;
  const url = await discoverBlobUrl();
  if (url) storeBase = extractStoreBase(url);
  if (!storeBase && process.env.BLOB_STORE_URL) {
    storeBase = process.env.BLOB_STORE_URL.replace(/\/$/, '');
  }
  return storeBase;
}

async function discoverBlobUrl() {
  if (cachedBlobUrl) return cachedBlobUrl;
  let { blobs } = await list({ prefix: SNAPSHOT_BLOB_KEY, limit: 1 });
  if (blobs.length === 0) {
    ({ blobs } = await list({ prefix: LEGACY_SNAPSHOT_BLOB_KEY, limit: 1 }));
  }
  if (blobs.length > 0) {
    cachedBlobUrl = blobs[0].url;
    if (!storeBase) storeBase = extractStoreBase(cachedBlobUrl);
    return cachedBlobUrl;
  }
  return null;
}

// Codepoint compare, descending: collation must never depend on locale.
function byPathnameDesc(a, b) {
  return b.pathname < a.pathname ? -1 : b.pathname > a.pathname ? 1 : 0;
}

async function getSnapshot() {
  // Versioned-first: keys are timestamped (lexically sortable), URLs immutable.
  // IMPORTANT: transient list/fetch errors must THROW (caller 500s, cron
  // retries). Falling back to the frozen bare key on an error would let the
  // next POST merge enshrine CDN-poisoned stale data as the newest version,
  // with worse staleness than the bug this design fixes (review P1).
  const { blobs } = await list({ prefix: SNAPSHOT_VERSIONED_PREFIX, limit: 1000 });
  if (blobs.length > 0) {
    const newest = blobs.sort(byPathnameDesc)[0];
    const resp = await fetch(newest.url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`versioned snapshot fetch HTTP ${resp.status}`);
    return await resp.json();
  }
  // Genuinely no versioned snapshot yet (first deploy): legacy single key.
  const base = await ensureStoreBase();
  if (base) {
    const directUrl = `${base}/${SNAPSHOT_BLOB_KEY}`;
    try {
      const resp = await fetch(directUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (resp.ok) return await resp.json();
    } catch {}
  }
  const url = await discoverBlobUrl();
  if (!url) return null;
  try {
    const resp = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function saveSnapshot(data) {
  // Timestamped key: zero-padded ms epoch keeps pathname sort == time sort.
  const key = `${SNAPSHOT_VERSIONED_PREFIX}${String(Date.now()).padStart(15, '0')}.json`;
  const blob = await put(key, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 60
  });
  // Best-effort prune: keep the 3 newest versions (rolling operational cache,
  // regenerated hourly; not user data).
  try {
    const { blobs } = await list({ prefix: SNAPSHOT_VERSIONED_PREFIX, limit: 1000 });
    const stale = blobs
      .sort(byPathnameDesc)
      .slice(3)
      .map(b => b.url);
    if (stale.length) await del(stale);
  } catch (e) {
    console.error('[snapshot] version prune failed:', e.message);
  }
  return blob;
}

// Canonical cross-page KPIs (metrics contract v1). Fully rebuilt each
// snapshot, so no preserveKeys entry needed. Same compute as /api/metrics.
async function nativeMetrics() {
  try {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
    if (!tenant) return null;
    return await computeMetrics(supabaseAdmin, tenant.id);
  } catch (e) {
    console.warn('[snapshot] nativeMetrics failed:', e.message);
    return null;
  }
}

// Build a fresh snapshot by pulling all APIs
async function buildFreshSnapshot() {
  // last_full_rebuild_at marks when the live-fetch sections (metrics, revenue,
  // pipeline, tickets, leads, crm, conversations, salesTasks, nativeProposals)
  // were actually rebuilt. Partial agent POSTs bump updated_at but never touch
  // this field, so the GET staleness gate must read THIS, not updated_at, or the
  // sub-hourly agent cadence keeps updated_at fresh forever and the rebuild never
  // fires (live sections froze at 2026-06-09 until this fix).
  const now = new Date().toISOString();
  const snapshot = { updated_at: now, last_full_rebuild_at: now, sections: {} };

  const _svcToken = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  const _svcHeaders = { 'x-tenant-id': 'plus-ultra', ...(_svcToken ? { Authorization: `Bearer ${_svcToken}` } : {}) };
  const tf = (url, opts = {}, timeoutMs = 15000) => fetch(url, { ...opts, headers: { ..._svcHeaders, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });

  // Contacts feed the leads KPI. limit=400 makes the /api/ghl proxy paginate 4
  // GHL pages (4 round-trips), so it is the single most failure-prone fetch in
  // this batch. When it rejected inside the old shared allSettled, ghlContacts
  // went null, the `if (ghlContacts?.contacts)` guard fell through, and the
  // ENTIRE sections.leads block was never assigned, so the key VANISHED from the
  // snapshot on an intermittent GHL hiccup (the #515 regression, P1 2026-06-17).
  // Fetch it on its own with one retry and a limit=100 (single-page) fallback so
  // a transient 4-page failure degrades to a smaller-but-real count instead of
  // wiping the section.
  //
  // Latency budget: api/snapshot.js runs under vercel.json maxDuration 30s, and
  // this function also runs 8 OTHER parallel fetches + Supabase reads in the same
  // window. So the 3 attempts get a SHORTENED 8s per-attempt timeout (not the
  // default 15s): 8+8+8 = 24s absolute worst case, under the 30s function budget
  // with headroom, instead of 45s (which would FUNCTION_INVOCATION_TIMEOUT and
  // skip the snapshot save entirely — the very outage this hardening prevents).
  const CONTACTS_ATTEMPT_TIMEOUT_MS = 8000;
  const fetchGhlContacts = async () => {
    const attempts = [
      'https://ryujin-os.vercel.app/api/ghl?mode=contacts&limit=400', // primary (4 pages)
      'https://ryujin-os.vercel.app/api/ghl?mode=contacts&limit=400', // retry once
      'https://ryujin-os.vercel.app/api/ghl?mode=contacts&limit=100', // fallback (1 page)
    ];
    let lastErr = null;
    for (const url of attempts) {
      try {
        const data = await tf(url, {}, CONTACTS_ATTEMPT_TIMEOUT_MS).then(r => r.json());
        if (data && Array.isArray(data.contacts)) return data;
        lastErr = new Error('contacts payload missing .contacts array');
      } catch (e) {
        lastErr = e;
      }
    }
    console.warn(`[snapshot] contacts fetch failed after retry+fallback: ${lastErr?.message || 'unknown'}`);
    return null;
  };

  const [fetches, ghlContacts] = await Promise.all([
    Promise.allSettled([
      tf('https://ryujin-os.vercel.app/api/lookup?mode=stats', { headers: snapshotHeaders() }).then(r => r.json()),
      tf('https://ryujin-os.vercel.app/api/ghl').then(r => r.json()),
      // limit=1000 pages the full opportunity book. The default (100) capped the
      // converted/quoted counts computed below: live 229 open opps were truncated
      // to the newest 100, badly undercounting conversion (converted 2 vs 12,
      // quoted 12 vs 33). The /api/ghl proxy paginates via startAfter for limit>100.
      tf('https://ryujin-os.vercel.app/api/ghl?mode=pipeline&limit=1000').then(r => r.json()),
      tf('https://ryujin-os.vercel.app/api/ghl?mode=conversations').then(r => r.json()),
      // Tickets are now native to Ryujin (migrated from Action Board 2026-05-11).
      // Action Board Replit is no longer the source of truth — read directly from Supabase.
      nativeTicketStats(),
      tf('https://ryujin-os.vercel.app/api/ghl?mode=tasks').then(r => r.json()),
      // Native estimates (Supabase) so the cockpit can surface instant-estimator
      // quotes that the legacy Estimator OS feed (sections.revenue) never sees.
      nativeProposalStats(),
      // Canonical KPIs (metrics contract v1) — pages migrate to this section.
      nativeMetrics(),
    ]),
    fetchGhlContacts(),
  ]);

  const [stats, ghl, pipeline, conversations, tickets, ghlTasks, nativeProposals, metrics] = fetches.map(f =>
    f.status === 'fulfilled' ? f.value : null
  );

  if (nativeProposals) snapshot.sections.nativeProposals = nativeProposals;
  if (metrics) snapshot.sections.metrics = metrics;

  // Pipeline & Revenue
  if (stats?.results) {
    const est = stats.results.find(r => r.source === 'Estimator OS');

    if (est?.stats) {
      // Honesty fix (desk D cycle-14): the old 4h cashflow re-PUT bumped completed
      // jobs' updated_at on Estimator OS (root cause fixed in PR #381), so its feed
      // still surfaces done jobs as "Proposal Accepted" today, reading as phantom new
      // signings. Relabel any row whose customer has a completed workorder so the
      // activity feed stops implying a fresh signing. The signed-MTD KPI is always the
      // metrics contract (metrics.signed.mtd, count 1), never this row count.
      const completedCust = new Set((tickets?.stats?.completedCustomers) || []);
      const recentActivity = (est.stats.recentActivity || []).slice(0, 5).map(r =>
        (r && r.action === 'Proposal Accepted' && r.customer && completedCust.has(String(r.customer).trim().toLowerCase()))
          ? { ...r, action: 'Previously accepted (job complete)' }
          : r
      );
      snapshot.sections.revenue = {
        signedRevenue: est.stats.signedRevenue,
        pendingRevenue: est.stats.pendingRevenue,
        totalEstimates: est.stats.totalEstimates,
        byStatus: est.stats.byStatus,
        proposalsSent: est.stats.proposalsSent,
        awaitingSchedule: est.stats.awaitingSchedule,
        recentActivity
      };
    }
  }

  // Tickets are native to Ryujin and come from their own fetch (nativeTicketStats),
  // independent of the Estimator OS stats lookup. Built OUTSIDE the
  // `if (stats?.results)` guard so a transient stats hiccup can't drop the whole
  // tickets section (same class of fix as the leads block / #523). 'tickets' is
  // also in preserveKeys below as a carry-forward backstop if its own fetch fails.
  if (tickets?.stats) {
    snapshot.sections.tickets = {
      total: tickets.stats.totalTickets,
      byStatus: tickets.stats.byStatus,
      byAssignee: tickets.stats.byAssignee,
      overdueCount: tickets.stats.overdueCount,
      activeToday: (tickets.stats.activeToday || []).slice(0, 10),
      abandoned: (tickets.stats.abandoned || []).slice(0, 10)
    };
  }

  // Leads — tiered funnel: marketing leads → local → sales qualified → converted.
  // This block lives OUTSIDE the `if (stats?.results)` guard above on purpose: it
  // consumes only ghlContacts + pipeline, never stats/est. Nesting it under the
  // stats guard meant an independent /api/lookup (stats) flake would skip the
  // whole leads block and the section would vanish even when contacts fetched
  // fine. Sibling placement + the else-fallback below guarantees sections.leads
  // is ALWAYS assigned (the #515 regression fix, 2026-06-17).
  {
    if (ghlContacts?.contacts) {
      // Source whitelist. Live capture sources land as RAW SLUGS on c.source
      // (e.g. "instant-estimator-v3", "revive-estimator-v1") AND as the
      // human-readable label on a tag (e.g. "instant estimator submission").
      // The old whitelist only carried the human-readable form, so every real
      // Instant Estimator / Revive lead failed isRealSource and thisWeek
      // collapsed to a false zero (Jun 16 2026 — reference_snapshot_lead_count_false_zero).
      // Match BOTH the slug and the label, on either c.source or a tag.
      const VALID_SOURCES = [
        '10 costly mistakes', '10 tips',
        'contact us form', 'call direct', 'facebook direct',
        'instant estimator submission', 'instant-estimator',
        'revive estimator submission', 'revive-estimator',
        'inspection lead magnet form',
        'plus ultra roofing website form', 'active job canvassing',
        'darcy- door knocking', 'past customer',
      ];
      const VALID_TAGS = [
        '10 costly mistakes', 'lead – 10 tips download',
        'appointment - confirmed', 'darcy- door knock',
        'quote_voiceai', 'incubator - start',
        'instant estimator submission', 'revive estimator submission',
        'source:instant-estimator', 'source:revive-estimator',
      ];
      // NB + border area codes (506, 782 = NB; 902 = NS/PEI border towns)
      const LOCAL_AREA_CODES = ['506', '782', '902'];
      const JUNK_EMAIL_PATTERNS = [/^.{20,}@/, /@xfavaj\.com/, /@tempmail/, /@guerrillamail/];
      // isTestData (Cat's QA / smoke-test contacts) is the shared filter from
      // lib/leadTestFilter.js so this KPI path and the lead view never disagree.

      const extractAreaCode = (phone) => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 10) return digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
        return null;
      };

      const isRealSource = (c) => {
        const src = (c.source || '').toLowerCase().trim();
        const tags = (c.tags || []).map(t => (t || '').toLowerCase().trim());
        if (src && VALID_SOURCES.some(vs => src.includes(vs))) return true;
        if (tags.some(t => VALID_TAGS.some(vt => t.includes(vt)))) return true;
        return false;
      };

      const isJunk = (c) => {
        const email = (c.email || '').toLowerCase();
        if (JUNK_EMAIL_PATTERNS.some(p => p.test(email))) return true;
        const name = (c.name || '').trim();
        if (name.length <= 1) return true;
        return false;
      };

      const isLocal = (c) => {
        const areaCode = extractAreaCode(c.phone);
        // If we have a city in NB, it's local regardless of area code
        const state = (c.state || '').toLowerCase();
        if (state.includes('new brunswick') || state === 'nb') return true;
        const city = (c.city || '').toLowerCase();
        const nbCities = ['moncton', 'riverview', 'dieppe', 'shediac', 'sussex', 'norton',
          'salisbury', 'petitcodiac', 'memramcook', 'sackville', 'point de bute',
          'scoudouc', 'sainte marie', 'indian mountain', 'fredericton', 'saint john',
          'miramichi', 'bathurst', 'edmundston', 'campbellton', 'woodstock', 'oromocto'];
        if (city && nbCities.some(nb => city.includes(nb))) return true;
        // Amherst NS is serviceable
        if (city === 'amherst') return true;
        // Fall back to area code
        if (areaCode && LOCAL_AREA_CODES.includes(areaCode)) return true;
        // No phone and no geo data = can't confirm, exclude
        if (!areaCode && !city && !state) return false;
        return false;
      };

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const allContacts = ghlContacts.contacts || [];

      // Tier 1: Has a real source (not spam/bot entry), excluding QA/test contacts
      const marketingLeads = allContacts.filter(c => isRealSource(c) && !isJunk(c) && !isTestData(c));
      // Tier 2: Also in service area
      const localLeads = marketingLeads.filter(isLocal);
      const outOfArea = marketingLeads.filter(c => !isLocal(c));
      // This week counts
      const localThisWeek = localLeads.filter(c => new Date(c.createdAt || c.dateAdded) >= weekAgo);
      const outOfAreaThisWeek = outOfArea.filter(c => new Date(c.createdAt || c.dateAdded) >= weekAgo);

      // Conversion: signed/won pipeline stages
      const SIGNED_STAGES = [
        'client signed', 'contract signed', 'approved',
        'scheduled & starting', 'deposit invoice sent', 'deposit invoice paid',
        'job in progress', 'job complete', 'post production', 'invoice paid', 'the end'
      ];
      const QUOTE_STAGES = ['quote sent', 'inspection scheduled'];
      let converted = 0;
      let quoted = 0;
      if (pipeline?.opportunities) {
        for (const opp of (pipeline.opportunities || [])) {
          const stage = (opp.stage || '').toLowerCase();
          if (SIGNED_STAGES.some(s => stage.includes(s))) converted++;
          else if (QUOTE_STAGES.some(s => stage.includes(s))) quoted++;
        }
      }

      const conversionRate = localLeads.length > 0
        ? Math.round((converted / localLeads.length) * 1000) / 10 : 0;
      const quoteRate = localLeads.length > 0
        ? Math.round(((quoted + converted) / localLeads.length) * 1000) / 10 : 0;

      snapshot.sections.leads = {
        // Primary numbers (local leads only)
        total: localLeads.length,
        thisWeek: localThisWeek.length,
        converted,
        quoted,
        conversionRate,
        quoteRate,
        // Breakdown
        outOfArea: outOfArea.length,
        outOfAreaThisWeek: outOfAreaThisWeek.length,
        marketingLeadsTotal: marketingLeads.length,
        source: 'GHL (local + filtered, Cat-test excluded)'
      };
    } else {
      // Defense in depth: even with the retry+fallback above, a total GHL
      // outage can leave ghlContacts null. ALWAYS assign a structured, zeroed
      // shape so sections.leads can never VANISH (the #515 regression). The
      // preserveKeys pass below then carries the last-known-good leads section
      // forward over this zeroed placeholder when a prior snapshot exists, so a
      // transient outage shows stale-but-real numbers rather than a false zero.
      snapshot.sections.leads = {
        total: 0,
        thisWeek: 0,
        converted: 0,
        quoted: 0,
        conversionRate: 0,
        quoteRate: 0,
        outOfArea: 0,
        outOfAreaThisWeek: 0,
        marketingLeadsTotal: 0,
        source: 'GHL contacts fetch failed (retry + limit=100 fallback exhausted)',
        _stale: true
      };
    }
  }

  // CRM Overview — NOTE: GHL pipelineValue is NOT revenue. It's aggregate of all opportunity values
  // regardless of status. Use Estimator OS signedRevenue/pendingRevenue for actual revenue.
  if (ghl && !ghl.error) {
    snapshot.sections.crm = {
      totalContacts: ghl.totalContacts,
      totalOpportunities: ghl.totalOpportunities,
      openOpportunities: ghl.openOpportunities,
      _openOppsNote: 'SAMPLE stat: open-status count within the 10 most recent opportunities only (max 10). NOT the global open count; GHL holds far more status-open. Use mode=pipeline for the full book.',
      pipelineValue_NOT_REVENUE: ghl.pipelineValue,
      _pipelineNote: 'This is total value of ALL GHL opportunities (open+closed+lost). NOT actual signed revenue. Use sections.revenue for real numbers.',
      recentContacts: (ghl.recentContacts || []).slice(0, 20).map(c => ({
        id: c.id, name: c.name, phone: c.phone, email: c.email,
        address: c.address || c.address1 || '', city: c.city,
        state: c.state, source: c.source, createdAt: c.createdAt
      })),
      recentOpportunities: (ghl.recentOpportunities || []).slice(0, 10).map(o => ({
        name: o.name, value: o.value, status: o.status,
        pipeline: o.pipeline, stage: o.stage, source: o.source,
        address: o.contact?.address || o.contact?.address1 || '',
        city: o.contact?.city || '', state: o.contact?.state || '',
        lastStatusChange: o.lastStatusChange
      })),
      contactIndex: (() => {
        const index = {};
        const contacts = ghl.recentContacts || [];
        // Index contacts by address fragments and name
        for (const c of contacts.slice(0, 30)) {
          const addr = (c.address || c.address1 || '').toLowerCase().trim();
          const name = (c.name || '').trim();
          if (addr && name) {
            index[addr] = { id: c.id, name, phone: c.phone, email: c.email };
            // Also index by street name only (e.g., "Mountain Rd" from "133 Mountain Rd")
            const streetOnly = addr.replace(/^\d+\s*/, '');
            if (streetOnly && streetOnly !== addr) {
              index[streetOnly] = { id: c.id, name, phone: c.phone, email: c.email };
            }
          }
          // Index by name for reverse lookup
          if (name) {
            const key = name.toLowerCase();
            if (!index[key]) index[key] = { id: c.id, address: c.address || c.address1 || '', phone: c.phone, email: c.email };
          }
        }
        return index;
      })()
    };
  }

  // Full pipeline opportunities (top 50 by recency). Filter test personas and
  // dedupe by contact BEFORE slicing so the 50 we surface are 50 real distinct
  // opportunities, not padded with test rows + cross-pipeline duplicates of the
  // same human (the form-fill shadow-opp problem). The trusted clean counts ride
  // on briefing_morning.kpiScouter (Vegeta) and the GHL endpoint's cleanStats.
  if (pipeline?.opportunities) {
    snapshot.sections.pipeline = dedupeByContact(
        pipeline.opportunities.filter(o => !isTestContact(o))
      )
      .slice(0, 50)
      .map(o => ({
        name: o.name, value: o.value, status: o.status,
        pipeline: o.pipeline, stage: o.stage, source: o.source,
        lastActivity: o.lastStatusChange || o.createdAt
      }));
  }

  // Conversations — filter Cat-test pollution BEFORE slicing so the 20 we
  // surface are 20 real ones, not 15 real + 5 test.
  if (conversations?.conversations) {
    snapshot.sections.conversations = conversations.conversations
      .filter(c => !isCatTestContact(c.contactName))
      .slice(0, 20)
      .map(c => ({
        name: c.contactName, unread: c.unreadCount,
        lastMessage: c.lastMessageDate, type: c.lastMessageType
      }));
  }

  // Crew tickets (real ones only, not system tickets)
  if (Array.isArray(tickets)) {
    snapshot.sections.crewTickets = tickets
      .filter(t => !t.title.startsWith('[SHENRON') && !t.title.startsWith('[RYUJIN') && !t.title.startsWith('[APPROVAL'))
      .map(t => ({
        id: t.id, title: t.title, status: t.status,
        priority: t.priority, assignedTo: t.assignedTo,
        dueDate: t.dueDate, category: t.category
      }));
  }

  // GHL/Automator tasks (sales tasks tied to contacts — TOP PRIORITY for Mackenzie)
  if (ghlTasks && !ghlTasks.error && Array.isArray(ghlTasks.tasks)) {
    snapshot.sections.salesTasks = {
      _note: 'These are GHL/Automator tasks. Sales-related, tied to contacts. ALWAYS surface in priorities.',
      total: ghlTasks.total,
      open: ghlTasks.open,
      overdue: ghlTasks.overdue,
      dueSoon: ghlTasks.dueSoon,
      tasks: ghlTasks.tasks.slice(0, 30).map(t => ({
        id: t.id,
        title: t.title,
        body: t.body,
        contact: t.contactName || t.contactId || 'Unknown',
        contactId: t.contactId,
        assignedTo: t.assignedToName,
        dueDate: t.dueDate,
        overdue: t.overdue,
        dueSoon: t.dueSoon
      }))
    };
  }

  // ── GHL CONTACT NOTES — Cataloged for active contacts ──
  // Notes contain critical client context (Darcy's handoffs, special requests, pricing
  // discussions). Pull notes for every contact attached to an open opportunity or sales task
  // so Ryujin has them in daily context without per-call fetches.
  try {
    const activeContactIds = new Set();

    // From sales tasks (highest priority — these are open work items)
    if (snapshot.sections.salesTasks?.tasks) {
      for (const t of snapshot.sections.salesTasks.tasks) {
        if (t.contactId) activeContactIds.add(t.contactId);
      }
    }

    // From recent CRM opportunities (open deals)
    if (ghl?.recentOpportunities) {
      // recentOpportunities entries don't carry contactId directly — fetch via pipeline
      // search by name match against contactIndex if available
      const idx = snapshot.sections.crm?.contactIndex || {};
      for (const o of ghl.recentOpportunities) {
        if (o.status !== 'open') continue;
        const key = (o.name || '').toLowerCase();
        const match = idx[key];
        if (match?.id) activeContactIds.add(match.id);
      }
    }

    // Cap at 15 to keep API calls bounded
    const idsToFetch = [...activeContactIds].slice(0, 15);

    if (idsToFetch.length > 0) {
      const noteResults = await Promise.allSettled(
        idsToFetch.map(cid =>
          fetch(`https://ryujin-os.vercel.app/api/ghl?action=notes&id=${cid}`, { headers: { 'x-tenant-id': 'plus-ultra', ...((process.env.RYUJIN_SERVICE_TOKEN || '').trim() ? { Authorization: `Bearer ${(process.env.RYUJIN_SERVICE_TOKEN || '').trim()}` } : {}) } })
            .then(r => r.json())
            .then(data => ({ contactId: cid, notes: data.notes || [] }))
        )
      );

      const activeContactNotes = {};
      for (const r of noteResults) {
        if (r.status === 'fulfilled' && r.value.notes.length > 0) {
          // Keep only the latest 3 notes per contact, truncated to keep snapshot size sane
          activeContactNotes[r.value.contactId] = r.value.notes.slice(0, 3).map(n => ({
            body: (n.body || '').slice(0, 800),
            dateAdded: n.dateAdded,
            userId: n.userId
          }));
        }
      }

      snapshot.sections.activeContactNotes = {
        _note: 'Latest notes (max 3 per contact, max 15 contacts) for clients with open tasks or open opportunities. Refreshed every snapshot rebuild. Critical client context — Darcy and Mackenzie put load-bearing info here.',
        contactCount: Object.keys(activeContactNotes).length,
        notes: activeContactNotes
      };
    }
  } catch (notesErr) {
    console.error('activeContactNotes catalog failed:', notesErr.message);
    // Don't fail the whole snapshot — just skip notes section
  }

  // ── REVENUE RECONCILIATION ──
  // Single source of truth: Estimator OS (sections.revenue)
  // GHL pipeline value is NOT revenue — it double-counts, includes test data, lost deals
  if (snapshot.sections.revenue) {
    snapshot.sections.revenue._source = 'Estimator OS (canonical)';
    snapshot.sections.revenue._warning = 'Do NOT use GHL pipelineValue for revenue reporting. Use signedRevenue and pendingRevenue from this section only.';
  }

  // Preserve enriched sections that were pushed by external sources or agent crons.
  // - metaAds: live Meta Graph API data (pushed by daily.js and briefing.js)
  // - googleAds: live Google Ads API summary (pushed by api/feeders/google-ads.js cron)
  // - gmail/calendar: pushed by Claude Code MCP sessions
  // - briefing_morning/afternoon/evening: pushed by /api/agents/briefing cron
  // - watchdog: pushed by /api/agents/watchdog cron
  // - heartbeat: pushed by /api/agents/heartbeat cron
  // - tokenRefresh: pushed by daily.js when token auto-refresh fires
  // Without this list, the hourly snapshot rebuild WIPES these and the heartbeat dead-mans-switch
  // misfires (which is exactly what happened on 2026-04-11).
  const existing = await getSnapshot();
  const preserveKeys = [
    // fleet: pushed by the local Guild Hall hub poster (the blockedOnMac decision
    // queue + desk states + fleet health). Preserve or the hourly rebuild wipes it
    // and the cockpit brain goes Builder-Room-blind again within the hour.
    'fleet',
    // directives: Mac's intent recorded by Ryujin's record_directive tool (the
    // Intent Ledger write-back leg). Preserve or the hourly rebuild wipes the queue.
    'directives',
    'metaAds', 'googleAds', 'gmail', 'calendar',
    // adFunnel: per-channel cost-per-booked rollup pushed by api/feeders/ad-funnel.js.
    // Disjoint key (sits on top of the raw metaAds/googleAds spend dumps). Preserve
    // or the hourly rebuild wipes it within the hour (the documented preserveKeys footgun).
    'adFunnel',
    'briefing_morning', 'briefing_afternoon', 'briefing_evening',
    'watchdog', 'heartbeat', 'canary', 'tokenRefresh',
    'cashflow',
    // Same bug pattern as 2026-04-11 (watchdog wipe) - daily.js writes
    // sections.agentReports (daily Z-fighters); without preservation the
    // hourly rebuild silently drops them and the morning briefing has
    // no anime-agent context to pull from. weekly.js (Trunks/Bulma) writes
    // its OWN disjoint key agentReportsWeekly so daily's daily run cannot
    // clobber it (shared-key clobber fix 2026-06-16).
    'agentReports', 'agentReportsWeekly', 'metaConfigAudit', 'tokenWarning',
    // Inbox agent (migration 078) - every-20-min cron writes sections.inbox
    // with needsReview/notified/scanned counts + lastRun. Same wipe risk as
    // the others if omitted here.
    'inbox',
    // Quest scanner (migration 080) - daily cron writes sections.questscan
    // with created/expired/byRule counts. Preserve so the hourly rebuild keeps it.
    'questscan',
    // Metrics contract v1 - rebuilt fresh each cycle by nativeMetrics(); this
    // entry only matters when that compute fails (returns null), where it
    // carries the last good section forward instead of dropping it for an hour.
    'metrics',
    // Tickets (nativeTicketStats) - rebuilt fresh each cycle and now built outside
    // the Estimator-OS stats guard. This entry only matters when the tickets fetch
    // itself returns null: carry the last-known-good section instead of dropping it.
    'tickets',
    // Reconciliation agent (migration 082) - daily cron writes sections.reconcile
    // with the committed-revenue figures + open finding count. Same wipe risk.
    'reconcile',
    // Collections pass (weekly Monday cron, reconcile?collections=1) writes
    // sections.collections with AR-aging + chase drafts + the dry-7d alert.
    'collections'
  ];
  if (existing?.sections) {
    for (const key of preserveKeys) {
      if (existing.sections[key] && !snapshot.sections[key]) {
        snapshot.sections[key] = existing.sections[key];
      }
    }
    // Leads is special: the else-branch above ALWAYS writes a zeroed
    // _stale placeholder on a contacts-fetch failure (so the key can never
    // vanish), which means the generic "!snapshot.sections[key]" guard above
    // would never replace it. When THIS rebuild produced only the stale
    // placeholder and a prior real leads section exists, carry the
    // last-known-good numbers forward instead of showing a false zero. A
    // freshly computed (non-stale) leads section is left untouched.
    if (snapshot.sections.leads?._stale && existing.sections.leads && !existing.sections.leads._stale) {
      snapshot.sections.leads = existing.sections.leads;
    }
  }

  return snapshot;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // FORCED REBUILD (GET ?rebuild=1): keeps the live-fetch sections fresh on a
  // schedule. Vercel crons can only issue GET (PUT force-refresh below is
  // unreachable by cron), and a bare cron GET has no session so it would 401 at
  // the read gate. This branch sits ABOVE the read gate, returns only a status
  // ack (no PII, so it is not a read leak), and is itself gated to the cron
  // secret / owner / service token. Paired with a */15 cron, live data never
  // drifts more than ~15 min stale.
  if (req.method === 'GET' && (req.query.rebuild === '1' || req.query.rebuild === 'true')) {
    const auth = await requireCronOrOwner(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error, code: 'REBUILD_FORBIDDEN' });
    try {
      const snapshot = await buildFreshSnapshot();
      await saveSnapshot(snapshot);
      return res.json({ status: 'rebuilt', via: auth.via, last_full_rebuild_at: snapshot.last_full_rebuild_at });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GATE (read paths): GET and PUT return the full blob, which aggregates
  // customer PII (names, addresses, phone/email) and revenue. They must never
  // be world-readable. The browser cockpit sends the logged-in user's session
  // token; cron agents + server libs send RYUJIN_SERVICE_TOKEN (resolveSession
  // maps it to a synthetic admin session). No session -> 401.
  //
  // POST (agent section writes) is intentionally left open in THIS change so it
  // does not break the agent write fleet mid-flight; it returns only a status
  // ack (no PII) so it is not part of the read leak. Gating POST + authing the
  // ~10 agent writers is the tracked follow-up.
  if (req.method === 'GET' || req.method === 'PUT') {
    const session = await resolveSession(req).catch(() => null);
    if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
    // The snapshot blob is Plus-Ultra-specific (its sections aggregate Plus Ultra
    // customer PII + revenue). A logged-in user from ANY other tenant must not be
    // able to read it. Bind the read to the snapshot's owning tenant: require the
    // session tenant to be Plus Ultra. The service token (snapshotHeaders sends
    // x-tenant-id: plus-ultra) resolves to the Plus Ultra synthetic-admin session,
    // so cron/agents/server libs still pass.
    const { data: snapTenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
    if (!snapTenant || session.tenant_id !== snapTenant.id) {
      return res.status(403).json({ error: 'cross_tenant_forbidden', code: 'WRONG_TENANT' });
    }
  }

  if (req.method === 'GET') {
    try {
      // Check if we have a cached snapshot
      let snapshot = await getSnapshot();

      // The */15 rebuild cron is the PRIMARY refresher. This on-demand gate is a
      // looser BACKSTOP (25 min) so a GET landing right on the cron boundary does
      // not redundantly rebuild, and so a thundering herd of dashboards cannot
      // each kick a full rebuild during the normal <15-min-fresh window. If the
      // cron has clearly failed (data >25 min old), an on-demand GET still heals it.
      // Gate on last_full_rebuild_at (set only by buildFreshSnapshot), NOT
      // updated_at: partial agent POSTs bump updated_at every few minutes, so
      // gating on it meant this rebuild never fired and the live sections froze.
      // A cached blob from before this fix has no last_full_rebuild_at -> the
      // first GET after deploy rebuilds immediately (self-healing).
      const lastFullRebuild = snapshot?.last_full_rebuild_at;
      if (!snapshot || !lastFullRebuild ||
          (Date.now() - new Date(lastFullRebuild).getTime() > 25 * 60 * 1000)) {
        snapshot = await buildFreshSnapshot();
        await saveSnapshot(snapshot);
      }

      return res.json(snapshot);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    // GATE (write path): POST overwrites top-level sections.* of the central
    // snapshot blob. Previously fully open -> anyone could clobber heartbeat,
    // revenue, metaAds, etc. Restrict to the agent/cron fleet: Bearer CRON_SECRET
    // (Vercel cron), an owner/admin session, or RYUJIN_SERVICE_TOKEN (the synthetic
    // admin session every agent self-call carries via snapshotHeaders()).
    const auth = await requireCronOrOwner(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error, code: 'WRITE_FORBIDDEN' });
    // Agents POST partial updates to merge into the snapshot.
    //
    // CONCURRENCY: this is a lockless read-modify-write of a single blob
    // (getSnapshot then saveSnapshot). It is only safe because every section
    // writer owns a DISJOINT top-level sections.* key (watchdog, heartbeat,
    // tokenRefresh, inbox, agentReports, etc.) and overwrites only its own key.
    // Two writers firing concurrently each clobber the other's blob version,
    // but because their keys do not overlap the lost write is the OTHER agent's
    // last value, not its own. Any FUTURE writer MUST claim a new disjoint key,
    // never share/co-mutate an existing one, or it will silently drop the peer's
    // data on an interleaved save.
    try {
      const updates = req.body;
      let snapshot = await getSnapshot() || { updated_at: new Date().toISOString(), sections: {} };

      // Merge updates into snapshot
      for (const [key, value] of Object.entries(updates)) {
        snapshot.sections[key] = value;
      }
      snapshot.updated_at = new Date().toISOString();

      await saveSnapshot(snapshot);
      return res.json({ status: 'ok', updated: Object.keys(updates), timestamp: snapshot.updated_at });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Force refresh
  if (req.method === 'PUT') {
    try {
      const snapshot = await buildFreshSnapshot();
      await saveSnapshot(snapshot);
      return res.json(snapshot);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Use GET, POST, or PUT' });
}
