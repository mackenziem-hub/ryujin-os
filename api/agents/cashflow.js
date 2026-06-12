// ═══════════════════════════════════════════════════════════════
// CASHFLOW AGENT — Reconciles Stripe-via-Automator deposit emails
// against Estimator OS accepted estimates. Writes back depositPaid
// + balance + recent payments into snapshot.cashflow + estimate row.
//
// Source of truth: Gmail "Invoice payment successful" notifications
// from info@reply.plusultra-roofing.com (Automator/GHL Stripe hook).
//
// Schedule: every 4h via vercel cron. Also callable on-demand at
// GET /api/agents/cashflow.
// ═══════════════════════════════════════════════════════════════

import { gmailSearch, gmailReadMessage } from '../../lib/google.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { matchPaymentToEstimate, dedupeEstimatePool } from '../../lib/paymentMatcher.js';

const ESTIMATOR_BASE = 'https://estimator-os.replit.app/api';
const ESTIMATOR_KEY = (process.env.ESTIMATOR_KEY || process.env.ESTIMATOR_OS_KEY || 'pu-estimator-2026').trim();
const RYUJIN_BASE = 'https://ryujin-os.vercel.app';

// Cashflow currently runs hardcoded for Plus Ultra (tenant 1). When
// multi-tenant cashflow lands post-July this will become a parameter.
const PLUS_ULTRA_SLUG = 'plus-ultra';

export async function runCashflow() {
  const report = { agent: 'Cashflow', role: 'Finance & AR', timestamp: new Date().toISOString(), findings: [], tasks: [] };

  // 1. Pull payment-success emails (last 90 days)
  let messages = [];
  try {
    messages = await gmailSearch('from:reply.plusultra-roofing.com "Invoice payment successful" newer_than:90d', 50);
  } catch (e) {
    report.findings.push(`Gmail search failed: ${e.message}`);
    return report;
  }

  // 2. Parse each — subject has [Customer Name], body has CA$amount + invoice line
  const payments = [];
  for (const msg of messages) {
    const subjMatch = (msg.subject || '').match(/^\[([^\]]+)\]/);
    if (!subjMatch) continue;
    const customer = subjMatch[1].trim();
    let body = '';
    try {
      const full = await gmailReadMessage(msg.id);
      body = full.body || '';
    } catch (e) { continue; }

    const amtMatch = body.match(/CA\$\s?([\d,]+\.\d{2})/);
    if (!amtMatch) continue;
    const amount = parseFloat(amtMatch[1].replace(/,/g, ''));
    // "against 5380 Rte. 495- Roof Deposit Invoice" or "Final Invoice" or "Balance Invoice"
    const invMatch = body.match(/against\s+(.+?)\s*[-–]\s*([A-Za-z\s]+?Invoice)/i);
    payments.push({
      customer,
      amount,
      invoiceDescription: invMatch ? invMatch[1].trim() : null,
      invoiceType: invMatch ? classifyInvoiceType(invMatch[2]) : 'unknown',
      date: msg.date,
      emailId: msg.id
    });
  }

  // 3. Pull accepted estimates from BOTH Estimator OS (legacy Replit) AND
  // Ryujin's Postgres /api/estimates (newer wizard quotes). Sheila + Kyle live in Ryujin.
  let estimates = [];

  try {
    const r = await fetch(`${ESTIMATOR_BASE}/estimates`, { headers: { 'x-api-key': ESTIMATOR_KEY }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data.estimates || data.data || []);
      const accepted = arr
        .filter(e => e.proposalStatus === 'Accepted' || e.jobStatus === 'Proposal Accepted')
        .map(e => ({
          id: e.id,
          source: 'estimator-os',
          fullName: e.customer?.fullName || '',
          address: e.customer?.address || '',
          finalAcceptedTotal: e.finalAcceptedTotal || null,
          selectedPackage: e.selectedPackage || null,
          salesOwner: e.salesOwner || null,
          scheduleStatus: e.scheduleStatus || null,
          scheduledStartDate: e.scheduledStartDate || null,
          depositPaid: (e.depositPaid != null ? Number(e.depositPaid) : null)
        }));
      estimates.push(...accepted);
    } else {
      report.findings.push(`Estimator OS fetch failed: HTTP ${r.status}`);
    }
  } catch (e) {
    report.findings.push(`Estimator OS unreachable: ${e.message}`);
  }

  try {
    const r = await fetch(`${RYUJIN_BASE}/api/estimates?tenant=plus-ultra&status=accepted&limit=100`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'x-tenant-id': 'plus-ultra',
        ...(process.env.RYUJIN_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.RYUJIN_SERVICE_TOKEN.trim()}` } : {})
      }
    });
    if (r.ok) {
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data.estimates || data.data || []);
      const accepted = arr.map(e => ({
        id: e.id,
        source: 'ryujin',
        fullName: e.customer?.full_name || e.customer?.fullName || '',
        address: e.customer?.address || '',
        finalAcceptedTotal: e.final_accepted_total || null,
        selectedPackage: e.selected_package || null,
        salesOwner: e.sales_owner || null,
        scheduleStatus: null,
        scheduledStartDate: null
      }));
      estimates.push(...accepted);
    } else {
      report.findings.push(`Ryujin estimates fetch failed: HTTP ${r.status}`);
    }
  } catch (e) {
    report.findings.push(`Ryujin estimates unreachable: ${e.message}`);
  }

  // 4. Match payments to estimates. Dedupe the pool first: the same customer
  // in both sources binds by push-order otherwise, and the Estimator OS row
  // (pre-tax or null total) wins over the Ryujin row (tax-inclusive, what the
  // customer actually pays), producing phantom over-collections and null
  // contracts. See dedupeEstimatePool in lib/paymentMatcher.js.
  estimates = dedupeEstimatePool(estimates);
  const byEstimate = {};
  const unmatched = [];
  for (const pmt of payments) {
    const est = matchPaymentToEstimate(pmt, estimates);
    if (!est) { unmatched.push(pmt); continue; }
    if (!byEstimate[est.id]) {
      byEstimate[est.id] = {
        estimateId: est.id,
        source: est.source,
        customer: est.fullName || pmt.customer,
        address: est.address || pmt.invoiceDescription || '',
        contractValue: est.finalAcceptedTotal || null,
        package: est.selectedPackage || null,
        salesOwner: est.salesOwner || null,
        scheduleStatus: est.scheduleStatus || null,
        scheduledStartDate: est.scheduledStartDate || null,
        currentDepositPaid: (est.depositPaid != null ? est.depositPaid : null),
        depositsCollected: 0,
        balancesCollected: 0,
        payments: []
      };
    }
    const job = byEstimate[est.id];
    job.payments.push({ amount: pmt.amount, date: pmt.date, type: pmt.invoiceType, emailId: pmt.emailId });
    if (pmt.invoiceType === 'balance' || pmt.invoiceType === 'final') {
      job.balancesCollected += pmt.amount;
    } else {
      job.depositsCollected += pmt.amount;
    }
  }

  // Compute per-job totals + outstanding
  for (const job of Object.values(byEstimate)) {
    job.totalCollected = job.depositsCollected + job.balancesCollected;
    job.balanceRemaining = job.contractValue ? Math.max(0, job.contractValue - job.totalCollected) : null;
    job.payments.sort((a, b) => new Date(a.date) - new Date(b.date));
  }

  // 5. Aggregate roll-ups
  const jobs = Object.values(byEstimate);
  const totalCollected = jobs.reduce((s, j) => s + j.totalCollected, 0);
  const totalContract = jobs.reduce((s, j) => s + (j.contractValue || 0), 0);
  const totalOutstanding = jobs.reduce((s, j) => s + (j.balanceRemaining || 0), 0);

  // Last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = payments.filter(p => new Date(p.date).getTime() > sevenDaysAgo);
  const last7Collected = recent.reduce((s, p) => s + p.amount, 0);

  // AR exception surface. Computed every run so a mis-attribution or duplicate
  // shows up in the snapshot within 4 hours instead of at the next manual audit.
  // Rides inside the existing cashflow section (no new top-level snapshot key).
  const arExceptions = [];
  for (const job of jobs) {
    if (job.contractValue && job.totalCollected > job.contractValue + 1) {
      arExceptions.push({
        type: 'over_collected',
        customer: job.customer,
        estimateId: job.estimateId,
        contractValue: job.contractValue,
        totalCollected: job.totalCollected,
        excess: Math.round((job.totalCollected - job.contractValue) * 100) / 100
      });
    }
  }
  for (const pmt of unmatched) {
    if (pmt.amount >= 1000) {
      arExceptions.push({
        type: 'unmatched_large',
        customer: pmt.customer,
        amount: pmt.amount,
        description: pmt.invoiceDescription || null,
        date: pmt.date,
        emailId: pmt.emailId
      });
    }
  }
  // Same-amount payments landing within 60s of each other are duplicate suspects
  // (double-click on a payment link, or a double webhook/notification).
  const byAmount = {};
  for (const pmt of payments) (byAmount[pmt.amount] = byAmount[pmt.amount] || []).push(pmt);
  for (const group of Object.values(byAmount)) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const gapMs = Math.abs(new Date(sorted[i].date) - new Date(sorted[i - 1].date));
      if (gapMs <= 60000) {
        arExceptions.push({
          type: 'duplicate_suspect',
          customer: sorted[i].customer,
          amount: sorted[i].amount,
          dates: [sorted[i - 1].date, sorted[i].date],
          emailIds: [sorted[i - 1].emailId, sorted[i].emailId]
        });
      }
    }
  }

  report.cashflow = {
    last90Days: {
      paymentsReceived: payments.length,
      paymentsMatched: payments.length - unmatched.length,
      totalCollected,
      totalContract,
      totalOutstanding
    },
    last7Days: {
      paymentsReceived: recent.length,
      collected: last7Collected
    },
    byJob: jobs.sort((a, b) => (b.balanceRemaining || 0) - (a.balanceRemaining || 0)),
    unmatchedPayments: unmatched,
    arExceptions
  };
  if (arExceptions.length > 0) {
    report.findings.push(`${arExceptions.length} AR exception(s): ${arExceptions.map(x => `${x.type}:${x.customer}`).join(', ')}`);
  }

  report.findings.push(`Last 90d: $${totalCollected.toFixed(2)} collected on $${totalContract.toFixed(2)} signed (outstanding: $${totalOutstanding.toFixed(2)})`);
  report.findings.push(`${payments.length - unmatched.length}/${payments.length} payments matched`);
  if (recent.length > 0) report.findings.push(`Last 7d: $${last7Collected.toFixed(2)} across ${recent.length} payment(s)`);

  if (unmatched.length > 0) {
    report.findings.push(`UNMATCHED: ${unmatched.map(p => `${p.customer} CA$${p.amount}`).join(', ')}`);
    report.tasks.push({
      title: `${unmatched.length} payment(s) couldn't match an estimate`,
      description: unmatched.map(p => `${p.customer} — CA$${p.amount} — ${p.invoiceDescription || '?'} — ${p.date}`).join('\n'),
      priority: 'medium'
    });
  }

  // Flag jobs with deposit collected but no scheduled install date
  const stalledDeposits = jobs.filter(j => j.depositsCollected > 0 && !j.scheduledStartDate);
  if (stalledDeposits.length > 0) {
    report.tasks.push({
      title: `${stalledDeposits.length} deposit-paid job(s) not scheduled`,
      description: stalledDeposits.map(j => `${j.customer} (${j.address}) — deposit $${j.depositsCollected.toFixed(2)} cleared, install not scheduled`).join('\n'),
      priority: 'high'
    });
  }

  // 6. PUT depositPaid back to Estimator OS (only — Ryujin schema doesn't have that column yet).
  //
  // GUARDED, IDEMPOTENT writeback. This loop runs every 4h. The old version
  // re-PUT depositPaid on every run, which bumped each paid job's updated_at on
  // Estimator OS to "now". Estimator OS /api/stats then surfaced months-old
  // completed jobs in recentActivity as "Proposal Accepted" today, producing the
  // phantom same-second bulk-flip that flooded snapshot.revenue. Two guards stop
  // that at the source without ever changing a status or mutating a real row:
  //   - over-contract guard: a computed deposit above the contract value means
  //     matchPaymentToEstimate over-matched another job's payment in. Writing it
  //     back would inflate Estimator OS (this is how the >100% depositPaid rows
  //     appeared). Skip and flag instead of propagating the bad number.
  //   - idempotency guard: if Estimator OS already holds this deposit to the
  //     cent, do not re-PUT. No change means no updated_at bump means no phantom
  //     recentActivity entry on the next snapshot rebuild.
  const syncResults = { ok: 0, fail: 0, skipped: 0, unchanged: 0, flagged: 0 };
  for (const job of jobs) {
    if (job.depositsCollected <= 0) continue;
    if (job.source !== 'estimator-os') { syncResults.skipped++; continue; }

    if (job.contractValue && job.depositsCollected > job.contractValue + 1) {
      syncResults.flagged++;
      report.findings.push(`Deposit sync flagged (over-contract, not written): ${job.customer} computed $${job.depositsCollected.toFixed(2)} > contract $${job.contractValue.toFixed(2)}, likely a payment mis-match in matchPaymentToEstimate`);
      continue;
    }

    if (job.currentDepositPaid != null && Math.abs(job.currentDepositPaid - job.depositsCollected) < 1) {
      syncResults.unchanged++;
      continue;
    }

    const firstDeposit = job.payments.find(p => p.type !== 'balance' && p.type !== 'final') || job.payments[0];
    try {
      const resp = await fetch(`${ESTIMATOR_BASE}/estimates/${job.estimateId}`, {
        method: 'PUT',
        headers: { 'x-api-key': ESTIMATOR_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositPaid: job.depositsCollected,
          depositPaidAt: firstDeposit?.date || null
        }),
        signal: AbortSignal.timeout(10000)
      });
      if (resp.ok) syncResults.ok++; else syncResults.fail++;
    } catch (e) { syncResults.fail++; }
  }
  report.findings.push(`Estimator OS sync: ${syncResults.ok} written, ${syncResults.unchanged} unchanged (idempotent skip), ${syncResults.flagged} flagged over-contract, ${syncResults.fail} failed, ${syncResults.skipped} ryujin-only`);

  // 7. Push cashflow section into snapshot
  try {
    await fetch(`${RYUJIN_BASE}/api/snapshot`, {
      method: 'POST',
      headers: snapshotHeaders(),
      body: JSON.stringify({ cashflow: report.cashflow }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    report.findings.push(`Snapshot push failed: ${e.message}`);
  }

  // 8. Write canonical payments rows (migration 051). Idempotent via
  // email_message_id unique constraint — duplicate rows fail silently.
  // Also tries to attach matched_estimate_id from byEstimate map.
  try {
    const { data: tenant } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', PLUS_ULTRA_SLUG).single();
    if (tenant?.id) {
      // Build emailId → estimateId lookup from the matched jobs.
      const matchByEmail = {};
      for (const job of jobs) {
        for (const p of job.payments) matchByEmail[p.emailId] = job.estimateId;
      }
      const rows = payments.map(pmt => ({
        tenant_id: tenant.id,
        payment_date: pmt.date,
        customer_name: pmt.customer,
        amount: pmt.amount,
        invoice_description: pmt.invoiceDescription,
        payment_method: 'card',
        source: 'gmail',
        email_message_id: pmt.emailId,
        // matched_estimate_id is a uuid for ryujin-source estimates and a
        // string id for estimator-os; only persist real uuids to keep the FK happy.
        matched_estimate_id: (matchByEmail[pmt.emailId] && /^[0-9a-f-]{36}$/i.test(matchByEmail[pmt.emailId]))
          ? matchByEmail[pmt.emailId] : null,
        status: matchByEmail[pmt.emailId] ? 'matched' : 'unmatched',
        raw_meta: { invoiceType: pmt.invoiceType, source_estimate_ref: matchByEmail[pmt.emailId] || null },
      }));
      let inserted = 0, dupes = 0, failed = 0;
      for (const r of rows) {
        const { error } = await supabaseAdmin.from('payments').insert(r);
        if (!error) inserted++;
        else if (error.code === '23505') dupes++;   // unique violation = already recorded
        else failed++;
      }
      report.findings.push(`Payments table: ${inserted} new, ${dupes} dupe(s) skipped, ${failed} failed`);
    }
  } catch (e) {
    report.findings.push(`Payments-table write skipped: ${e.message}`);
  }

  return report;
}

// ─── HELPERS ─────────────────────────────────────────────────

function classifyInvoiceType(label) {
  const s = (label || '').toLowerCase();
  if (s.includes('deposit')) return 'deposit';
  if (s.includes('balance')) return 'balance';
  if (s.includes('final')) return 'final';
  if (s.includes('progress')) return 'progress';
  return 'unknown';
}

// matchPaymentToEstimate now lives in lib/paymentMatcher.js (dependency-free so
// it is unit-testable). The address fallback there requires a shared street-name
// token on top of the +-20 civic-number window; the old number-only window
// mis-attributed cross-street payments to whichever estimate sat alone in the
// numeric band. See tests/paymentMatcher.test.mjs.

// ─── HANDLER (on-demand + cron entry point) ──────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const report = await runCashflow();
    return res.json({
      agent: 'cashflow',
      role: 'Finance & AR',
      invocation: req.method === 'GET' ? 'on-demand' : 'cron',
      timestamp: new Date().toISOString(),
      data: report,
      errors: []
    });
  } catch (err) {
    console.error('[Cashflow] FAILED:', err.message);
    return res.status(500).json({ agent: 'cashflow', error: err.message });
  }
}
