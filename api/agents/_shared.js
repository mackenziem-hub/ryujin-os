// EA Agent Shared Logic (formerly Z Fighters)
// Each agent function exported individually:
// 1. Individual endpoints (GET /api/agents/sales — alias for vegeta)
// 2. Daily/weekly batch runners (GET /api/agents/daily)
// 3. Chat tool calls (run_agent tool via GET /api/agents/[name])
//
// Anime names retained as primary internal identifiers for git/log compatibility.
// New EA-style aliases exported below for cleaner external use.

import { calculateQuote } from './_quoteEngine.js';
import { fetchAdData, analyzeAdPerformance } from './_adData.js';
import { gmailSend } from '../../lib/google.js';
import { runCashflow } from './cashflow.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { AGENT_NAMES } from './_names.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { leadNotifyConfig } from '../../lib/inboxWatches.js';
import { notifyLeadEvent } from '../../lib/leadNotify.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';

// Won / signed stages across all pipelines (human names from
// api/ghl.js PIPELINE_STAGES). enrichOpportunity maps an opp's stage id to
// these names, so the daily pipeline scan can detect a deal that landed in a
// signed stage by ANY path, including a manual GHL drag with no proposal
// acceptance. Lowercased for a case-insensitive compare.
const WON_STAGE_NAMES = new Set([
  'contract signed',
  'client signed',
  'approved',
  'closed',
]);

// Resolve the plus-ultra tenant id + lead-notify config once per scan. Best
// effort: a lookup failure returns nulls and the notify blocks no-op rather
// than throwing into the sales report.
async function resolveLeadNotifyContext() {
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', PLUS_ULTRA_SLUG).maybeSingle();
    const tenantId = tenant?.id || null;
    let cfg = {};
    if (tenantId) {
      const { data: settings } = await supabaseAdmin
        .from('tenant_settings').select('inbox_config').eq('tenant_id', tenantId).maybeSingle();
      cfg = settings?.inbox_config || {};
    }
    return { tenantId, ...leadNotifyConfig(cfg) };
  } catch (e) {
    console.warn('[Vegeta] lead-notify context resolve failed:', e.message);
    return { tenantId: null, ...leadNotifyConfig({}) };
  }
}

const BASE_URL = 'https://ryujin-os.vercel.app';

// Service-token headers so agent self-calls pass the now-gated /api/ghl + /api/snapshot.
// resolveSession maps RYUJIN_SERVICE_TOKEN to a synthetic admin session scoped to x-tenant-id.
function svcHeaders() {
  const t = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
  return { 'x-tenant-id': 'plus-ultra', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export async function fetchJSON(url, headers = {}) {
  // Cache-bust to defeat Vercel edge caching that otherwise serves stale snapshot
  // data (discovered 2026-04-11 — agents were reading stale metaAds even after
  // /api/snapshot POST writes succeeded). Adding ?_t= bypasses the edge cache.
  const sep = url.includes('?') ? '&' : '?';
  const bustedUrl = `${url}${sep}_t=${Date.now()}`;
  const resp = await fetch(bustedUrl, { headers: { ...svcHeaders(), ...headers }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  return resp.json();
}

// Email-based fallback for agent crashes/alerts. Default channel — user prefers email.
// White-label: no hardcoded recipient fallback. NOTIFY_EMAIL is set in Vercel env
// for the live deployment; if it is ever missing we skip-and-log instead of
// silently mailing tenant #1's owner from someone else's deployment.
const NOTIFY_EMAIL = (process.env.NOTIFY_EMAIL || '').trim();
export async function sendFallbackEmail(subject, body) {
  if (!NOTIFY_EMAIL) { console.error('[Fallback Email] NOTIFY_EMAIL not set; skipping'); return; }
  try {
    await gmailSend(NOTIFY_EMAIL, `[Ryujin Agent] ${subject}`, body);
  } catch (e) { console.error(`[Fallback Email] Failed: ${e.message}`); }
}

// SMS fallback retained for true emergencies (heartbeat dead-man) where email infra may also be down.
const GHL_BASE_SMS = 'https://services.leadconnectorhq.com';
const MACKENZIE_CONTACT = '02IhxZfSwZZAZ2fooVGu';
// Returns {ok, error} so dead-man callers (heartbeat) can report which
// transports actually fired; null = muted or unconfigured (silent by design).
// Existing callers that ignore the return are unaffected.
export async function sendFallbackSMS(message) {
  if (process.env.OWNER_SMS_MUTED === '1') { console.log('[Fallback SMS] muted via OWNER_SMS_MUTED'); return null; }
  const token = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
  if (!token) return null;
  try {
    const resp = await fetch(`${GHL_BASE_SMS}/conversations/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Version': '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId: MACKENZIE_CONTACT, message }),
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error(`[Fallback SMS] GHL ${resp.status}: ${txt.slice(0, 120)}`);
      return { ok: false, error: `GHL ${resp.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[Fallback SMS] Failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ===== VEGETA: Sales & Pipeline =====
export async function runVegeta() {
  const report = { agent: AGENT_NAMES.vegeta.displayName, role: 'Sales & Pipeline', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  const pipeline = await fetchJSON(`${BASE_URL}/api/ghl?mode=pipeline&limit=100`);
  if (pipeline.error) { report.findings.push(`Pipeline fetch failed: ${pipeline.error}`); return report; }

  const opps = pipeline.opportunities || [];
  const open = opps.filter(o => o.status === 'open');
  const today = new Date();

  report.stats = {
    totalOpportunities: pipeline.stats?.total || opps.length,
    open: open.length,
    totalValue: opps.reduce((s, o) => s + (o.value || 0), 0)
  };

  // Lead-notify context (tenant id + owner-tunable thresholds). One resolve
  // shared by the cold-lead scan and the won stage-diff below.
  const notifyCtx = await resolveLeadNotifyContext();
  const COLD_DAYS = notifyCtx.cold_lead_days; // default 4 (was hardcoded 3)

  // Stale leads (no status change in COLD_DAYS+). Threshold is now config-driven.
  const stale = open.filter(o => {
    if (!o.lastStatusChange) return false;
    const days = (today - new Date(o.lastStatusChange)) / (1000 * 60 * 60 * 24);
    return days >= COLD_DAYS;
  });
  report.staleLeads = stale.length;
  if (stale.length > 0) {
    report.findings.push(`${stale.length} leads stale ${COLD_DAYS}+ days: ${stale.slice(0, 5).map(o => `${o.name} (${o.stage})`).join(', ')}`);
    // Keep the existing rollup-task behavior (>= 3 stale leads -> one task).
    if (stale.length >= 3) {
      report.tasks.push({ title: `Follow up on ${stale.length} stale pipeline leads`, description: `Stale leads: ${stale.map(o => `${o.name} — ${o.stage} — last activity ${o.lastStatusChange}`).join('\n')}`, priority: 'high' });
    }
    // Per-lead "going cold" notification (email + inbox ping, no SMS). The
    // dedupeKey is bucketed to a coarse ~7-day window keyed off the lead's own
    // lastStatusChange, so the SAME cold lead does not re-alert on every daily
    // scan; it only re-pings if it is STILL cold a week later (a new bucket).
    let coldNotified = 0;
    for (const o of stale) {
      if (!o.id) continue;
      // Only alert on leads that RECENTLY crossed cold (within a few days of the
      // threshold), not the entire long-stale backlog. Without this the first run
      // dumps a notification for every old stale lead at once. The deep backlog is
      // the post-estimate review list's job, not a fresh "going cold" ping.
      const coldAgeDays = (today - new Date(o.lastStatusChange)) / (1000 * 60 * 60 * 24);
      if (!(coldAgeDays >= 0) || coldAgeDays > COLD_DAYS + 3) continue;
      const anchorMs = new Date(o.lastStatusChange || today).getTime() || today.getTime();
      const weekBucket = Math.floor(anchorMs / (7 * 24 * 60 * 60 * 1000));
      const res = await notifyLeadEvent({
        tenantId: notifyCtx.tenantId,
        event: 'cold_lead',
        title: `Lead going cold · ${o.name || 'Unnamed lead'}`,
        body: [
          `${o.name || 'A lead'} has had no pipeline movement in ${COLD_DAYS}+ days.`,
          '',
          `Stage:        ${o.stage || 'unknown'}`,
          `Pipeline:     ${o.pipeline || 'unknown'}`,
          `Value:        ${o.value ? '$' + Number(o.value).toLocaleString() : 'n/a'}`,
          `Last change:  ${o.lastStatusChange || 'unknown'}`,
          '',
          'Ryujin OS',
        ].join('\n'),
        contactName: o.name || null,
        urgency: 'normal',
        dedupeKey: `${o.id}@${weekBucket}`,
        sms: false,
      });
      if (res.inboxInserted) coldNotified++;
    }
    report.coldLeadAlerts = coldNotified;
  }

  // ── Event 4 (manual GHL close detection): won/signed stage scan ──
  // A deal dragged into a signed/won stage in GHL (no proposal acceptance on a
  // Ryujin /p/ page) fires nothing today. Scan ALL opps (open + closed) for a
  // signed-stage landing and fire a won notification with an SMS. Idempotency
  // is the inbox_items unique constraint via the dedupeKey. The key is the GHL
  // opportunity id (event:won + oppId), so a deal fires its won notification
  // EXACTLY once across BOTH this scan AND the proposal-accept path: the accept
  // handlers key the won event on the SAME ghl_opportunity_id when they have
  // it, so an accept that already pinged makes this scan a no-op for that deal
  // (and vice versa). A deal already sitting in a signed stage when this ships
  // fires one backfill notification, then never again.
  try {
    let wonNotified = 0;
    for (const o of opps) {
      if (!o.id) continue;
      const stageName = String(o.stage || '').trim().toLowerCase();
      if (!WON_STAGE_NAMES.has(stageName)) continue;
      // Recency guard: only notify on a deal that entered a signed stage RECENTLY.
      // Without this, the first scan would backfill a won alert (with SMS) for every
      // historical signed deal at once. lastStatusChange is when the opp last moved
      // stages; a real new close lands inside the window and fires exactly once
      // (deduped on oppId). Deals signed long ago never alert.
      if (!o.lastStatusChange) continue;
      const wonAgeDays = (today - new Date(o.lastStatusChange)) / (1000 * 60 * 60 * 24);
      if (!(wonAgeDays >= 0) || wonAgeDays > 14) continue;
      const res = await notifyLeadEvent({
        tenantId: notifyCtx.tenantId,
        event: 'won',
        title: `Deal signed · ${o.name || 'Customer'}${o.value ? ' · $' + Number(o.value).toLocaleString() : ''}`,
        body: [
          `${o.name || 'A deal'} is now in a signed stage in GHL.`,
          '',
          `Stage:     ${o.stage || 'unknown'}`,
          `Pipeline:  ${o.pipeline || 'unknown'}`,
          `Value:     ${o.value ? '$' + Number(o.value).toLocaleString() : 'n/a'}`,
          '',
          'Detected from the pipeline scan (manual close or proposal acceptance).',
          '',
          'Ryujin OS',
        ].join('\n'),
        contactName: o.name || null,
        urgency: 'high',
        dedupeKey: o.id,
        sms: true,
      });
      if (res.inboxInserted) wonNotified++;
    }
    report.wonStageAlerts = wonNotified;
  } catch (e) {
    report.findings.push(`Won stage scan failed: ${e.message}`);
  }

  // High-value open deals
  const highValue = open.filter(o => (o.value || 0) >= 10000);
  if (highValue.length > 0) {
    report.findings.push(`${highValue.length} deals over $10K: ${highValue.map(o => `${o.name} ($${o.value})`).join(', ')}`);
  }

  // Estimator stats
  const stats = await fetchJSON(`${BASE_URL}/api/lookup?mode=stats`, snapshotHeaders());
  const estStats = stats.results?.find(r => r.source === 'Estimator OS');
  if (estStats?.stats) {
    report.estimatorStats = {
      totalEstimates: estStats.stats.totalEstimates,
      pendingRevenue: estStats.stats.pendingRevenue,
      signedRevenue: estStats.stats.signedRevenue,
      proposalsSent: estStats.stats.proposalsSent
    };
  }

  report.findings.push(`Pipeline: ${open.length} open opportunities`);
  report.findings.push(`Revenue: $${report.estimatorStats?.pendingRevenue || 0} pending, $${report.estimatorStats?.signedRevenue || 0} signed`);

  // Ad spend vs SIGNED revenue ROI (not pipeline value — pipeline includes test/lost data)
  const adData = await fetchAdData();
  if (adData.combined && adData.combined.totalAdSpend > 0) {
    const signedRev = report.estimatorStats?.signedRevenue || 0;
    const adSpend = adData.combined.totalAdSpend;
    const roi = signedRev > 0 ? Math.round(signedRev / adSpend) : 0;
    report.adROI = { adSpend, signedRevenue: signedRev, ratio: `${roi}:1` };
    report.findings.push(`Ad spend: $${adSpend} total. Signed revenue: $${signedRev}. ROI ratio: ${roi}:1`);
  }

  // ── AD DATA FRESHNESS ALARM ──
  // If snapshot.sections.metaAds is missing or older than 3 days, Vegeta is flying blind.
  // No ad data = no way to detect paused campaigns, no way to track CPL, no early warning.
  // This must be top_priority because a stale ad feed is how we missed the lead-flow stoppage.
  try {
    const snapshot = await fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders());
    const metaAds = snapshot?.sections?.metaAds;
    if (!metaAds) {
      report.findings.push(`🚨 Meta Ads section MISSING from snapshot — ad performance is invisible.`);
      report.tasks.push({
        title: `🚨 Meta Ads data missing — Ryujin is blind to ad performance`,
        description: `snapshot.sections.metaAds is not populated. The sales agent cannot detect paused campaigns, high CPL, or budget issues. Action: re-enrich the snapshot from the Meta CSV in Plus Ultra/Marketing/Facebook Ads Export/, or wire up live Meta Ads API.`,
        priority: 'top_priority'
      });
    } else {
      const exportDate = metaAds.exportDate ? new Date(metaAds.exportDate) : null;
      const ageDays = exportDate ? Math.floor((Date.now() - exportDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
      report.adDataAge = { exportDate: metaAds.exportDate, ageDays };
      if (ageDays === null || ageDays > 3) {
        report.findings.push(`🚨 Meta Ads data is ${ageDays === null ? 'undated' : ageDays + ' days'} old — refresh the snapshot.`);
        report.tasks.push({
          title: `🚨 Meta Ads data stale (${ageDays === null ? 'no date' : ageDays + ' days'}) — refresh immediately`,
          description: `Last Meta Ads export was ${metaAds.exportDate || 'unknown'}. Stale ad data caused us to miss the recent lead-flow stoppage. Re-export from Meta Ads Manager and push to /api/snapshot, or wire live API.`,
          priority: 'top_priority'
        });
      }
    }
  } catch (e) {
    report.findings.push(`Ad data freshness check failed: ${e.message}`);
  }

  return report;
}

// ===== PICCOLO: Operations & Crew =====
export async function runPiccolo() {
  const report = { agent: AGENT_NAMES.piccolo.displayName, role: 'Operations & Crew', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  const stats = await fetchJSON(`${BASE_URL}/api/lookup?mode=stats`, snapshotHeaders());
  const ticketStats = stats.results?.find(r => r.source === 'Crew Tickets' || r.source === 'Action Board');

  if (ticketStats?.stats) {
    report.stats = {
      totalTickets: ticketStats.stats.totalTickets,
      // totalOpen = open + active, THE number the cockpit and load-scan report
      totalOpen: ticketStats.stats.totalOpen,
      byStatus: ticketStats.stats.byStatus,
      overdueCount: ticketStats.stats.overdueCount,
      byAssignee: ticketStats.stats.byAssignee
    };

    if (ticketStats.stats.overdueCount > 0) {
      report.findings.push(`${ticketStats.stats.overdueCount} overdue tickets`);
      report.tasks.push({ title: `Address ${ticketStats.stats.overdueCount} overdue crew tickets`, description: `Overdue tickets need attention. Check the crew board (admin.html#crew) for details.`, priority: 'top_priority' });
    }

    const assignees = ticketStats.stats.byAssignee || {};
    const loads = Object.entries(assignees).filter(([k]) => k !== 'Unassigned');
    if (loads.length >= 2) {
      const max = Math.max(...loads.map(([, v]) => v));
      const min = Math.min(...loads.map(([, v]) => v));
      if (max - min >= 3) {
        report.findings.push(`Workload imbalance: ${loads.map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      }
    }

    const unassigned = assignees['Unassigned'] || 0;
    if (unassigned > 0) {
      report.findings.push(`${unassigned} unassigned tickets`);
      report.tasks.push({ title: `Assign ${unassigned} unassigned crew tickets`, description: `Tickets need crew assignment.`, priority: 'high' });
    }
  }

  const estData = await fetchJSON(`${BASE_URL}/api/lookup?source=estimates`, snapshotHeaders());
  const accepted = (estData.results?.[0]?.data || []).filter(e => e.status === 'Proposal Accepted');
  if (accepted.length > 0) {
    report.findings.push(`${accepted.length} accepted proposals — verify crew tickets exist`);
  }

  return report;
}

// ===== KRILLIN: Comms & Marketing =====
export async function runKrillin() {
  const report = { agent: AGENT_NAMES.krillin.displayName, role: 'Comms & Marketing', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  const convos = await fetchJSON(`${BASE_URL}/api/ghl?mode=conversations&limit=30`);
  if (convos.conversations) {
    const list = convos.conversations;
    const now = Date.now();
    const awaitingReply = list.filter(c => {
      if (c.unread > 0) return true;
      const lastInbound = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0;
      const lastOutbound = c.lastOutboundAt ? new Date(c.lastOutboundAt).getTime() : 0;
      return lastInbound > lastOutbound && (now - lastInbound) < 72 * 3600 * 1000;
    });
    const stale = awaitingReply.filter(c => {
      const last = c.lastInboundAt ? new Date(c.lastInboundAt).getTime() : 0;
      return last > 0 && (now - last) > 4 * 3600 * 1000;
    });
    report.stats = {
      recentConversations: list.length,
      awaitingReplyCount: awaitingReply.length,
      staleOver4hCount: stale.length
    };
    report.conversations = awaitingReply.slice(0, 10).map(c => ({
      contactName: c.contactName || 'Unknown',
      contactId: c.contactId,
      lastMessage: (c.lastMessageBody || '').slice(0, 140),
      lastInboundAt: c.lastInboundAt,
      hoursSince: c.lastInboundAt ? Math.round((now - new Date(c.lastInboundAt).getTime()) / 3600000) : null
    }));
    if (awaitingReply.length > 0) {
      const names = awaitingReply.slice(0, 5).map(c => c.contactName || 'Unknown').join(', ');
      report.findings.push(`${awaitingReply.length} conversations awaiting reply (${stale.length} stale >4h): ${names}`);
      report.tasks.push({ title: `Reply to ${awaitingReply.length} GHL conversations`, description: `Awaiting your reply: ${names}${awaitingReply.length > 5 ? '...' : ''}`, priority: stale.length > 0 ? 'high' : 'medium' });
    }
  }

  // ── LEAD-FLOW ALARM (with root-cause detection) ──
  // Uses snapshot lead data (already filtered: local, real source, no junk)
  // Priority order: (1) payment failure in Gmail, (2) ads paused/broken, (3) normal low week.
  let krillinSnapshot = null;
  try {
    try {
      krillinSnapshot = await fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders());
    } catch (e) { /* snapshot fetch optional */ }

    const leadData = krillinSnapshot?.sections?.leads || {};
    const thisWeek = leadData.thisWeek ?? null;
    const outOfArea = leadData.outOfAreaThisWeek || 0;
    report.leadFlow = {
      thisWeek,
      total: leadData.total || 0,
      converted: leadData.converted || 0,
      conversionRate: leadData.conversionRate || 0,
      outOfArea,
      source: 'GHL (local + filtered)'
    };

    if (outOfArea > 0) {
      report.findings.push(`${outOfArea} out-of-area leads this week — geo targeting leak`);
    }

    // Check for billing/payment failure emails in watchdog docket
    let billingFailureDetected = false;
    let billingDetail = '';
    try {
      const docket = krillinSnapshot?.watchdog?.docketItems || [];
      const billingEmails = docket.filter(item => {
        const reasons = (item.reasons || []).join(' ').toLowerCase();
        const subject = (item.subject || '').toLowerCase();
        const from = (item.from || '').toLowerCase();
        return (
          subject.includes('payment') || subject.includes('billing') ||
          subject.includes('past due') || subject.includes('declined') ||
          subject.includes('suspended') || subject.includes('charge failed') ||
          from.includes('facebook') || from.includes('facebookmail') ||
          from.includes('meta') || from.includes('google payments') ||
          from.includes('ads-noreply')
        ) && (
          subject.includes('fail') || subject.includes('declined') ||
          subject.includes('past due') || subject.includes('suspend') ||
          subject.includes('payment') || subject.includes('billing')
        );
      });
      if (billingEmails.length > 0) {
        billingFailureDetected = true;
        billingDetail = billingEmails.map(e => `${e.from}: ${e.subject}`).join('; ');
      }
    } catch (e) { /* snapshot check optional */ }

    if (thisWeek === 0) {
      if (billingFailureDetected) {
        // Root cause identified: billing failure
        report.findings.push(`🚨 ZERO leads this week — BILLING FAILURE detected: ${billingDetail}`);
        report.tasks.push({
          title: `🚨 ZERO leads — ad billing failure detected`,
          description: `GHL shows 0 new contacts this week. Root cause: billing/payment failure email found (${billingDetail}). Fix payment method in Meta Ads Manager and/or Google Ads immediately. Ads are offline until billing is resolved.`,
          priority: 'top_priority'
        });
      } else {
        // No billing email found — generic alarm
        report.findings.push(`🚨 ZERO new leads this week (GHL contacts). Lead flow stopped — check ad status.`);
        report.tasks.push({
          title: `🚨 ZERO leads this week — verify ads are running`,
          description: `GHL shows 0 new contacts for the current week. At current burn, pipeline dies in 2-4 weeks. Action: confirm Meta + Google Ads are active and not paused. Check Meta Ads Manager + Google Ads dashboard now.`,
          priority: 'top_priority'
        });
      }
    } else if (thisWeek <= 2) {
      report.findings.push(`⚠️ Only ${thisWeek} new lead${thisWeek === 1 ? '' : 's'} this week — well below normal.`);
      report.tasks.push({
        title: `⚠️ Lead flow low (${thisWeek} this week) — review ad performance`,
        description: `Only ${thisWeek} new leads from GHL this week. Normal range is 5+. Check ad spend, CPL, and active campaigns.`,
        priority: 'high'
      });
    }
  } catch (e) {
    report.findings.push(`Lead-flow check failed: ${e.message}`);
  }

  const voiceAI = await fetchJSON(`${BASE_URL}/api/ghl?mode=pipeline&pipeline=nJqJ681y17CWjkCRzVhH`);
  const voiceOpps = voiceAI.opportunities || [];
  if (voiceOpps.length > 0) {
    report.findings.push(`${voiceOpps.length} Voice AI pipeline entries`);
  }

  // Ad performance alerts
  const adData = await fetchAdData();
  const adAnalysis = analyzeAdPerformance(adData);
  report.findings.push(...adAnalysis.findings);
  report.tasks.push(...adAnalysis.tasks);
  report.adPerformance = adData.combined || null;

  // Gmail urgents from enriched snapshot (reuse krillinSnapshot if available)
  const snapshot = krillinSnapshot || await fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders());
  if (snapshot?.sections?.gmail?.urgentUnread) {
    const urgent = snapshot.sections.gmail.urgentUnread;
    if (urgent.length > 0) {
      report.findings.push(`${urgent.length} urgent emails: ${urgent.map(u => `${u.from} — ${u.type}`).join('; ')}`);
      const actionRequired = urgent.filter(u => u.type === 'action_required' || u.type === 'failed_payment');
      if (actionRequired.length > 0) {
        report.tasks.push({ title: `Handle ${actionRequired.length} urgent emails`, description: actionRequired.map(u => `${u.from}: ${u.subject}`).join('\n'), priority: 'high' });
      }
    }
  }

  return report;
}

// ===== GOHAN: Game Dev & Product =====
export async function runGohan() {
  const report = { agent: AGENT_NAMES.gohan.displayName, role: 'Game Dev & Product', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  try {
    const gameResp = await fetch('https://pwa-six-iota.vercel.app', { method: 'HEAD' });
    report.gameOnline = gameResp.ok;
    report.findings.push(gameResp.ok ? 'Aetheria game: ONLINE' : 'Aetheria game: DOWN');
    if (!gameResp.ok) {
      report.tasks.push({ title: 'URGENT: Aetheria game is DOWN', description: `Game returned HTTP ${gameResp.status}`, priority: 'top_priority' });
    }
  } catch (e) {
    report.gameOnline = false;
    report.findings.push('Aetheria game: UNREACHABLE');
    report.tasks.push({ title: 'URGENT: Aetheria game unreachable', description: e.message, priority: 'top_priority' });
  }

  try {
    const hqResp = await fetch('https://pwa-hq.vercel.app', { method: 'HEAD' });
    report.hqOnline = hqResp.ok;
  } catch (e) {
    report.hqOnline = false;
  }

  // Dynamic game health check — Supabase player stats when available
  const gameHealth = { online: report.gameOnline, hqOnline: report.hqOnline };
  try {
    const snapshot = await fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders());
    if (snapshot?.sections?.aetheria) {
      gameHealth.players = snapshot.sections.aetheria.players || null;
      gameHealth.sessions = snapshot.sections.aetheria.sessions || null;
    }
  } catch (e) { /* snapshot enrichment optional */ }
  report.gameHealth = gameHealth;
  report.findings.push(`Game health: ${report.gameOnline ? 'ONLINE' : 'DOWN'} | HQ: ${report.hqOnline ? 'ONLINE' : 'DOWN'}`);

  return report;
}

// ===== TRUNKS: Security & Infrastructure =====
export async function runTrunks() {
  const report = { agent: AGENT_NAMES.trunks.displayName, role: 'Security & Infra', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  const apps = [
    { name: 'Aetheria Game', url: 'https://pwa-six-iota.vercel.app' },
    { name: 'Aetheria HQ', url: 'https://pwa-hq.vercel.app' },
    // Plus Ultra HQ removed 2026-06-12: decommissioned Apr 28 2026, the URL only
    // parks a redirect, so the HEAD ping was counting a dead app as healthy.
    { name: 'Ryujin OS', url: 'https://ryujin-os.vercel.app' }
  ];

  let appsOnline = 0;
  for (const app of apps) {
    try {
      const resp = await fetch(app.url, { method: 'HEAD', redirect: 'manual' });
      // 2xx = healthy, 3xx = redirect (also healthy — many apps redirect / to /index.html or /hq.html)
      if (resp.status >= 200 && resp.status < 400) {
        appsOnline++;
      } else {
        report.findings.push(`${app.name}: DOWN (HTTP ${resp.status})`);
        report.tasks.push({ title: `${app.name} is DOWN`, description: `${app.url} returned HTTP ${resp.status}`, priority: 'top_priority' });
      }
    } catch (e) {
      report.findings.push(`${app.name}: UNREACHABLE`);
      report.tasks.push({ title: `${app.name} is UNREACHABLE`, description: `${app.url} — ${e.message}`, priority: 'top_priority' });
    }
  }
  report.stats = { appsOnline, appsTotal: apps.length };
  report.findings.push(`Apps online: ${appsOnline}/${apps.length}`);

  const apiTests = [
    { name: 'Estimator OS', url: 'https://estimator-os.replit.app/api/stats', headers: { 'x-api-key': 'pu-estimator-2026' } },
    { name: 'Instant Estimator', url: 'https://plus-ultra-roof-estimator.replit.app/api/stats', headers: { 'x-api-key': 'pu-instantest-2026' } },
    // Cert defect 3 (2026-06-12): this check sent NO auth, so it 401'd against
    // the Jun 6 service gate and false-flagged GHL in every weekly report while
    // the proxy itself was healthy. svcHeaders() is the same Bearer +
    // x-tenant-id pair every authed internal caller uses.
    { name: 'GHL CRM', url: `${BASE_URL}/api/ghl?mode=pipeline&limit=1`, headers: svcHeaders() }
  ];

  let keysValid = 0;
  for (const test of apiTests) {
    try {
      const resp = await fetch(test.url, { headers: test.headers });
      if (resp.ok) {
        keysValid++;
      } else {
        report.findings.push(`${test.name} API: FAILED (HTTP ${resp.status})`);
        report.tasks.push({ title: `${test.name} API key may be invalid`, description: `Returned HTTP ${resp.status}. Check key.`, priority: 'high' });
      }
    } catch (e) {
      report.findings.push(`${test.name} API: ERROR — ${e.message}`);
    }
  }
  report.stats.keysValid = keysValid;
  report.stats.keysTotal = apiTests.length;
  report.findings.push(`API keys valid: ${keysValid}/${apiTests.length}`);

  return report;
}

// ===== BULMA: Intel & Analytics =====
export async function runBulma() {
  const report = { agent: AGENT_NAMES.bulma.displayName, role: 'Intel & Analytics', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  const [lookupStats, ghlOverview, ghlPipeline] = await Promise.all([
    fetchJSON(`${BASE_URL}/api/lookup?mode=stats`, snapshotHeaders()),
    fetchJSON(`${BASE_URL}/api/ghl`),
    fetchJSON(`${BASE_URL}/api/ghl?mode=pipeline&limit=100`)
  ]);

  const estStats = lookupStats.results?.find(r => r.source === 'Estimator OS')?.stats || {};
  const ticketStats = lookupStats.results?.find(r => r.source === 'Crew Tickets' || r.source === 'Action Board')?.stats || {};
  const leadStats = lookupStats.results?.find(r => r.source === 'Instant Estimator')?.stats || {};

  report.plusUltra = {
    estimates: {
      total: estStats.totalEstimates || 0,
      pendingRevenue: estStats.pendingRevenue || 0,
      signedRevenue: estStats.signedRevenue || 0,
      proposalsSent: estStats.proposalsSent || 0,
      accepted: estStats.awaitingSchedule || 0
    },
    tickets: {
      total: ticketStats.totalTickets || 0,
      overdue: ticketStats.overdueCount || 0,
      done: ticketStats.byStatus?.done || 0,
      byAssignee: ticketStats.byAssignee || {}
    },
    leads: {
      total: leadStats.totalLeads || 0,
      thisWeek: leadStats.thisWeek || 0,
      conversionRate: leadStats.conversionRate || 0
    },
    crm: {
      totalContacts: ghlOverview.totalContacts || 0,
      totalOpportunities: ghlOverview.totalOpportunities || 0,
      openOpportunities: ghlOverview.openOpportunities || 0,
      pipelineValue_NOT_REVENUE: ghlOverview.pipelineValue || 0,
      _note: 'pipelineValue is total of ALL GHL opportunities. Use estimates.signedRevenue for actual signed contracts. openOpportunities is a SAMPLE (open within the 10 most recent opps, max 10), not the global open count; never report it as total open pipeline.'
    }
  };

  const opps = ghlPipeline.opportunities || [];
  const byStage = {};
  const byPipeline = {};
  opps.forEach(o => {
    byStage[o.stage] = (byStage[o.stage] || 0) + 1;
    byPipeline[o.pipeline] = (byPipeline[o.pipeline] || 0) + 1;
  });
  report.pipelineBreakdown = { byStage, byPipeline };

  report.findings.push(`CRM: ${ghlOverview.totalContacts} contacts, ${ghlOverview.totalOpportunities} opportunities`);
  report.findings.push(`Revenue: $${estStats.pendingRevenue || 0} pending, $${estStats.signedRevenue || 0} signed`);
  report.findings.push(`Crew: ${ticketStats.totalTickets || 0} tickets, ${ticketStats.overdueCount || 0} overdue`);
  report.findings.push(`Leads: ${leadStats.totalLeads || 0} total, ${leadStats.thisWeek || 0} this week`);

  if ((ticketStats.overdueCount || 0) > 3) {
    report.findings.push(`WARNING: ${ticketStats.overdueCount} overdue tickets — crew falling behind`);
    report.tasks.push({ title: 'Crew has excessive overdue tickets', description: `${ticketStats.overdueCount} tickets overdue. Review workload.`, priority: 'high' });
  }

  if ((estStats.proposalsSent || 0) === 0) {
    report.findings.push('WARNING: Zero proposals sent this period. Pipeline may stall.');
    report.tasks.push({ title: 'No proposals sent — pipeline risk', description: 'Estimator OS shows 0 proposals sent. Check if quotes are being prepared.', priority: 'high' });
  }

  const snapshot = await fetchJSON(`${BASE_URL}/api/snapshot`, snapshotHeaders());
  if (snapshot?.sections?.metaAds) {
    const meta = snapshot.sections.metaAds;
    report.metaAds = {
      totalSpend: meta.totalSpend,
      totalLeads: meta.totalMessagingLeads,
      totalCampaigns: meta.totalCampaigns,
      activeCampaigns: meta.activeCampaigns,
      topPerformers: meta.topPerformers?.slice(0, 3),
      exportDate: meta.exportDate
    };
    report.findings.push(`Meta Ads: $${meta.totalSpend ?? 0} total spend, ${meta.totalMessagingLeads ?? meta.totalAllLeads ?? 0} leads across ${meta.totalCampaigns ?? 0} campaigns`);

    const alerts = (meta.activeCampaigns || []).filter(c => c.alert);
    if (alerts.length > 0) {
      report.findings.push(`Meta Ads ALERTS: ${alerts.map(c => `${c.name} — ${c.alert}`).join('; ')}`);
      report.tasks.push({ title: `${alerts.length} Meta Ad campaigns need attention`, description: alerts.map(c => `${c.name}: $${c.spend} spent, ${c.leads} leads — ${c.alert}`).join('\n'), priority: 'high' });
    }
  }

  if (snapshot?.sections?.gmail) {
    const gmail = snapshot.sections.gmail;
    report.gmail = { unreadEstimate: gmail.unreadEstimate, urgentCount: gmail.urgentUnread?.length || 0 };
    if (gmail.unreadEstimate > 100) {
      report.findings.push(`Gmail: ${gmail.unreadEstimate} unread emails — inbox needs cleanup`);
    }
  }

  report.aetheria = { note: 'Full Supabase analytics not yet connected. Game uptime checked by Gohan daily.' };

  // Ad performance data
  const adData = await fetchAdData();
  const adAnalysis = analyzeAdPerformance(adData);
  report.adPerformance = adData.combined || null;
  report.adDetail = { meta: adData.meta, google: adData.google };
  report.findings.push(...adAnalysis.findings);
  report.tasks.push(...adAnalysis.tasks);

  return report;
}

// ===== ANDROID 18: Creative & Media =====
// Cert defect 5 (2026-06-12): this agent's ONLY duty was watching the
// Shenron-era RunPod GPU (pod g2ukr7elm8l5nv), which is dead (negative
// balance, pod not found). The check is retired; the agent reports its own
// retirement honestly instead of alarming on a corpse every day.
// ORPHAN-AGENT FLAG for Mac: give Android 18 a real media duty (e.g. the
// marketing-clips render queue) or remove it from the roster.
export async function runAndroid18() {
  const report = { agent: AGENT_NAMES.android18.displayName, role: 'Creative & Media', timestamp: new Date().toISOString(), findings: [], tasks: [] };
  report.findings.push('RunPod watch RETIRED 2026-06-12 (Shenron-era pod dead: negative balance, pod not found). Agent has no active duty; awaiting reassignment or removal.');
  return report;
}

// Re-export quote engine for agent endpoints
export { calculateQuote };

// EA-style aliases. Internal names stay anime; external/dynamic-route can use either.
export const runSales = runVegeta;
export const runOps = runPiccolo;
export const runComms = runKrillin;
export const runGame = runGohan;
export const runInfra = runTrunks;
export const runMarketing = runBulma;
export const runCreative = runAndroid18;
export const runFinance = runCashflow;
export { runCashflow };

// Agent registry — both anime and EA names resolve to the same handler.
export const AGENTS = {
  vegeta: { fn: runVegeta, schedule: 'daily', role: 'Sales & Pipeline' },
  sales: { fn: runVegeta, schedule: 'daily', role: 'Sales & Pipeline' },
  piccolo: { fn: runPiccolo, schedule: 'daily', role: 'Operations & Crew' },
  ops: { fn: runPiccolo, schedule: 'daily', role: 'Operations & Crew' },
  krillin: { fn: runKrillin, schedule: 'daily', role: 'Comms & Marketing' },
  comms: { fn: runKrillin, schedule: 'daily', role: 'Comms & Marketing' },
  bulma: { fn: runBulma, schedule: 'weekly', role: 'Intel & Analytics' },
  marketing: { fn: runBulma, schedule: 'weekly', role: 'Intel & Analytics' },
  gohan: { fn: runGohan, schedule: 'daily', role: 'Game Dev & Product' },
  game: { fn: runGohan, schedule: 'daily', role: 'Game Dev & Product' },
  trunks: { fn: runTrunks, schedule: 'weekly', role: 'Security & Infra' },
  infra: { fn: runTrunks, schedule: 'weekly', role: 'Security & Infra' },
  android18: { fn: runAndroid18, schedule: 'daily', role: 'Creative & Media' },
  creative: { fn: runAndroid18, schedule: 'daily', role: 'Creative & Media' },
  cashflow: { fn: runCashflow, schedule: '4h', role: 'Finance & AR' },
  finance: { fn: runCashflow, schedule: '4h', role: 'Finance & AR' }
};
