// ═══════════════════════════════════════════════════════════════
// SIGN CHOREOGRAPHY — the intercom fan-out when a job signs.
//
// Mac's vision: the Companion is the intercom. When a job signs, the right work
// auto-fires to the right people so "everyone is already in place for everything"
// and Mac only verifies the outputs. Locked roster (2026-06-28):
//   Paysheet           -> Ryan            (subcontractor labour)
//   Work order         -> Mac + Cat + Diego (one shared WO for the job)
//   Schedule task      -> Cat             (book the install)
//   Pre-site inspection-> Diego           (inspect + upload photos)
// Auto-create immediately on sign; Mac verifies material order + inspection photos.
//
// planSignFanout() is PURE (no DB): given the signed job + the resolved people,
// it returns the exact artifacts that WOULD be created. The dry-run prints this
// so the roster + dollar values can be eyeballed BEFORE anything auto-creates
// (paysheets are real money). executeSignFanout() (added when we wire it live)
// will create these via the existing primitives, idempotent + fail-soft.
//
// Paysheet labour: per feedback_paysheet_eagleview_basis, Ryan's pay is re-rated
// to the EagleView measurements, NOT the customer price. The planner takes an
// optional job.labour_total; when absent it flags that the amount is computed
// from the aerial at execute time, so we never put the customer total on a paysheet.
// ═══════════════════════════════════════════════════════════════

const money = (n) => (n == null ? null : Number(n));

/**
 * Plan the sign fan-out. Pure: returns the artifact specs, creates nothing.
 * @param {object} job     signed job: { customer/customer_name, address, phone, email,
 *                         total_incl_hst, deposit, scope_summary, job_type,
 *                         estimate_id|quote_id, labour_total? }
 * @param {object} people  resolved user ids: { ryan, diego, cat, mac }
 * @returns {{ job: object, artifacts: object[], warnings: string[] }}
 */
export function planSignFanout(job = {}, people = {}) {
  const cust = job.customer || job.customer_name || 'customer';
  const addr = job.address || 'job site';
  const jobLabel = `${cust} - ${addr}`;
  const estId = job.estimate_id || job.quote_id || null;
  const total = money(job.total_incl_hst);
  const labour = money(job.labour_total);
  const warnings = [];

  // Guard: never fan out to a missing person (a fan-out target must be a real user).
  for (const [role, id] of Object.entries({ Ryan: people.ryan, Diego: people.diego, Cat: people.cat, Mac: people.mac })) {
    if (!id) warnings.push(`No user id resolved for ${role} - that artifact cannot land until ${role} has an account.`);
  }

  const artifacts = [
    {
      kind: 'paysheet', to: 'Ryan', to_id: people.ryan || null,
      table: 'paysheets',
      fields: {
        subcontractor_id: people.ryan || null,
        customer_name: cust, address: addr,
        job_type: job.job_type || 'roof',
        status: 'draft', state: 'draft',
        linked_estimate_id: estId,
        total: labour, // labour only; null -> computed from EagleView at execute
        scope_notes: job.scope_summary || null,
      },
      note: labour == null
        ? 'labour amount computed from the EagleView measurements at execute (feedback_paysheet_eagleview_basis); NEVER the customer total'
        : `labour $${labour}`,
    },
    {
      kind: 'workorder', to: 'Mac + Cat + Diego (shared)', to_id: null,
      table: 'workorders',
      fields: {
        customer_name: cust, address: addr, phone: job.phone || null,
        job_type: job.job_type || 'roof', status: 'draft',
        linked_estimate_id: estId,
        sub_crew_lead: 'Ryan',
        scope_items: job.scope_summary || null,
      },
      note: 'one WO for the job; Mac, Cat, and Diego all see it in the Companion (workorders surface to admin + crew)',
    },
    {
      kind: 'task', to: 'Cat', to_id: people.cat || null,
      table: 'tickets',
      fields: {
        title: `Schedule the job: ${jobLabel}`,
        assigned_to: people.cat || null, priority: 'high', status: 'open',
        estimate_id: estId,
        description: `${cust} signed${total != null ? ` ($${total.toLocaleString()})` : ''}. Book the install date and confirm crew. Address: ${addr}.`,
      },
      note: 'scheduling = a task to Cat (auto-book is a later phase once availability logic exists)',
    },
    {
      kind: 'task', to: 'Diego', to_id: people.diego || null,
      table: 'tickets',
      fields: {
        title: `Pre-site inspection: ${addr}`,
        assigned_to: people.diego || null, priority: 'high', status: 'open',
        estimate_id: estId,
        description: `${cust} signed. Do the pre-site inspection at ${addr} and upload photos for Mac to review.`,
      },
      note: 'Mac reviews the inspection photos after',
    },
  ];

  return {
    job: { customer: cust, address: addr, total_incl_hst: total, estimate_id: estId },
    artifacts,
    warnings,
  };
}

export default { planSignFanout };
