// ═══════════════════════════════════════════════════════════════
// SLICE 3 — widen the reconciliation agent's senses to GoHighLevel.
//
// GHL is where Darcy's deals + the whole sales pipeline live, so a job can be
// "won" in GHL while Estimator OS (Supabase) has no accepted estimate, or the
// two can carry different dollar values (GHL is often pre-tax or stale). This
// module pulls GHL won opportunities and cross-checks them against the Supabase
// accepted estimates, emitting drift findings.
//
// Server-side only (uses GHL_TOKEN from the Vercel env). GRACEFUL: any failure
// (no token, GHL down, timeout) returns null and the agent simply skips GHL
// findings — it never breaks the core Supabase reconcile.
// ═══════════════════════════════════════════════════════════════

const GHL_BASE = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'aHotOUdq9D8m3JPrRz9n';
const GHL_VERSION = '2021-07-28';
const MISMATCH_TOLERANCE = 0.20; // beyond the 15% HST basis gap = a real conflict

async function ghlFetch(path, params = {}) {
  const token = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
  if (!token) throw new Error('no GHL_TOKEN');
  const url = new URL(GHL_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`GHL ${path} -> ${r.status}`);
  return r.json();
}

// Pull every won opportunity (paginated). Returns [{id,name,value}] or null on failure.
export async function fetchWonOpportunities() {
  try {
    const opps = [];
    let startAfter = null, startAfterId = null;
    for (let i = 0; i < 12; i++) { // hard cap ~1200 opps
      const params = { location_id: LOCATION_ID, limit: '100' };
      if (startAfter) params.startAfter = startAfter;
      if (startAfterId) params.startAfterId = startAfterId;
      const data = await ghlFetch('/opportunities/search', params);
      const page = data.opportunities || [];
      opps.push(...page);
      startAfter = data.meta?.startAfter || null;
      startAfterId = data.meta?.startAfterId || null;
      if (!page.length || page.length < 100 || (!startAfter && !startAfterId)) break;
    }
    return opps
      .filter((o) => String(o.status).toLowerCase() === 'won')
      .map((o) => ({ id: o.id, name: String(o.name || ''), value: Number(o.monetaryValue ?? o.value ?? 0) || 0 }));
  } catch {
    return null; // GHL unavailable -> agent skips GHL findings
  }
}

const SURNAME_STOP = new Set(['the', 'and', 'inc', 'ltd', 'siding', 'roof', 'roofing', 'repair',
  'dr', 'st', 'rd', 'blvd', 'ave', 'rue', 'via', 'project', 'job', 'new', 'construction',
  // GHL opp names often carry trailing status/type words that aren't surnames
  'signed', 'won', 'paid', 'deposit', 'patch', 'estimate', 'quote', 'invoice', 'replacement']);
function surname(s) {
  const toks = String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !SURNAME_STOP.has(t));
  return toks.length ? toks[toks.length - 1] : '';
}

// Cross-check won GHL opps vs the reconcile job LEDGER. Pure. Returns findings[].
// Matching against the ledger (names resolved from WO/paysheet/estimate) instead
// of re-resolving estimate->customer avoids customer-record tenant/null edge cases
// (e.g. Magarin's customer row that broke the old estimate-based resolution).
export function crossCheckGhl(wonOpps, jobs) {
  const bySurname = new Map();
  for (const j of jobs || []) {
    if (j.state === 'cancelled') continue;
    const s = surname(j.name_full || j.name); // name is truncated to 30 chars for display
    if (s && !bySurname.has(s)) {
      bySurname.set(s, { contract: Number(j.contract) || 0, estimate_number: j.estimate_number, name: j.name });
    }
  }
  const findings = [];
  for (const o of wonOpps || []) {
    if (o.value <= 0) continue; // GHL has no value to compare
    const s = surname(o.name);
    if (!s) continue;
    const m = bySurname.get(s);
    if (!m) {
      findings.push({
        kind: 'GHL_WON_NO_ESTIMATE', job: o.name.slice(0, 40),
        detail: `Won in GHL ($${o.value.toLocaleString()}) but no matching job in Estimator OS.`,
        proposed_fix: 'Confirm the deal and create a back-dated accepted estimate, or correct the GHL stage if it is not actually won.',
        dollar_impact: o.value,
      });
    } else if (m.contract > 0 && Math.abs(o.value - m.contract) / m.contract > MISMATCH_TOLERANCE) {
      findings.push({
        kind: 'GHL_VALUE_MISMATCH', job: m.name.slice(0, 40),
        detail: `GHL won value $${o.value.toLocaleString()} vs ${m.estimate_number ? `estimate #${m.estimate_number} ` : ''}$${m.contract.toLocaleString()} differ by more than 20% (beyond an HST-basis gap).`,
        proposed_fix: 'Reconcile which figure is correct — GHL is often pre-tax or stale; the payment receipt is authoritative.',
        dollar_impact: Math.round(Math.abs(o.value - m.contract)),
      });
    }
  }
  return findings;
}
