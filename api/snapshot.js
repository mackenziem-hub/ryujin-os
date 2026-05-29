// ═══════════════════════════════════════════════════════════════
// RYUJIN SNAPSHOT — Central data cache for all agent intelligence
// GET  /api/snapshot — Read the current snapshot
// POST /api/snapshot — Update snapshot (called by agents after runs)
// PUT  /api/snapshot — Force full refresh
// Storage: Vercel Blob (deterministic URL, no Replit round-trip)
// ═══════════════════════════════════════════════════════════════

import { put, list } from '@vercel/blob';
import { supabaseAdmin } from '../lib/supabase.js';

const SNAPSHOT_BLOB_KEY = 'ryujin-snapshot.json';
const LEGACY_SNAPSHOT_BLOB_KEY = 'shenron-snapshot.json';

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

    for (const w of rows) {
      // Normalize status: workorders use 'complete', the consumer enum expects 'done'
      const rawStatus = (w.status || 'open').toLowerCase();
      const s = rawStatus === 'complete' ? 'done' : rawStatus;
      byStatus[s] = (byStatus[s] || 0) + 1;

      const owner = w.sub_crew_lead || 'Unassigned';
      byAssignee[owner] = (byAssignee[owner] || 0) + 1;

      const isActive = !w.completed_at;
      if (isActive && w.start_date && new Date(w.start_date) < now) overdueCount++;

      if (isActive) {
        const title = w.customer_name
          ? `${w.customer_name} (${w.address || `WO-${w.wo_number}`})`
          : (w.address || `WO-${w.wo_number}`);
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
        activeToday: activeToday.sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0))
      }
    };
  } catch (e) {
    console.warn('[snapshot] nativeTicketStats (workorder rollup) failed:', e.message);
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

async function getSnapshot() {
  // Fast path: direct URL construction (no list() needed)
  const base = await ensureStoreBase();
  if (base) {
    const directUrl = `${base}/${SNAPSHOT_BLOB_KEY}`;
    try {
      const resp = await fetch(directUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (resp.ok) return await resp.json();
    } catch {}
  }
  // Fallback: discover via list()
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
  const blob = await put(SNAPSHOT_BLOB_KEY, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json'
  });
  cachedBlobUrl = blob.url;
  if (!storeBase) storeBase = extractStoreBase(blob.url);
  return blob;
}

// Build a fresh snapshot by pulling all APIs
async function buildFreshSnapshot() {
  const snapshot = { updated_at: new Date().toISOString(), sections: {} };

  const tf = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const fetches = await Promise.allSettled([
    tf('https://ryujin-os.vercel.app/api/lookup?mode=stats').then(r => r.json()),
    tf('https://ryujin-os.vercel.app/api/ghl').then(r => r.json()),
    tf('https://ryujin-os.vercel.app/api/ghl?mode=pipeline').then(r => r.json()),
    tf('https://ryujin-os.vercel.app/api/ghl?mode=conversations').then(r => r.json()),
    // Tickets are now native to Ryujin (migrated from Action Board 2026-05-11).
    // Action Board Replit is no longer the source of truth — read directly from Supabase.
    nativeTicketStats(),
    tf('https://ryujin-os.vercel.app/api/ghl?mode=tasks').then(r => r.json()),
    tf('https://ryujin-os.vercel.app/api/ghl?mode=contacts&limit=100').then(r => r.json()),
  ]);

  const [stats, ghl, pipeline, conversations, tickets, ghlTasks, ghlContacts] = fetches.map(f =>
    f.status === 'fulfilled' ? f.value : null
  );

  // Pipeline & Revenue
  if (stats?.results) {
    const est = stats.results.find(r => r.source === 'Estimator OS');

    if (est?.stats) {
      snapshot.sections.revenue = {
        signedRevenue: est.stats.signedRevenue,
        pendingRevenue: est.stats.pendingRevenue,
        totalEstimates: est.stats.totalEstimates,
        byStatus: est.stats.byStatus,
        proposalsSent: est.stats.proposalsSent,
        awaitingSchedule: est.stats.awaitingSchedule,
        recentActivity: (est.stats.recentActivity || []).slice(0, 5)
      };
    }
    if (tickets?.stats) {
      snapshot.sections.tickets = {
        total: tickets.stats.totalTickets,
        byStatus: tickets.stats.byStatus,
        byAssignee: tickets.stats.byAssignee,
        overdueCount: tickets.stats.overdueCount,
        activeToday: (tickets.stats.activeToday || []).slice(0, 10)
      };
    }
    // Leads — tiered funnel: marketing leads → local → sales qualified → converted
    if (ghlContacts?.contacts) {
      const VALID_SOURCES = [
        '10 costly mistakes- pdf', '10 tips – pdf',
        'contact us form', 'call direct', 'facebook direct',
        'instant estimator submission', 'inspection lead magnet form',
        'plus ultra roofing website form', 'active job canvassing',
        'darcy- door knocking', 'past customer',
      ];
      const VALID_TAGS = [
        '10 costly mistakes', 'lead – 10 tips download',
        'appointment - confirmed', 'darcy- door knock',
        'quote_voiceai', 'incubator - start',
      ];
      // NB + border area codes (506, 782 = NB; 902 = NS/PEI border towns)
      const LOCAL_AREA_CODES = ['506', '782', '902'];
      const JUNK_EMAIL_PATTERNS = [/^.{20,}@/, /@xfavaj\.com/, /@tempmail/, /@guerrillamail/];

      const extractAreaCode = (phone) => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 10) return digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
        return null;
      };

      const isRealSource = (c) => {
        const src = (c.source || '').toLowerCase().trim();
        const tags = (c.tags || []).map(t => t.toLowerCase().trim());
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

      // Tier 1: Has a real source (not spam/bot entry)
      const marketingLeads = allContacts.filter(c => isRealSource(c) && !isJunk(c));
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
        source: 'GHL (local + filtered)'
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

  // Full pipeline opportunities (top 50 by recency)
  if (pipeline?.opportunities) {
    snapshot.sections.pipeline = pipeline.opportunities
      .slice(0, 50)
      .map(o => ({
        name: o.name, value: o.value, status: o.status,
        pipeline: o.pipeline, stage: o.stage, source: o.source,
        lastActivity: o.lastStatusChange || o.createdAt
      }));
  }

  // Conversations
  if (conversations?.conversations) {
    snapshot.sections.conversations = conversations.conversations
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
          fetch(`https://ryujin-os.vercel.app/api/ghl?action=notes&id=${cid}`)
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
  // - googleAds: CSV enrichment via enrich-ads.js (until Google Ads API is approved)
  // - gmail/calendar: pushed by Claude Code MCP sessions
  // - briefing_morning/briefing_evening: pushed by /api/agents/briefing cron
  // - watchdog: pushed by /api/agents/watchdog cron
  // - heartbeat: pushed by /api/agents/heartbeat cron
  // - tokenRefresh: pushed by daily.js when token auto-refresh fires
  // Without this list, the hourly snapshot rebuild WIPES these and the heartbeat dead-mans-switch
  // misfires (which is exactly what happened on 2026-04-11).
  const existing = await getSnapshot();
  const preserveKeys = [
    'metaAds', 'googleAds', 'gmail', 'calendar',
    'briefing_morning', 'briefing_evening',
    'watchdog', 'heartbeat', 'tokenRefresh',
    'cashflow',
    // Same bug pattern as 2026-04-11 (watchdog wipe) — daily.js writes
    // sections.agentReports.{daily,weekly}; without preservation the
    // hourly rebuild silently drops them and the morning briefing has
    // no anime-agent context to pull from.
    'agentReports', 'metaConfigAudit', 'tokenWarning',
    // Generator scheduler — weekly cron writes sections.generator with
    // draft/scheduled/posted counts so command-center can surface a tile
    // without re-querying marketing_clips. Preserve across hourly rebuild.
    'generator',
    // Inbox agent (migration 078) — every-20-min cron writes sections.inbox
    // with needsReview/notified/scanned counts + lastRun. Same wipe risk as
    // the others if omitted here.
    'inbox'
  ];
  if (existing?.sections) {
    for (const key of preserveKeys) {
      if (existing.sections[key] && !snapshot.sections[key]) {
        snapshot.sections[key] = existing.sections[key];
      }
    }
  }

  return snapshot;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Check if we have a cached snapshot
      let snapshot = await getSnapshot();

      // If no snapshot or older than 1 hour, build fresh
      if (!snapshot || !snapshot.updated_at ||
          (Date.now() - new Date(snapshot.updated_at).getTime() > 1 * 60 * 60 * 1000)) {
        snapshot = await buildFreshSnapshot();
        await saveSnapshot(snapshot);
      }

      return res.json(snapshot);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    // Agents POST partial updates to merge into the snapshot
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
