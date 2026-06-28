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
  // estimate_id is a UUID FK column. A quote_id CODE string (e.g. "PU-2026-RS330")
  // is NOT a UUID and would 500 every artifact insert (invalid input for type uuid),
  // which fail-soft then silently swallows -> a signing that fans out NOTHING. So
  // only accept a real UUID here; anything else (a quote code, etc.) -> null
  // (the artifacts still fire, just not FK-linked to an estimate row).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawEst = job.estimate_id || null;
  const estId = (typeof rawEst === 'string' && UUID_RE.test(rawEst)) ? rawEst : null;
  const total = money(job.total_incl_hst);
  const labour = money(job.labour_total);
  const warnings = [];

  // Guard: never fan out to a missing person (a fan-out target must be a real user).
  for (const [role, id] of Object.entries({ Ryan: people.ryan, Diego: people.diego, Cat: people.cat, Mac: people.mac })) {
    if (!id) warnings.push(`No user id resolved for ${role} - that artifact cannot land until ${role} has an account.`);
  }

  const artifacts = [
    {
      // v1: a paysheets ROW needs a job_id (project) + the EagleView labour, neither
      // present at the instant of signing. So Ryan's pay fires as a draft task to
      // the office (Cat) to re-rate it to the aerial (feedback_paysheet_eagleview_basis).
      // Auto-creating the paysheet row is phase 2 (once the job/project + labour exist).
      kind: 'task', to: 'Cat (Ryan paysheet)', to_id: people.cat || null,
      table: 'tickets',
      fields: {
        title: `Draft Ryan's paysheet: ${jobLabel}`,
        assigned_to: people.cat || null, priority: 'high', status: 'open',
        estimate_id: estId,
        description: `${cust} signed${total != null ? ` ($${total.toLocaleString()})` : ''}. Draft Ryan's subcontractor paysheet, labour re-rated to the EagleView measurements (NOT the customer price). Address: ${addr}.`,
      },
      note: 'paysheet fires as a draft-from-EagleView task (a paysheet row needs a job_id + labour not present at sign); auto-create is phase 2',
    },
    {
      kind: 'workorder', to: 'Mac + Cat + Diego (shared)', to_id: null,
      table: 'workorders',
      fields: {
        customer_name: cust, address: addr, phone: job.phone || null,
        job_type: 'full_replacement', // workorders CHECK: full_replacement|repair|gutters|siding|other
        status: 'draft',
        linked_estimate_id: estId,
        sub_crew_lead: 'Ryan',
        special_notes: job.scope_summary || null, // text; scope_items is jsonb, keep it out to avoid a type error
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

/**
 * Execute the fan-out: create the planned artifacts via the app's OWN POST APIs
 * (which handle numbering + validation), with the service token. Idempotent (skips
 * if this estimate already fanned out) and FAIL-SOFT (a per-artifact failure is
 * recorded, never thrown, so a hiccup can never break the signing that called it).
 *
 * @param {object} job, people  same as planSignFanout
 * @param {object} opts  { baseUrl, serviceToken, tenant, fetchImpl? }
 * @returns {{ created: object[], skipped: string|false, estId }}
 */
export async function executeSignFanout(job, people, opts = {}) {
  const baseUrl = (opts.baseUrl || 'https://ryujin-os.vercel.app').replace(/\/+$/, '');
  const tenant = opts.tenant || 'plus-ultra';
  const f = opts.fetchImpl || fetch;
  const headers = {
    'Content-Type': 'application/json',
    'x-tenant-id': tenant,
    ...(opts.serviceToken ? { Authorization: `Bearer ${opts.serviceToken}` } : {}),
  };
  const plan = planSignFanout(job, people);
  const estId = plan.job.estimate_id;
  const EP = { paysheet: '/api/paysheets', workorder: '/api/workorders', task: '/api/tickets' };

  // Idempotency: if the schedule task for THIS exact job already exists, the
  // fan-out already ran -> skip (a re-accept must not double-fire). Exact-title
  // match is job-specific (customer + address), so it is correct even if the
  // tickets GET does not filter by estimate_id.
  const schedTitle = plan.artifacts.find(a => a.fields && /^Schedule the job:/.test(a.fields.title || ''))?.fields.title;
  if (schedTitle) {
    try {
      const r = await f(`${baseUrl}/api/tickets${estId ? `?estimate_id=${encodeURIComponent(estId)}` : ''}`, { headers });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const arr = (j && (j.tickets || j.items)) || (Array.isArray(j) ? j : []);
        if (Array.isArray(arr) && arr.some(t => (t.title || '') === schedTitle)) {
          return { created: [], skipped: 'already fanned out for this job', estId };
        }
      }
    } catch { /* non-fatal: proceed; a rare dup is better than a missed fan-out */ }
  }

  const created = [];
  for (const a of plan.artifacts) {
    try {
      const r = await f(`${baseUrl}${EP[a.kind]}`, { method: 'POST', headers, body: JSON.stringify(a.fields) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { created.push({ kind: a.kind, to: a.to, error: j.error || `HTTP ${r.status}` }); continue; }
      const id = j.id || j.ticket?.id || j.workorder?.id || j.paysheet?.id || j.data?.id || null;
      created.push({ kind: a.kind, to: a.to, id, number: j.ticket_number || j.wo_number || j.data?.wo_number || null });
    } catch (e) {
      created.push({ kind: a.kind, to: a.to, error: e.message }); // fail-soft: record, never throw
    }
  }
  return { created, skipped: false, estId };
}

export default { planSignFanout, executeSignFanout };
