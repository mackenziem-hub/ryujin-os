/*
 * Ryujin OS · v2 live data adapter
 *
 * Same shape as _data.js but fetches real records from the existing
 * tenant-scoped CRUD endpoints (no Supabase joins, no graph API yet).
 *
 * Endpoints used (all GET, tenant-scoped via ?tenant=<slug>):
 *   /api/customers
 *   /api/tickets
 *   /api/estimates
 *   /api/custom-proposals
 *
 * Returns a single normalized object the v2 pages can render against.
 * Missing tables or fetch failures degrade gracefully to empty arrays
 * rather than falling back to synthetic data (silent fake data is worse
 * than visibly empty).
 */

// Inlined Bearer header pull. The auth-guard.js script loaded synchronously
// from the HTML page redirects logged-out users before this module ever
// runs, so a token should always be present when these calls fire. Endpoints
// (api/customers, api/tickets, api/estimates, api/custom-proposals) require
// the bearer as of 2026-05-22 (see v2-auth-guard PR).
function authHeader() {
  try {
    const tok = localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token');
    return tok ? { Authorization: `Bearer ${tok}` } : {};
  } catch { return {}; }
}

function safeFetch(url) {
  return fetch(url, { cache: 'no-store', headers: authHeader() })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`)))
    .catch(e => {
      console.warn('[ry-live] fetch failed', url, e.message);
      return null;
    });
}

function tenantParam(slug) {
  return slug ? `?tenant=${encodeURIComponent(slug)}` : '';
}

// Escape user-controlled text fields BEFORE storing in the normalized
// data object. The v2 pages render via template-literal innerHTML, so
// any unescaped DB string (a customer name like "<script>...") would
// execute. Doing this once in the adapter keeps every consumer safe
// without retrofitting every renderer.
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Normalized records keep RAW strings so .textContent consumers render
// readable text. Renderers using template-literal innerHTML must wrap
// these fields in escapeHtml() at the interpolation point.
function pickName(c) {
  return c.full_name || c.name || 'Unnamed';
}

function pickAddress(c) {
  if (c.address && c.city) return `${c.address}, ${c.city} ${c.province || ''}`.trim();
  return c.address || c.city || '';
}

function pickAssignee(t) {
  // The /api/tickets endpoint joins assigned_user so we get a display
  // name; if missing, fall back to the UUID. Filter callers compare
  // by display name, not UUID.
  return t.assigned_user?.full_name || t.assigned_user?.name || t.assigned_to || '';
}

function isoToDate(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

function isoToHHMM(iso) {
  if (!iso) return '--:--';
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '--:--';
  }
}

// Passing a null/undefined tenantSlug omits the ?tenant= query param so the
// server resolves tenant from the request host (custom-domain tenants). Do
// NOT default to a literal slug here; that's exactly the multi-tenant leak
// codex caught on PR #17 (P1, 2026-05-22).
export async function loadLiveData(tenantSlug) {
  const qs = tenantParam(tenantSlug);
  // Existing endpoints default to limit=50 server-side. The cockpit
  // overview wants to count and link across all records, so request
  // a higher cap. If pagination ever becomes needed, paging through
  // pages here is the right next step.
  const sep = qs ? '&' : '?';
  const LIMIT = `${sep}limit=1000`;
  const [cust, tix, est, cprop, wo] = await Promise.all([
    safeFetch(`/api/customers${qs}${LIMIT}`),
    safeFetch(`/api/tickets${qs}${LIMIT}`),
    safeFetch(`/api/estimates${qs}${LIMIT}`),
    safeFetch(`/api/custom-proposals${qs}${LIMIT}`),
    safeFetch(`/api/workorders${qs}${LIMIT}`)
  ]);

  // Normalize each into v2 shape.
  const customers = (cust?.customers || []).map(c => ({
    id: c.id,
    name: pickName(c),
    address: pickAddress(c),
    phone: c.phone || '',
    since: isoToDate(c.created_at) || '',
    ltv: 0, // derived later from estimates/proposals
    status: 'active',
    raw: c
  }));

  const customerIndex = new Map(customers.map(c => [c.id, c]));

  // Treat estimates with proposal_mode as "jobs" surrogate. Active/signed
  // stage data isn't reliably set on every row, so render the full set
  // and tag with the estimate_number as the identifier.
  const jobs = (est?.estimates || []).map(e => {
    // Address fallback chain: in-page customer index, then the joined
    // customer payload that /api/estimates returns for customers outside
    // the first /api/customers page.
    let address = customerIndex.get(e.customer_id)?.address;
    if (!address && e.customer) {
      address = e.customer.address && e.customer.city
        ? `${e.customer.address}, ${e.customer.city} ${e.customer.province || ''}`.trim()
        : (e.customer.address || e.customer.city || '');
    }
    return {
      id: e.id,
      customerId: e.customer_id,
      address: address || '(no address)',
      stage: e.status || 'estimated',
      value: Number(e.total_with_tax || e.total || 0),
      startDate: isoToDate(e.created_at) || '',
      estimateNumber: e.estimate_number,
      crew: [],
      raw: e
    };
  });

  const tickets = (tix?.tickets || []).map(t => ({
    id: t.id,
    customerId: t.customer_id,
    title: t.title || '(no title)',
    priority: t.priority || 'med',
    dueDate: isoToDate(t.due_date) || '',
    assignedTo: pickAssignee(t),
    ticketNumber: t.ticket_number,
    status: t.status || 'open',
    raw: t
  }));

  // Custom proposals only for now (the estimates table is the legacy
  // proposal source; we surface signed estimates separately if needed).
  // custom_proposals has no FK to customers; derive linkage by name match
  // so the v2 renderers can group proposals under their customer. The
  // index is built from the RAW unescaped names so apostrophes/ampersands
  // in customer names like "O'Brien" or "AT&T" still match the raw
  // customer_name on the proposal.
  const customerNameIndex = new Map(
    customers
      .map(c => [String(c.raw?.full_name || c.raw?.name || '').toLowerCase().trim(), c.id])
      .filter(([k]) => k)
  );
  function findCustomerIdByName(rawName) {
    if (!rawName) return null;
    const key = String(rawName).toLowerCase().trim();
    if (customerNameIndex.has(key)) return customerNameIndex.get(key);
    // Loose match: first token of either name string
    const firstWord = key.split(/\s+/)[0];
    if (!firstWord) return null;
    for (const [cname, cid] of customerNameIndex) {
      if (cname.split(/\s+/)[0] === firstWord) return cid;
    }
    return null;
  }

  const proposals = (cprop?.proposals || []).map(p => ({
    id: p.id,
    customerId: findCustomerIdByName(p.customer_name),
    customerName: p.customer_name || '',
    address: p.address || '',
    quoteId: p.quote_id || p.slug || '',
    status: p.status || 'draft',
    value: Number(p.total_incl_hst || p.subtotal || 0),
    date: isoToDate(p.issued_date) || isoToDate(p.created_at) || ''
  }));

  // Workorders are the production source of truth (the actual jobs the crew
  // works) — distinct from estimates (sales pipeline). v1 production.html
  // pulls from this same table; v2 production pillar should match. Status
  // values: draft → issued → in_progress → complete (or cancelled).
  // customerId: workorder has customer_name string; resolve by name index
  // since workorders don't carry a customer_id FK directly.
  const workorders = (wo?.workorders || []).map(w => {
    // Trust completed_at as the source of truth for "is this job done?".
    // The closeout flow can leave w.status='issued' (or other) while
    // stamping completed_at — caught on WO-17 Jonald Magarin 2026-05-22.
    // A completed workorder should always render as complete in v2 buckets
    // regardless of what the status column says, until that flow is fixed.
    const rawStatus = w.status || 'draft';
    const effectiveStatus = w.completed_at ? 'complete' : rawStatus;
    return {
      id: w.id,
      woNumber: w.wo_number,
      customerId: findCustomerIdByName(w.customer_name),
      customerName: w.customer_name || '',
      address: w.address || '(no address)',
      phone: w.phone || '',
      status: effectiveStatus,
      stage: effectiveStatus,
      rawStatus,
      startDate: isoToDate(w.start_date) || '',
      completedAt: isoToDate(w.completed_at) || '',
      durationDays: w.estimated_duration_days || null,
      packageTier: w.package_tier || '',
      totalSq: Number(w.total_sq || 0),
      subCrewLead: w.sub_crew_lead || '',
      jobType: w.job_type || '',
      estimateNumber: w.estimate?.estimate_number || null,
      paysheetStatus: w.paysheet?.status || null,
      notes: w.special_notes || w.notes || '',
      raw: w
    };
  });

  // Compute lifetime value per customer from their jobs and proposals.
  // Use the already-normalized customerId on each proposal; the per-iteration
  // first-token substring match used to bucket a single "John Smith" proposal
  // into every customer whose name starts with "john".
  for (const c of customers) {
    const fromJobs = jobs.filter(j => j.customerId === c.id).reduce((s, j) => s + (j.value || 0), 0);
    const fromProps = proposals
      .filter(p => p.customerId === c.id)
      .reduce((s, p) => s + (p.value || 0), 0);
    c.ltv = Math.round(fromJobs + fromProps);
  }

  // Build a "today" event stream from recent rows across tables.
  const eventCandidates = [];
  customers.forEach(c => {
    if (c.raw?.created_at) {
      eventCandidates.push({
        ts: c.raw.created_at,
        time: isoToHHMM(c.raw.created_at),
        pillar: 'customer',
        title: `New customer · ${c.name}`,
        sub: c.address || ''
      });
    }
  });
  tickets.forEach(t => {
    if (t.raw?.created_at) {
      eventCandidates.push({
        ts: t.raw.created_at,
        time: isoToHHMM(t.raw.created_at),
        pillar: t.priority === 'high' ? 'service' : 'production',
        title: `Ticket #${t.ticketNumber} · ${t.title}`,
        sub: t.status || ''
      });
    }
  });
  proposals.forEach(p => {
    eventCandidates.push({
      ts: p.date,
      time: isoToHHMM(p.date),
      pillar: 'sales',
      title: `${p.quoteId} · ${p.status}${p.value ? ' · $' + p.value.toLocaleString('en-CA') : ''}`,
      sub: p.customerName || ''
    });
  });
  jobs.forEach(j => {
    if (j.raw?.created_at) {
      eventCandidates.push({
        ts: j.raw.created_at,
        time: isoToHHMM(j.raw.created_at),
        pillar: 'sales',
        title: `Estimate #${j.estimateNumber} · ${j.stage}${j.value ? ' · $' + j.value.toLocaleString('en-CA') : ''}`,
        sub: j.address
      });
    }
  });
  // Workorders drive the production event stream. Completion events take
  // priority (most informative); newly-issued workorders are still surfaced
  // via their created_at.
  workorders.forEach(w => {
    if (w.raw?.completed_at) {
      eventCandidates.push({
        ts: w.raw.completed_at,
        time: isoToHHMM(w.raw.completed_at),
        pillar: 'production',
        title: `WO-${w.woNumber} complete · ${w.customerName}`,
        sub: w.address
      });
    } else if (w.raw?.created_at) {
      eventCandidates.push({
        ts: w.raw.created_at,
        time: isoToHHMM(w.raw.created_at),
        pillar: 'production',
        title: `WO-${w.woNumber} · ${w.status} · ${w.customerName}`,
        sub: w.address
      });
    }
  });
  const events = eventCandidates
    .filter(e => e.ts)
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 12)
    .map(({ ts, ...rest }) => rest);

  // Derive stats per pillar from real counts.
  const signedMtd = proposals
    .filter(p => p.status === 'signed' && p.date && p.date.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, p) => s + p.value, 0);
  const pipelineValue = jobs.reduce((s, j) => s + j.value, 0);
  const openTickets = tickets.filter(t => t.status !== 'done' && t.status !== 'cancelled').length;

  const today = new Date().toISOString().slice(0, 10);
  const ticketsDueToday = tickets.filter(t => t.dueDate === today).length;

  // Production stats now key off workorders (real jobs), not estimates.
  const activeWO = workorders.filter(w => w.status === 'in_progress').length;
  const scheduledWO = workorders.filter(w => w.status === 'issued').length;
  const completeWO = workorders.filter(w => w.status === 'complete').length;
  const todaysWO = workorders.filter(w => w.startDate === today).length;

  const stats = {
    hq: [
      { label: 'Today',       value: `${events.length} events` },
      { label: 'Pipeline',    value: '$' + Math.round(pipelineValue).toLocaleString('en-CA') },
      { label: 'Active jobs', value: String(activeWO + scheduledWO) },
      { label: 'Customers',   value: String(customers.length) }
    ],
    sales: [
      { label: 'Pipeline',    value: '$' + Math.round(pipelineValue).toLocaleString('en-CA') },
      { label: 'Signed MTD',  value: '$' + Math.round(signedMtd).toLocaleString('en-CA') },
      { label: 'Estimates',   value: String(jobs.length) },
      { label: 'Custom prop', value: String(proposals.length) }
    ],
    production: [
      { label: 'Active',      value: String(activeWO) },
      { label: 'Scheduled',   value: String(scheduledWO) },
      { label: 'Complete',    value: String(completeWO) },
      { label: 'Today',       value: String(todaysWO) }
    ],
    service: [
      { label: 'Open tickets', value: String(openTickets) },
      { label: 'Due today',   value: String(ticketsDueToday) },
      { label: 'High prio',   value: String(tickets.filter(t => t.priority === 'high').length) },
      { label: 'Total',       value: String(tickets.length) }
    ],
    customer: [
      { label: 'Total',    value: String(customers.length) },
      { label: 'New MTD',  value: String(customers.filter(c => (c.since || '').startsWith(today.slice(0, 7))).length) },
      { label: 'With LTV', value: String(customers.filter(c => c.ltv > 0).length) },
      { label: 'Phone',    value: String(customers.filter(c => c.phone).length) }
    ],
    finance:   [ { label: 'Pipeline',  value: '$' + Math.round(pipelineValue).toLocaleString('en-CA') }, { label: 'Signed MTD', value: '$' + Math.round(signedMtd).toLocaleString('en-CA') }, { label: 'Phase 4', value: 'AR · AP' }, { label: 'Phase 4', value: 'P&L' } ],
    materials: [ { label: 'Phase 4',   value: 'wires up next' }, { label: 'POs',    value: '-' }, { label: 'In stock', value: '-' }, { label: 'Low',  value: '-' } ],
    marketing: [ { label: 'Phase 4',   value: 'wires up next' }, { label: 'Clips',  value: '-' }, { label: 'Scheduled', value: '-' }, { label: 'Posted', value: '-' } ],
    admin:     [ { label: 'Customers', value: String(customers.length) }, { label: 'Tickets', value: String(tickets.length) }, { label: 'Estimates', value: String(jobs.length) }, { label: 'Proposals', value: String(proposals.length) } ]
  };

  return {
    tenant: {
      name: 'Plus Ultra Roofing', // overridden by _tenant.js
      today
    },
    pillars: [
      { slug: 'hq',         label: 'HQ',         tone: 'charcoal',  blurb: 'Today across the business.' },
      { slug: 'sales',      label: 'Sales',      tone: 'copper',    blurb: 'Pipeline and conversion.' },
      { slug: 'production', label: 'Production', tone: 'moss',      blurb: 'Active jobs and crews.' },
      { slug: 'service',    label: 'Service',    tone: 'amber',     blurb: 'Tickets and repairs.' },
      { slug: 'customer',   label: 'Customer',   tone: 'slate',     blurb: 'Relationships and reviews.' },
      { slug: 'finance',    label: 'Finance',    tone: 'finance',   blurb: 'AR, AP, P&L.' },
      { slug: 'materials',  label: 'Materials',  tone: 'materials', blurb: 'Inventory and orders.' },
      { slug: 'marketing',  label: 'Marketing',  tone: 'ochre',     blurb: 'Clips and campaigns.' },
      { slug: 'admin',      label: 'Admin',      tone: 'admin',     blurb: 'Team, settings, integrations.' }
    ],
    customers,
    jobs,
    workorders,
    tickets,
    proposals,
    events,
    stats,
    source: 'live'
  };
}

export function fmtMoney(n) {
  if (n == null) return '$0';
  return '$' + Number(n).toLocaleString('en-CA');
}

export function customerById(LIVE, id)   { return LIVE.customers.find(c => c.id === id) || null; }
export function jobsForCustomer(LIVE, id) { return LIVE.jobs.filter(j => j.customerId === id); }
export function workordersForCustomer(LIVE, id) { return (LIVE.workorders || []).filter(w => w.customerId === id); }
export function ticketsForCustomer(LIVE, id) { return LIVE.tickets.filter(t => t.customerId === id); }
export function pillarBySlug(LIVE, slug)  { return LIVE.pillars.find(p => p.slug === slug) || null; }
export function eventsForPillar(LIVE, slug) {
  return slug === 'hq' ? LIVE.events : LIVE.events.filter(e => e.pillar === slug);
}
