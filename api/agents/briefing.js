// Z Fighter Briefing Agent
// Schedule: 7:00 AM AT daily (morning), 5:00 PM AT daily (evening)
// Compiles agent reports + watchdog docket into a structured CEO briefing.
//
// Morning = CEO Ritual (Martell Perfect Week morning block):
//   1. KPI Scouter — key numbers at a glance
//   2. Pipeline Pulse — deals, revenue, stale leads
//   3. Ops Status — crew, tickets, blockers
//   4. Comms Inbox — unread, leads, watchdog docket
//   5. Today's Top 3 — the only 3 things that matter today
//
// Evening = Wrap-up (what happened, what's pending, tomorrow prep)
//
// Query param: ?type=morning|evening (default: morning)

import { runVegeta, runPiccolo, runKrillin, fetchJSON } from './_shared.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { calendarList, gmailSend } from '../../lib/google.js';
import { buildMetaAdsSnapshot } from '../../lib/meta.js';
import { fetchMetaYesterday, reconcileYesterday, computeCacRoas } from '../../lib/marketingPulse.js';
import { pendingConversations, importantUnreadEmails, carryforwardFromSnapshot } from '../../lib/eaContext.js';
import { runSystemsCheck } from '../../lib/systemsCheck.js';
import { buildBriefMarkdown } from '../../lib/briefMarkdown.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';

const BASE_URL = 'https://ryujin-os.vercel.app';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  // Vercel cron strips query strings, so ?type=morning/evening from vercel.json doesn't reach us.
  // Detect by Atlantic Time hour: 4 AM – 1:59 PM AT → morning, 2 PM – 3:59 AM AT → evening.
  // Manual triggers can still override via explicit ?type= param.
  const now = new Date();
  // Atlantic Time is UTC-3 in DST (March-Nov), UTC-4 otherwise. Approximate as UTC-3 for now.
  const hourAT = (now.getUTCHours() + 24 - 3) % 24;
  const inferredType = hourAT < 14 ? 'morning' : 'evening';
  const type = req.query?.type || inferredType;
  const startTime = Date.now();
  console.log(`[Z Fighter Briefing] Generating ${type} briefing...`);

  const errors = [];

  // Refresh Meta Ads data before agents run (same as daily.js)
  try {
    const metaAds = await buildMetaAdsSnapshot();
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({ metaAds })
    });
    console.log(`[Z Fighter Briefing] Meta Ads refreshed — ${metaAds.activeCampaignCount} active`);
  } catch (e) {
    errors.push(`Meta refresh: ${e.message}`);
  }

  // Run agents + fetch snapshot + today's calendar in parallel
  let vegeta, piccolo, krillin, snapshot, todayEvents;
  try {
    // Build today's time range in Atlantic Time (UTC-3 in DST).
    // AT midnight = 3:00 UTC. Today's window in UTC = today 3 AM → tomorrow 3 AM.
    const now = new Date();
    const atNow = new Date(now.getTime() - 3 * 3600 * 1000);
    const todayAT = new Date(Date.UTC(atNow.getUTCFullYear(), atNow.getUTCMonth(), atNow.getUTCDate()));
    const todayStart = new Date(todayAT.getTime() + 3 * 3600 * 1000);
    const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000);

    [vegeta, piccolo, krillin, snapshot, todayEvents] = await Promise.all([
      runVegeta().catch(e => { errors.push(`Vegeta: ${e.message}`); return null; }),
      runPiccolo().catch(e => { errors.push(`Piccolo: ${e.message}`); return null; }),
      runKrillin().catch(e => { errors.push(`Krillin: ${e.message}`); return null; }),
      fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders()).catch(() => null),
      calendarList(todayStart.toISOString(), todayEnd.toISOString()).catch(e => {
        errors.push(`Calendar: ${e.message}`);
        return null;
      })
    ]);
  } catch (e) {
    errors.push(`Agent runner failed: ${e.message}`);
  }

  // Pull live GHL/Automator sales tasks (these are CEO-priority and must be in every briefing)
  let ghlTasks = null;
  try {
    const tr = await fetch(`${BASE_URL}/api/ghl?mode=tasks`, { headers: { 'x-tenant-id': 'plus-ultra', ...((process.env.RYUJIN_SERVICE_TOKEN || '').trim() ? { Authorization: `Bearer ${(process.env.RYUJIN_SERVICE_TOKEN || '').trim()}` } : {}) } });
    if (tr.ok) ghlTasks = await tr.json();
  } catch (e) {
    errors.push(`GHL tasks fetch failed: ${e.message}`);
  }

  // Compile all recommendations across agents
  const allRecommendations = [];

  // GHL sales tasks ALWAYS go in first as top_priority (overdue first, then due-soon)
  if (ghlTasks?.tasks?.length) {
    const sortedTasks = [...ghlTasks.tasks].sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
    for (const t of sortedTasks) {
      const dueLabel = t.overdue ? 'OVERDUE' : (t.dueSoon ? 'due today' : (t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''));
      allRecommendations.push({
        agent: 'Vegeta',
        title: `${t.overdue ? '🔴 ' : '🟡 '}Sales task: ${t.title}${t.contactName ? ' — ' + t.contactName : ''}`,
        description: `${dueLabel}${t.body ? ' · ' + t.body.slice(0, 120) : ''}`,
        priority: t.overdue ? 'top_priority' : 'high',
        _isSalesTask: true
      });
    }
  }

  // Then agent recommendations
  for (const report of [vegeta, piccolo, krillin].filter(Boolean)) {
    for (const task of (report.tasks || [])) {
      allRecommendations.push({ agent: report.agent, ...task });
    }
  }

  // Sort by priority: top_priority > high > normal. Within same priority, sales tasks first.
  const priorityOrder = { top_priority: 0, high: 1, normal: 2 };
  allRecommendations.sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 3;
    const pb = priorityOrder[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a._isSalesTask !== b._isSalesTask) return a._isSalesTask ? -1 : 1;
    return 0;
  });

  // Pull watchdog docket from snapshot
  const watchdog = snapshot?.sections?.watchdog || null;
  const docketItems = watchdog?.docketItems || [];

  // ── BUILD STRUCTURED BRIEFING ──
  const briefing = {
    type,
    timestamp: new Date().toISOString(),
    duration: `${Date.now() - startTime}ms`,

    // ① KPI SCOUTER — the numbers that matter
    kpiScouter: {
      signedRevenue: vegeta?.estimatorStats?.signedRevenue || 0,
      pendingRevenue: vegeta?.estimatorStats?.pendingRevenue || 0,
      openDeals: vegeta?.stats?.open || 0,
      staleLeads: vegeta?.staleLeads || 0,
      overdueTickets: piccolo?.stats?.overdueCount || 0,
      unreadMessages: krillin?.stats?.unreadCount || 0,
      adROI: vegeta?.adROI?.ratio || null,
    },

    // ② PIPELINE PULSE
    pipeline: vegeta ? {
      openDeals: vegeta.stats?.open || 0,
      totalValue: vegeta.stats?.totalValue || 0,
      staleLeads: vegeta.staleLeads || 0,
      pendingRevenue: vegeta.estimatorStats?.pendingRevenue || 0,
      signedRevenue: vegeta.estimatorStats?.signedRevenue || 0,
      proposalsSent: vegeta.estimatorStats?.proposalsSent || 0,
      highValueDeals: vegeta.findings?.filter(f => f.includes('$10K'))?.length || 0
    } : null,

    // ③ OPS STATUS
    operations: piccolo ? {
      totalTickets: piccolo.stats?.totalTickets || 0,
      overdueCount: piccolo.stats?.overdueCount || 0,
      byStatus: piccolo.stats?.byStatus || {},
      byAssignee: piccolo.stats?.byAssignee || {},
      acceptedAwaitingCrew: piccolo.findings?.filter(f => f.includes('accepted proposals'))?.length || 0
    } : null,

    // ④ COMMS & INBOX
    comms: {
      unreadMessages: krillin?.stats?.unreadCount || 0,
      newWebLeads: (krillin?.findings || []).some(f => f.includes('new leads')),
      metaAdsAlerts: (krillin?.findings || []).some(f => f.includes('Meta Ads')),
      // Watchdog docket — tier 2 items from email scans
      emailDocket: docketItems.length > 0 ? {
        count: docketItems.length,
        items: docketItems.slice(0, 10),
        lastWatchdogRun: watchdog?.lastRun || null
      } : null
    },

    // ⑤ TODAY'S CALENDAR (sorted by start time)
    calendar: todayEvents?.items?.length > 0 ? todayEvents.items
      .map(e => ({
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date || null,
        end: e.end?.dateTime || e.end?.date || null,
        location: e.location || null
      }))
      .sort((a, b) => {
        const ta = a.start ? new Date(a.start).getTime() : 0;
        const tb = b.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      }) : [],

    // ⑥ TODAY'S TOP 3 — distilled from all findings
    // Pick the top 3 most impactful actions (Martell: "What are the 3 things
    // that if I do today, everything else becomes easier or unnecessary?")
    top3: allRecommendations.slice(0, 3).map((r, i) => ({
      rank: i + 1,
      action: r.title,
      agent: r.agent,
      priority: r.priority,
      context: r.description
    })),

    // Full findings for reference
    allFindings: [
      ...(vegeta?.findings || []),
      ...(piccolo?.findings || []),
      ...(krillin?.findings || [])
    ],

    // Full action list (beyond top 3)
    allActions: allRecommendations.slice(0, 10),

    errors
  };

  // Push briefing to snapshot so Ryujin chat can reference it.
  // NOTE: We push BEFORE SMS dispatch (so even if SMS dies, the briefing survives),
  // and then push a small follow-up update with smsSent + errors AFTER SMS attempt.
  // Auth: snapshotHeaders() carries RYUJIN_SERVICE_TOKEN. Without it this POST 401s
  // silently against the gated /api/snapshot, defeating the safety-net design.
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        [`briefing_${type}`]: {
          timestamp: briefing.timestamp,
          kpiScouter: briefing.kpiScouter,
          top3: briefing.top3,
          calendar: briefing.calendar,
          pipeline: briefing.pipeline,
          operations: briefing.operations,
          comms: briefing.comms,
          smsSent: false,  // updated below after SMS dispatch
          smsError: null
        }
      })
    });
  } catch (e) {
    errors.push(`Snapshot push failed: ${e.message}`);
  }

  // ── EMAIL DELIVERY (morning only — replaces SMS) ──
  // Pull EA context, marketing pulse, systems check, then build markdown brief.
  let emailSent = false;
  let briefMarkdown = null;
  let briefStatus = null;

  if (type === 'morning') {
    const [pulseCampaigns, reconcile, pendingConvs, unreadEmails, systems] = await Promise.all([
      fetchMetaYesterday().catch(e => { errors.push(`Meta yesterday: ${e.message}`); return null; }),
      reconcileYesterday().catch(e => { errors.push(`Reconcile: ${e.message}`); return null; }),
      pendingConversations().catch(e => { errors.push(`Pending convs: ${e.message}`); return null; }),
      importantUnreadEmails().catch(e => { errors.push(`Unread emails: ${e.message}`); return null; }),
      runSystemsCheck().catch(e => { errors.push(`Systems: ${e.message}`); return null; })
    ]);

    // Map per-source data into the brief's bySource shape
    const bySource = (pulseCampaigns || []).filter(c => c.status === 'ACTIVE').map(c => {
      const cpl = c.leads > 0 ? c.spend / c.leads : null;
      let flag = '🟢';
      if (cpl == null && c.spend > 0) flag = '🟡';
      else if (cpl != null && cpl > 30) flag = '🟡';
      else if (cpl != null && cpl > 50) flag = '🔴';
      const shortName = c.name
        .replace(/Hey Moncton Homeowners-?\s*/i, '')
        .replace(/if it's been 20 years-?\s*/i, '')
        .replace(/\s*-?\s*(Campaign|Ad Set|Leads|bookings)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 14);
      return { name: shortName || c.name.slice(0, 14), spend: c.spend, leads: c.leads, flag };
    });
    const totalSpend = bySource.reduce((s, c) => s + c.spend, 0);
    const totalLeads = bySource.reduce((s, c) => s + c.leads, 0);

    // Top 3: prefer carryforward from yesterday's session, else top-priority recommendations
    const carry = carryforwardFromSnapshot(snapshot);
    const top3 = carry.length > 0
      ? carry.slice(0, 3).map(item => typeof item === 'string' ? item : item.title || item.action || JSON.stringify(item))
      : allRecommendations.slice(0, 3).map(r => r.title);

    // Pipeline pulse from snapshot.revenue
    const rev = snapshot?.sections?.revenue || {};
    const byStatus = rev.byStatus || {};
    const pipeline = {
      drafts: byStatus['Estimate Draft'] ?? null,
      quoteSent: vegeta?.stats?.open ?? null,
      quoteSentValue: vegeta?.stats?.totalValue ?? null,
      accepted: byStatus['Proposal Accepted'] ?? null,
      ready: byStatus['Proposal Ready'] ?? 0
    };

    const briefCtx = {
      calendar: briefing.calendar,
      top3,
      pendingConvs,
      unreadEmails,
      pulse: {
        spendYesterday: totalSpend,
        leadsYesterday: totalLeads,
        roas30d: null,
        cac7d: null,
        bySource
      },
      reconcile,
      systems,
      pipeline,
      newSinceYesterday: reconcile?.ghlNewContacts ?? null,
      activeConvs24h: null
    };

    const built = buildBriefMarkdown(briefCtx);
    briefMarkdown = built.markdown;
    briefStatus = built.status;

    // Email delivery disabled per owner directive 2026-05-12 — briefing lives in
    // snapshot + admin dashboard only. Re-enable by removing the OWNER_BRIEFING_EMAIL_MUTED gate.
    if (process.env.OWNER_BRIEFING_EMAIL_MUTED !== '1') {
      try {
        const subject = `Daily Brief — ${built.dateLabel} · ${built.status === 'red' ? '🔴' : built.status === 'yellow' ? '🟡' : '🟢'}`;
        await gmailSend('mackenzie.m@plusultraroofing.com', subject, briefMarkdown);
        emailSent = true;
      } catch (e) {
        errors.push(`Email delivery failed: ${e.message}`);
      }
    }
  }

  briefing.emailSent = emailSent;
  briefing.briefMarkdown = briefMarkdown;
  briefing.briefStatus = briefStatus;

  // Update snapshot with the brief markdown so the local vault-writer can pull it.
  try {
    await fetch(`${BASE_URL}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({
        [`briefing_${type}`]: {
          timestamp: briefing.timestamp,
          kpiScouter: briefing.kpiScouter,
          top3: briefing.top3,
          calendar: briefing.calendar,
          pipeline: briefing.pipeline,
          operations: briefing.operations,
          comms: briefing.comms,
          briefMarkdown,
          briefStatus,
          emailSent,
          errors: errors.length > 0 ? errors : null
        }
      })
    });
  } catch (e) {
    console.error(`[Briefing] Final snapshot update failed: ${e.message}`);
  }

  console.log(`[Z Fighter Briefing] ${type} complete — ${allRecommendations.length} actions, email: ${emailSent}, status: ${briefStatus}`);

  res.json(briefing);
}
