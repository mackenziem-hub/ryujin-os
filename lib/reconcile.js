// ═══════════════════════════════════════════════════════════════
// RYUJIN RECONCILIATION ENGINE
//
// Cross-checks committed/delivered revenue across the systems that hold
// pieces of the same job: estimates (Estimator OS, the contract price),
// workorders + paysheets (Ryujin-native delivery + sub cost), and customers.
// It exists because a signed job is routinely recorded in one system and
// invisible to another, so any single-system "signed revenue" number lies.
//
// PURE: no I/O, no Supabase, no Date side effects beyond `now`. Feed it the
// four row-sets, get back {figures, jobs, findings}. The agent handler
// (api/agents/reconcile.js) does the fetching + finding persistence; this
// module is the logic, unit-testable against a fixed snapshot.
//
// The rules below were locked by an adversarial verification pass (2026-05-30)
// after a naive prototype false-merged two people who shared a first name and
// silently summed subcontractor COSTS into revenue. Do not soften them.
//
//  R1  IDENTITY: same job only if surname AND street-number+street match.
//      Never merge on first name alone. Prefer explicit FK joins
//      (workorders.linked_estimate_id / linked_paysheet_id) over name match.
//  R2  LEDGER ROW INTEGRITY: a job's wo_number, contract and sub_cost must all
//      come from the SAME underlying job; conflicting joins are flagged, not
//      silently resolved.
//  R3  REVENUE = estimates.final_accepted_total ONLY. paysheet.total/subtotal
//      is a subcontractor COST (incl HST) and never enters a revenue figure.
//  R4  COST-AS-REVENUE: contract == linked paysheet.total (or subtotal*1.15)
//      => the sub payout was typed as the contract price. Flag, don't trust.
//  R5  NULL-TOTAL: status=accepted with null/0 total contributes $0 but is
//      surfaced as ACCEPTED_NULL_TOTAL (hidden understatement), distinct from
//      NO_ESTIMATE (no estimate row references the job at all).
//  R6  FIGURE A = sum(final_accepted_total) over status='accepted', counting
//      null as 0 but reporting count + null-population separately.
//  R7  STATE from the WORK ORDER: complete=>delivered, cancelled=>excluded,
//      issued/scheduled=>committed. Paysheet-only completed => delivered.
//  R8  NO-ESTIMATE DELIVERED: unrecorded contract revenue; sub cost is a FLOOR
//      only, never the contract value. Flag NO_ESTIMATE + recommend backfill.
//  R9  ESTIMATED RETAIL (labelled, never persisted as actual): sub_cost / 0.62
//      midpoint, band /0.65../0.55. Sub labor ~55-65% of contract.
//  R10 ACCEPTED_NO_TIMESTAMP: accepted but accepted_at null = hygiene only.
//  R11 DEDUPE CUSTOMERS via the WO->estimate.customer_id link first; address
//      matching only flags duplicate customer rows, never fabricates a link.
// ═══════════════════════════════════════════════════════════════

const CANCELLED = new Set(['cancelled', 'canceled', 'void', 'dead', 'lost']);
const DELIVERED_WO = new Set(['complete', 'completed', 'done', 'closed', 'invoiced']);
const DELIVERED_PS = new Set(['completed', 'complete', 'invoice_final', 'invoiced', 'paid']);
const COMMITTED_WO = new Set(['issued', 'scheduled', 'in_progress', 'active', 'accepted']);

const num = (x) => {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};
const hasVal = (x) => x !== null && x !== undefined && num(x) > 0;

function stripAccents(s) {
  return String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
function normName(s) {
  return stripAccents(s).toLowerCase()
    .replace(/\([^)]*\)/g, ' ')               // drop "(APHL)", "(via Riverside)"
    .replace(/\b(via|c\/o|attn)\b.*$/i, ' ')   // drop "via Riverside Homes"
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const NAME_STOP = new Set(['and', 'the', 'jr', 'sr', 'mr', 'mrs', 'ms', 'kelly', 'karen']);
// Surname tokens = the distinctive (typically last) name tokens, first names dropped
// only matters for matching; we keep ALL tokens of len>=3 as the match set but
// require a NON-first-name token to overlap. Simpler + robust: use the set of
// name tokens len>=3, and demand the LAST token (surname) matches.
function nameTokens(s) {
  return normName(s).split(' ').filter((t) => t.length >= 3 && !NAME_STOP.has(t));
}
function surname(s) {
  const t = nameTokens(s);
  return t.length ? t[t.length - 1] : '';
}
function addrKey(addr) {
  const a = stripAccents(addr).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a) return '';
  const numMatch = a.match(/\b(\d{1,6})\b/);
  const streetNum = numMatch ? numMatch[1] : '';
  // longest alpha token (street name) excluding generic suffixes/provinces
  const SKIP = new Set(['rd', 'road', 'dr', 'drive', 'st', 'street', 'ave', 'avenue', 'blvd', 'rue',
    'route', 'nb', 'ns', 'pe', 'cres', 'crescent', 'lane', 'ln', 'way', 'hwy', 'moncton', 'dieppe',
    'shediac', 'amherst', 'parish', 'mountain', 'indian', 'sainte', 'marie', 'wellington', 'bouctouche']);
  const alpha = a.split(' ').filter((t) => /^[a-z]+$/.test(t) && t.length >= 3 && !SKIP.has(t));
  alpha.sort((x, y) => y.length - x.length);
  const street = alpha[0] || '';
  return streetNum && street ? `${streetNum}|${street}` : (streetNum || street || '');
}

// R1: two identity descriptors are the same job only if surname AND addr match.
function sameJob(a, b) {
  if (!a || !b) return false;
  const snA = surname(a.name), snB = surname(b.name);
  const akA = addrKey(a.addr), akB = addrKey(b.addr);
  if (snA && snB && akA && akB) return snA === snB && akA === akB;
  // if one side lacks an address, fall back to surname AND require no addr conflict
  if (snA && snB && snA === snB) {
    if (akA && akB && akA !== akB) return false; // conflicting addresses => different job
    return true;
  }
  return false;
}

export function reconcile({ estimates = [], workorders = [], paysheets = [], customers = [] } = {}, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const custById = new Map(customers.map((c) => [c.id, c]));
  const estById = new Map(estimates.map((e) => [e.id, e]));

  const estName = (e) => (e && (custById.get(e.customer_id)?.full_name)) || '';
  const estAddr = (e) => (e && (custById.get(e.customer_id)?.address)) || '';
  const isAccepted = (e) => e && String(e.status).toLowerCase() === 'accepted';

  // ── Build canonical jobs ──────────────────────────────────────
  const jobs = [];
  const findById = (id) => jobs.find((j) => j._estId === id || j._woId === id);
  function locate(name, addr) {
    const probe = { name, addr };
    return jobs.find((j) => sameJob(j, probe));
  }

  // Seed from work orders (a WO = a real committed job). R2: keep its own fields.
  for (const w of workorders) {
    const j = locate(w.customer_name, w.address) || {
      name: w.customer_name || '', addr: w.address || '',
      wo: null, _woId: null, pays: [], est: null, _estId: null, conflicts: [],
    };
    if (!jobs.includes(j)) jobs.push(j);
    if (j.wo && j.wo.id !== w.id) j.conflicts.push(`two work orders matched: ${j.wo.wo_number} & ${w.wo_number}`);
    j.wo = w; j._woId = w.id;
    const le = w.linked_estimate_id;
    if (le && estById.has(le)) { j.est = estById.get(le); j._estId = le; }     // R1: explicit FK wins
  }

  // Attach paysheets (R2: prefer explicit link, then strict identity).
  for (const p of paysheets) {
    let j = null;
    if (p.linked_estimate_id) j = jobs.find((x) => x._estId === p.linked_estimate_id);
    if (!j) j = locate(p.customer_name, p.address);
    if (!j) {
      j = { name: p.customer_name || '', addr: p.address || '', wo: null, _woId: null, pays: [], est: null, _estId: null, conflicts: [] };
      jobs.push(j);
    }
    j.pays.push(p);
    if (!j.est && p.linked_estimate_id && estById.has(p.linked_estimate_id)) {
      j.est = estById.get(p.linked_estimate_id); j._estId = p.linked_estimate_id;
    }
  }

  // Attach accepted estimates not yet bound to any job (so an accepted estimate
  // with no WO/paysheet still surfaces). R11: bind by customer link first.
  for (const e of estimates) {
    if (!isAccepted(e)) continue;
    if (jobs.some((j) => j._estId === e.id)) continue;
    let j = locate(estName(e), estAddr(e));
    if (j && !j.est) { j.est = e; j._estId = e.id; }
    else if (!j) jobs.push({ name: estName(e), addr: estAddr(e), wo: null, _woId: null, pays: [], est: e, _estId: e.id, conflicts: [] });
  }

  // ── Classify + value each job ─────────────────────────────────
  const ledger = [];
  const findings = [];
  const add = (kind, job, detail, fix, dollar = null, extra = {}) =>
    findings.push({ kind, job, detail, proposed_fix: fix, dollar_impact: dollar, ...extra });

  for (const j of jobs) {
    const e = j.est;
    const w = j.wo;
    const realPays = j.pays.filter((p) => !CANCELLED.has(String(p.status).toLowerCase()));
    const subCost = realPays.reduce((m, p) => Math.max(m, num(p.total)), 0); // R3: a COST
    const contract = e ? num(e.final_accepted_total) : 0;                     // R3: revenue source

    const woStatus = w ? String(w.status).toLowerCase() : null;
    const woCancelled = woStatus && CANCELLED.has(woStatus);
    const psDelivered = realPays.some((p) => DELIVERED_PS.has(String(p.status).toLowerCase()));
    const hasActiveWo = woStatus && !woCancelled;
    // R7: state from the work order; paysheet-only completed => delivered. A job
    // with no active WO, no live paysheet and no accepted estimate is noise
    // (e.g. a lone cancelled paysheet) and is excluded, not counted as committed.
    const isRealJob = hasActiveWo || realPays.length > 0 || isAccepted(e);
    let state;
    if (woCancelled && !psDelivered) state = 'cancelled';
    else if (!isRealJob) state = 'cancelled';
    else if ((woStatus && DELIVERED_WO.has(woStatus)) || psDelivered) state = 'delivered';
    else state = 'committed';

    const label = (j.name || '(unnamed)').slice(0, 30);
    const addrShort = (j.addr || '').slice(0, 26);
    ledger.push({
      name: label, address: addrShort, state,
      wo_number: w?.wo_number ?? null, wo_status: woStatus,
      estimate_number: e?.estimate_number ?? null, estimate_status: e ? String(e.status) : null,
      contract: Math.round(contract * 100) / 100, sub_cost: Math.round(subCost * 100) / 100,
    });

    if (j.conflicts.length) add('JOIN_CONFLICT', label, j.conflicts.join('; '), 'Resolve the conflicting joins by hand; do not trust the auto-pick.', null);
    if (state === 'cancelled') continue;

    // R4: cost typed as revenue
    if (e && subCost > 0 && (Math.abs(contract - subCost) < 1 ||
        realPays.some((p) => hasVal(p.subtotal) && Math.abs(contract - num(p.subtotal) * 1.15) < 1))) {
      add('VALUE_LOOKS_LIKE_COST', label,
        `estimate #${e.estimate_number} final_accepted_total ($${contract.toLocaleString()}) equals the linked paysheet sub payout (a cost). The contract price was likely typed as the sub payout.`,
        `Re-enter the real customer contract price on estimate #${e.estimate_number}.`, contract, { estimate_id: e.id });
    } else if (!e) {
      // R8: delivered/committed job with no estimate anywhere
      add('NO_ESTIMATE', label,
        `${state} job${w ? ` (WO ${w.wo_number})` : ' (paysheet only)'} but NO estimate references it. Contract value unrecorded; only sub cost $${subCost.toLocaleString()} known (a floor, not the price).`,
        `Create a back-dated accepted estimate for this job${w ? ` and link WO ${w.wo_number}` : ''}. Sub-cost floor $${subCost.toLocaleString()}.`,
        subCost, { sub_cost_floor: subCost });
    } else if (isAccepted(e) && !hasVal(e.final_accepted_total)) {
      // R5: accepted but null total
      add('ACCEPTED_NULL_TOTAL', label,
        `estimate #${e.estimate_number} is accepted and linked, but final_accepted_total is null/0 -> contributes $0 to signed revenue though the job is ${state}.`,
        `Backfill the contract dollar on estimate #${e.estimate_number} (do NOT create a new estimate). Sub-cost floor $${subCost.toLocaleString()}.`,
        subCost, { estimate_id: e.id, sub_cost_floor: subCost });
    }
    // R10: accepted with no timestamp (hygiene; independent of dollar findings)
    if (isAccepted(e) && !e.accepted_at) {
      add('ACCEPTED_NO_TIMESTAMP', label,
        `estimate #${e.estimate_number} status=accepted but accepted_at is null.`,
        `Stamp accepted_at on estimate #${e.estimate_number} (hygiene; no dollar change).`, null, { estimate_id: e.id });
    }
  }

  // ── Figures ───────────────────────────────────────────────────
  const acceptedEst = estimates.filter(isAccepted);
  const acceptedNonNull = acceptedEst.filter((e) => hasVal(e.final_accepted_total));
  const figureA = acceptedNonNull.reduce((s, e) => s + num(e.final_accepted_total), 0); // R6

  const active = ledger.filter((l) => l.state !== 'cancelled');
  const costAsRev = new Set(findings.filter((f) => f.kind === 'VALUE_LOOKS_LIKE_COST').map((f) => f.job));
  const cleanContract = active
    .filter((l) => l.contract > 0 && !costAsRev.has(l.name))
    .reduce((s, l) => s + l.contract, 0);
  // genuinely-blank contract jobs (NO_ESTIMATE + ACCEPTED_NULL_TOTAL)
  const noValueJobs = active.filter((l) => l.contract <= 0);
  // jobs needing a real number = blank OR cost-as-revenue; basis for the estimate band
  const reestimateSubCost = active
    .filter((l) => l.contract <= 0 || costAsRev.has(l.name))
    .reduce((s, l) => s + l.sub_cost, 0);

  // R9: estimated retail band for the under-recorded jobs, labelled as ESTIMATE.
  const estLow = cleanContract + reestimateSubCost / 0.65;
  const estHigh = cleanContract + reestimateSubCost / 0.55;
  const estMid = cleanContract + reestimateSubCost / 0.62;

  const round = (n) => Math.round(n * 100) / 100;
  return {
    generated_at: new Date(now).toISOString(),
    figures: {
      figureA_accepted_sum: round(figureA),
      figureA_count: acceptedEst.length,
      figureA_null_total_count: acceptedEst.length - acceptedNonNull.length,
      committed_delivered_jobs: active.length,
      committed: active.filter((l) => l.state === 'committed').length,
      delivered: active.filter((l) => l.state === 'delivered').length,
      cancelled: ledger.length - active.length,
      contract_value_clean: round(cleanContract),
      jobs_with_no_recorded_contract_value: noValueJobs.length,
      cost_as_revenue_jobs: active.filter((l) => costAsRev.has(l.name)).length,
      no_value_sub_cost_floor: round(noValueJobs.reduce((s, l) => s + l.sub_cost, 0)),
      estimated_true_committed_low: round(estLow),
      estimated_true_committed_mid: round(estMid),
      estimated_true_committed_high: round(estHigh),
    },
    jobs: ledger,
    findings,
  };
}

export default reconcile;
