// ═══════════════════════════════════════════════════════════════
// COLLECTIONS, the AR aging + chase-draft engine (pure, no I/O).
//
// Reads the cashflow agent's AR book (snapshot.cashflow.byJob + last7Days),
// classifies each open job by stage, and produces a stage-appropriate DRAFT
// per job. Draft-only by design: this module never sends anything. The
// reconcile agent's weekly collections pass wires it to the snapshot section
// and the owner SMS alert.
//
// Stage logic mirrors the desk-B chase doc (INVOICE_CHASE_DRAFTS_*.md):
//   - final_balance            near-final small balance, the one true chase
//   - deposit_awaiting_schedule deposit paid, balance not due, scheduling nudge
//   - wip_on_completion        crew on it / scheduled, balance due on completion
//   - exception_no_contract    contract or balance unknown, A sets it first
//   - exception_over_collected paid more than recorded, bookkeeping not a chase
//
// Every customer-facing figure is flagged unverified: Mel PC / the cron cannot
// read Gmail, so balances are provisional until A confirms against the signed
// contract (memories feedback_invoice_base_from_signed_pdf_not_internal_notes
// + feedback_verify_customer_dollars_against_gmail_not_disk).
// ═══════════════════════════════════════════════════════════════

const DAY = 86400000;

export function firstName(name) {
  const n = String(name || '').trim();
  if (!n) return 'there';
  return n.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Near-zero balances are paid (the matcher leaves float dust like 1.8e-12).
const EPS = 1;

export function classifyArJob(job) {
  const contract = job.contractValue == null ? null : Number(job.contractValue);
  const collected = Number(job.totalCollected || job.depositsCollected || 0);
  const balance = job.balanceRemaining == null ? null : Number(job.balanceRemaining);
  const scheduled = !!job.scheduledStartDate ||
    ['in_progress', 'scheduled'].includes(String(job.scheduleStatus || '').toLowerCase());

  if (contract == null || balance == null) return { stage: 'exception_no_contract', balance, collected, contract };
  if (collected > contract + EPS) return { stage: 'exception_over_collected', balance, collected, contract };
  if (balance <= EPS) return { stage: 'paid', balance, collected, contract };
  if (scheduled) return { stage: 'wip_on_completion', balance, collected, contract };
  const ratio = contract > 0 ? collected / contract : 0;
  if (collected > 0 && ratio < 0.5) return { stage: 'deposit_awaiting_schedule', balance, collected, contract };
  if (ratio >= 0.5) return { stage: 'final_balance', balance, collected, contract };
  return { stage: 'awaiting_start', balance, collected, contract };
}

// Voice-skill compliant. No em dashes, no softeners (no "just", "checking in",
// "follow up", "no rush"). Plain text for copy-paste, signed as Mackenzie.
export function draftFor(job, cls) {
  const first = firstName(job.customer);
  const addr = job.address || 'your roof';
  switch (cls.stage) {
    case 'final_balance':
      return `Hey ${first}, here is the final number on ${addr}. Balance owing is ${money(cls.balance)} once we wrap up the last of it. E-transfer works, or I can send you a card link, whichever is easier for you. Let me know and we will get it squared away.\n\nTalk soon, Mackenzie`;
    case 'deposit_awaiting_schedule':
      return `Hey ${first}, here is the timeline on ${addr}. Your deposit is in and you are on the board. We are booking [BOOKING WINDOW, Mac to fill] right now, weather depending, and I will lock in your start date as soon as I have it firm. I will reach out the week before with the crew schedule.\n\nTalk soon, Mackenzie`;
    case 'wip_on_completion':
      return `Hey ${first}, quick update on ${addr}. Crew is on it and moving well. Once we wrap and you have had a chance to look it over, I will send the final invoice for the remaining balance. Nothing owing until the job is done. I will reach out as we get close to the finish.\n\nTalk soon, Mackenzie`;
    case 'awaiting_start':
      return `Hey ${first}, quick note on ${addr}. You are on the board and we are lining up the schedule now. I will reach out with a start date as soon as it is firm.\n\nTalk soon, Mackenzie`;
    default:
      return null; // exceptions get no draft until A sets the contract / books the extra
  }
}

const NOTE = {
  exception_no_contract: 'Contract value or balance is unknown. A sets the signed-contract figure first, then this either closes or becomes a real balance line.',
  exception_over_collected: 'Paid more than the recorded contract. Likely unrecorded extras or a contract under-entry. Books fix for A, not a customer chase.',
};

export function buildCollections(cashflow, nowIso) {
  const byJob = (cashflow && cashflow.byJob) || [];
  const collected7d = Number(cashflow?.last7Days?.collected || 0);
  const customers = [];
  let totalOutstanding = 0;
  let collectibleNow = 0;

  for (const job of byJob) {
    const cls = classifyArJob(job);
    if (cls.stage === 'paid') continue;
    const draft = draftFor(job, cls);
    const balance = cls.balance == null ? null : Math.round(cls.balance * 100) / 100;
    if (typeof balance === 'number' && balance > EPS) totalOutstanding += balance;
    if (cls.stage === 'final_balance' && typeof balance === 'number') collectibleNow += balance;
    customers.push({
      name: job.customer,
      address: job.address || null,
      contract: cls.contract,
      collected: Math.round(cls.collected * 100) / 100,
      balance,
      stage: cls.stage,
      draft,
      // Every figure is provisional until A confirms against signed PDF / Gmail.
      unverified: true,
      note: NOTE[cls.stage] || null,
    });
  }

  customers.sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const dry7d = collected7d === 0 && totalOutstanding > 0;
  const chases = customers.filter((c) => c.stage === 'final_balance').length;

  return {
    lastRun: nowIso,
    collected7d,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    collectibleNow: Math.round(collectibleNow * 100) / 100,
    openCount: customers.length,
    trueChases: chases,
    customers,
    alert: {
      dry7d,
      message: dry7d
        ? `Collections dry: $0 collected in 7 days against ${money(totalOutstanding)} open AR. ${chases} ready-to-collect chase${chases === 1 ? '' : 's'}, ${money(collectibleNow)} collectible now. Drafts ready in command center.`
        : null,
    },
  };
}
