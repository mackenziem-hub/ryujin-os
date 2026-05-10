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
          scheduledStartDate: e.scheduledStartDate || null
        }));
      estimates.push(...accepted);
    } else {
      report.findings.push(`Estimator OS fetch failed: HTTP ${r.status}`);
    }
  } catch (e) {
    report.findings.push(`Estimator OS unreachable: ${e.message}`);
  }

  try {
    const r = await fetch(`${RYUJIN_BASE}/api/estimates?tenant=plus-ultra&status=accepted&limit=100`, { signal: AbortSignal.timeout(15000) });
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

  // 4. Match payments to estimates
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
    unmatchedPayments: unmatched
  };

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
  const syncResults = { ok: 0, fail: 0, skipped: 0 };
  for (const job of jobs) {
    if (job.depositsCollected <= 0) continue;
    if (job.source !== 'estimator-os') { syncResults.skipped++; continue; }
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
  report.findings.push(`Estimator OS sync: ${syncResults.ok} ok, ${syncResults.fail} failed, ${syncResults.skipped} ryujin-only (skipped)`);

  // 7. Push cashflow section into snapshot
  try {
    await fetch(`${RYUJIN_BASE}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Match by: exact name → last-name → address-token in invoice description.
// Estimates are the unified pool from BOTH sources (estimator-os + ryujin), each
// with normalized {id, source, fullName, address, finalAcceptedTotal, ...}.
function matchPaymentToEstimate(payment, estimates) {
  const pmtName = (payment.customer || '').toLowerCase().trim();
  if (!pmtName) return null;

  // Exact full-name match
  let hit = estimates.find(e => (e.fullName || '').toLowerCase().trim() === pmtName);
  if (hit) return hit;

  // Last-name match (only if last name is distinctive — avoid "Smith" collisions)
  const pmtParts = pmtName.split(/\s+/);
  const lastName = pmtParts[pmtParts.length - 1];
  if (lastName && lastName.length >= 4) {
    const matches = estimates.filter(e => {
      const fn = (e.fullName || '').toLowerCase();
      const parts = fn.split(/\s+/);
      return parts[parts.length - 1] === lastName;
    });
    if (matches.length === 1) return matches[0];
  }

  // Address-token match from invoice description (e.g. "5380 Rte. 495" → "5380").
  // Allow ±20 on the street number to absorb data-entry slop (5380 vs 5360 case).
  if (payment.invoiceDescription) {
    const numMatch = payment.invoiceDescription.match(/\b(\d{2,5})\b/);
    if (numMatch) {
      const streetNum = parseInt(numMatch[1], 10);
      const exact = estimates.filter(e => (e.address || '').includes(numMatch[1]));
      if (exact.length === 1) return exact[0];
      const fuzzy = estimates.filter(e => {
        const m = (e.address || '').match(/\b(\d{2,5})\b/);
        if (!m) return false;
        return Math.abs(parseInt(m[1], 10) - streetNum) <= 20;
      });
      if (fuzzy.length === 1) return fuzzy[0];
    }
  }

  return null;
}

// ─── HANDLER (on-demand + cron entry point) ──────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }
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
