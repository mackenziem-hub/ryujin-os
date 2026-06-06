// ═══════════════════════════════════════════════════════════════
// lib/observations.js — shared operator-awareness observations.
//
// The pillar brains (api/agent-chat.js, api/options.js) historically saw
// only their own pillar's briefing/KPIs/schedule — they were BLIND to the
// active-jobs roster and revenue totals that the master brain (api/chat.js)
// already injects from /api/snapshot. This module gives both brains the
// same view so "what's on the schedule today?" / "how are we doing on
// revenue?" answer with the real roster instead of a guess.
//
// The active-jobs roster carries workorder ids + wo_numbers so a downstream
// deep-link action (open_job / open_workorder) can resolve to a real page.
//
// ⚠️ TENANCY: /api/snapshot is Plus Ultra (tenant #1) specific data
// (nativeTicketStats hard-queries slug='plus-ultra', the GHL pulls are that
// location's). NEVER inject it for another tenant — that is a cross-tenant
// leak. loadSnapshotObservations() returns '' unless the tenant is Plus Ultra.
// ═══════════════════════════════════════════════════════════════

import { snapshotHeaders } from './snapshotClient.js';

const SNAPSHOT_URL = 'https://ryujin-os.vercel.app/api/snapshot';
const SNAPSHOT_TENANT = 'plus-ultra';

// In-process cache (60s) — mirrors api/chat.js fetchSnapshot. Saves the HTTP
// roundtrip on warm instances and keeps the injected text stable inside the
// 5-min Anthropic prompt-cache window.
let _cache = { sections: null, expires: 0 };

// Fetch the snapshot's sections object. Fail-open: on any error, serve the
// last good cache (or null) so a snapshot outage never blocks the chat.
export async function fetchSnapshotSections() {
  if (Date.now() < _cache.expires && _cache.sections) return _cache.sections;
  try {
    const resp = await fetch(SNAPSHOT_URL, { signal: AbortSignal.timeout(8000), headers: snapshotHeaders() });
    if (!resp.ok) return _cache.sections;
    const snap = await resp.json();
    if (!snap?.sections) return _cache.sections;
    _cache = { sections: snap.sections, expires: Date.now() + 60_000 };
    return snap.sections;
  } catch {
    return _cache.sections;
  }
}

function fmtMoney(n) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  return '$' + Math.round(n).toLocaleString('en-CA');
}

// Build a readable markdown block: active jobs roster + revenue/pipeline
// totals, sourced from /api/snapshot. Returns '' when the tenant isn't Plus
// Ultra or there's nothing to show. Each ### block is self-titled so callers
// can append it directly to their observations text.
export async function loadSnapshotObservations(tenantSlug) {
  if (tenantSlug !== SNAPSHOT_TENANT) return '';
  const sections = await fetchSnapshotSections();
  if (!sections) return '';

  const out = [];

  // ── Active jobs roster (workorder rollup; carries wo_number for deep-links) ──
  const t = sections.tickets || {};
  const jobs = Array.isArray(t.activeToday) ? t.activeToday : [];
  if (jobs.length) {
    out.push(`### Active jobs (${t.total ?? jobs.length} total · ${t.overdueCount ?? 0} past start date)`);
    for (const j of jobs.slice(0, 10)) {
      const wo = j.wo_number ? ` · WO #${j.wo_number}` : '';
      const who = j.assignee && j.assignee !== 'Unassigned' ? ` · ${j.assignee}` : '';
      const starts = j.due_date ? ` · starts ${j.due_date}` : '';
      const overdue = j.days_overdue ? ` · ${j.days_overdue}d past start` : '';
      out.push(`- ${j.title}${wo}${who}${starts}${overdue}`);
    }
    out.push('');
  }

  // ── Revenue & pipeline $ totals (Estimator OS = canonical; NOT GHL value) ──
  const rev = sections.revenue || null;
  if (rev) {
    const lines = [];
    const signed = fmtMoney(rev.signedRevenue);
    const pending = fmtMoney(rev.pendingRevenue);
    if (signed) lines.push(`- Signed revenue: ${signed}`);
    if (pending) lines.push(`- Pending revenue: ${pending}`);
    if (rev.proposalsSent != null) lines.push(`- Proposals sent: ${rev.proposalsSent}`);
    if (rev.awaitingSchedule != null) lines.push(`- Awaiting schedule: ${rev.awaitingSchedule}`);
    if (lines.length) {
      out.push('### Revenue & pipeline (canonical, Estimator OS)');
      out.push(...lines);
      out.push('');
    }
  }

  return out.join('\n').trimEnd();
}
