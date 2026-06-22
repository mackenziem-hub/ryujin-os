// Pipeline hygiene — single source of truth for cleaning GHL opportunity data
// before it reaches any reporting surface (Vegeta agent, snapshot, briefing).
//
// The raw GHL pipeline is noisy: every lead-magnet form-fill mints a shadow
// opportunity in a feeder pipeline (Instant Estimator / 10 CM / Voice AI) AND a
// parallel Internal Pipeline lead, so the same human is counted 2-3x. Test
// personas ("Test", "Cat Inspect") leak through. Parked Nurture / DND leads get
// flagged as "stale" even though they are intentionally on ice.
//
// Decisions locked with Mac 2026-06-22:
//   - Open deals = sales-qualified only: open opportunities in the Internal
//     Pipeline, not DND, deduped by contact identity.
//   - Stale = 7 days, active stages only: open + actively-worked stage,
//     untouched 7+ days. Parked stages (Nurture, DND, Unresponsive, Lost,
//     Contract Signed) are excluded.
//   - Dedup by contact IDENTITY only (contactId / normalized phone / normalized
//     email), never by name, so two distinct real people are never merged.
//     Winner = furthest-along stage, tiebreak most-recent activity, then value.

import { isTestData } from './leadTestFilter.js';

// Test-persona detection. Delegates to leadTestFilter (the trusted single source
// of truth shared by the lead view + snapshot KPI path — word-boundary name
// tokens like \btest\b / \btester\b / \bzz\b, plus Cat's test phones/emails) so
// the pipeline can never disagree with the lead numbers on who is a test. Adds
// the one pipeline-only persona the lead filter does not carry ("Cat Inspect").
// Accepts either an opportunity object {name,email,phone} or a bare name string.
export function isTestContact(input) {
  const o = typeof input === 'string' ? { name: input } : (input || {});
  if (isTestData({ name: o.name, email: o.email, phone: o.phone })) return true;
  return /\bcat\s*inspect\b/i.test(String(o.name || ''));
}

// The only pipeline that represents a real, sales-qualified deal Mac is working.
// Feeder pipelines (Instant Estimator, 10 CM, Voice AI, Revive, Darcy's) are
// lead intake; a serious lead gets promoted INTO the Internal Pipeline.
export const SALES_QUALIFIED_PIPELINES = ['Internal Pipeline'];

// Stage names (substring, case-insensitive) that mean a deal is parked / dead /
// already won, so it is NOT an actively-worked lead. Used to exclude from stale,
// and the DND family is also excluded from the open-deals count.
const PARKED_STAGE_PATTERNS = [
  /dnd/i, /nurture/i, /unresponsive/i, /\blost\b/i,
  /not a fit/i, /telemarketers/i, /may not qualify/i, /day 21 lost/i,
  /contract signed/i,
];

const DND_STAGE = /dnd/i;

function isParkedStage(stage) {
  const s = String(stage || '');
  return PARKED_STAGE_PATTERNS.some((p) => p.test(s));
}

// Rough funnel rank so dedup can keep the furthest-along opportunity for a
// contact. Higher = further along. Parked/dead stages rank 0.
export function rankStage(stage) {
  const s = String(stage || '').toLowerCase();
  if (DND_STAGE.test(s) || /unresponsive|\blost\b|not a fit|may not qualify/.test(s)) return 0;
  if (/contract signed/.test(s)) return 9;
  if (/quote follow up/.test(s)) return 8;
  if (/quote (sent|ready|pending)/.test(s)) return 7;
  if (/inspection (complete|completed)/.test(s)) return 6;
  if (/inspection (scheduled|booked)/.test(s)) return 5;
  if (/client responded|qualified/.test(s)) return 4;
  if (/follow up/.test(s)) return 3;
  if (/text sent|personal video|contacted/.test(s)) return 2;
  if (/new lead|new ie|pdf downloaded|customer called/.test(s)) return 1;
  return 1; // unknown active stage — treat as early, never parked
}

function normPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Identity key for dedup. Returns null when no reliable identity exists, so the
// caller keeps the opportunity as its own distinct row (never merge on name).
export function contactKey(opp) {
  if (opp.contactId) return `c:${opp.contactId}`;
  const phone = normPhone(opp.phone);
  if (phone) return `p:${phone}`;
  const email = normEmail(opp.email);
  if (email) return `e:${email}`;
  return null;
}

// Collapse multiple opportunities for the same contact identity into one,
// keeping the furthest-along (tiebreak most-recent activity, then value).
// Opportunities with no identity key are all kept (distinct).
export function dedupeByContact(opps) {
  const byKey = new Map();
  const keyless = [];
  for (const o of opps) {
    const key = contactKey(o);
    if (!key) { keyless.push(o); continue; }
    const prev = byKey.get(key);
    if (!prev || isBetter(o, prev)) byKey.set(key, o);
  }
  return [...byKey.values(), ...keyless];
}

function isBetter(a, b) {
  const ra = rankStage(a.stage);
  const rb = rankStage(b.stage);
  if (ra !== rb) return ra > rb;
  const ta = Date.parse(a.lastStatusChange || a.createdAt || 0) || 0;
  const tb = Date.parse(b.lastStatusChange || b.createdAt || 0) || 0;
  if (ta !== tb) return ta > tb;
  return (a.value || 0) > (b.value || 0);
}

const STALE_DAYS = 7;

// Main entry point. Takes the raw enriched opportunities array and returns the
// cleaned, deduped views plus the trustworthy counts.
export function cleanPipeline(opportunities = [], { now = new Date(), staleDays = STALE_DAYS } = {}) {
  const real = opportunities.filter((o) => !isTestContact(o));

  // Sales-qualified open deals Mac is actively working: Internal Pipeline,
  // status open, deduped by contact, with parked/won/dead stages excluded.
  // Excluding parked stages (not just DND) matters because a GHL deal in the
  // "Contract Signed" stage routinely keeps status:'open' until someone marks
  // it won — counting those would inflate openDeals/value with already-closed
  // money (the won-stage scan in _shared.js treats them as won for the same
  // reason). Also drops Lost / Unresponsive so the count is genuinely "in motion".
  const salesOpen = dedupeByContact(
    real.filter(
      (o) =>
        o.status === 'open' &&
        SALES_QUALIFIED_PIPELINES.includes(o.pipeline) &&
        !isParkedStage(o.stage)
    )
  );

  // Stale = sales-open in an actively-worked stage, untouched staleDays+.
  const staleLeads = salesOpen.filter((o) => {
    if (isParkedStage(o.stage)) return false;
    if (!o.lastStatusChange) return false;
    const days = (now - new Date(o.lastStatusChange)) / 86400000;
    return days >= staleDays;
  });

  // Raw transparency figures (test-filtered, but no pipeline/dedup narrowing).
  const rawOpen = real.filter((o) => o.status === 'open');
  const distinctContacts = countDistinct(rawOpen);

  return {
    salesOpen,
    staleLeads,
    counts: {
      openDeals: salesOpen.length,
      staleLeads: staleLeads.length,
      salesOpenValue: salesOpen.reduce((s, o) => s + (o.value || 0), 0),
      rawOpenAll: rawOpen.length,
      distinctContacts,
    },
  };
}

function countDistinct(opps) {
  const keys = new Set();
  let keyless = 0;
  for (const o of opps) {
    const k = contactKey(o);
    if (k) keys.add(k);
    else keyless += 1;
  }
  return keys.size + keyless;
}
