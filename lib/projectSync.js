// Ryujin OS - Project status sync from work orders
//
// Projects were historically orphaned from the workorders <-> paysheets sync
// loop: issuing or completing a work order never advanced the linked project,
// so finished jobs stayed "active" (or "not_started") forever and scheduled
// jobs never picked up their start date. This module is the write-time bridge.
//
// It is intentionally FORWARD-ONLY and NON-FATAL:
//  - it never downgrades a project or reopens a completed/cancelled one,
//  - any failure here must NOT break the work-order or pay-sheet write that
//    triggered it (the caller has already persisted its own row).
//
// Resolution is by the EXACT estimate link wherever possible: the work order
// carries linked_estimate_id and the project carries estimate_id (populated 1:1
// by the project auto-create trigger), so we pin the specific project even when
// a customer has several jobs (repeat customers, duplex halves). Weaker matches
// (customer -> most-recent project, or a unique exact name) are used ONLY to
// backfill the schedule date, never to drive a lifecycle status change.
import { supabaseAdmin } from './supabase.js';

// WO status -> target project status. issued/draft are deliberately omitted: an
// issued WO is scheduled, not started, so it only syncs the schedule date.
const WO_TO_PROJECT = {
  in_progress: 'active',
  complete: 'complete',
  cancelled: 'cancelled',
};

// Higher rank = further along the lifecycle. A status sync only ever moves a
// project to a higher rank, so a stray issued/in_progress event can never
// reopen or rewind a job that is already further along.
const STATUS_RANK = {
  not_started: 0,
  paused: 1,
  active: 2,
  punch_list: 3,
  complete: 4,
  cancelled: 5,
};

// Resolve the project a work order belongs to.
// Returns { projectId, resolvedBy } where resolvedBy is one of:
//   'estimate' - projects.estimate_id == wo.linked_estimate_id (exact 1:1, trustworthy)
//   'customer' - estimate.customer_id -> most-recent project (ambiguous for repeat customers)
//   'name'     - a UNIQUE exact (case-insensitive) customer_name -> most-recent project (legacy)
// Only an 'estimate' match is allowed to drive a lifecycle status change.
export async function resolveProjectIdFromWorkorder(tenantId, wo) {
  if (!tenantId || !wo) return { projectId: null, resolvedBy: null };

  // Path 1 (authoritative): the WO and its project share an estimate id. This
  // pins the exact project even for repeat customers / duplex halves.
  if (wo.linked_estimate_id) {
    const { data: proj } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('estimate_id', wo.linked_estimate_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proj?.id) return { projectId: proj.id, resolvedBy: 'estimate' };
  }

  // Path 2 (weaker): resolve a customer, then take their most-recent project.
  // Used for SCHEDULE BACKFILL ONLY (never a status change) because a repeat
  // customer's "most recent" project may not be the one this WO belongs to.
  let customerId = null;
  let resolvedBy = null;

  if (wo.linked_estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .eq('id', wo.linked_estimate_id)
      .maybeSingle();
    if (est?.customer_id) { customerId = est.customer_id; resolvedBy = 'customer'; }
  }

  // Path 3 (legacy, strictly guarded): a UNIQUE, exact, case-insensitive name
  // match only. Never a bare substring: an ambiguous, short, or multi-match
  // name resolves to nothing rather than guessing the wrong customer.
  if (!customerId) {
    const name = (wo.customer_name || '').trim();
    const looksFull = name.length >= 6 && name.includes(' ');
    if (looksFull) {
      const { data: matches } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('full_name', name) // no wildcards = exact, case-insensitive
        .limit(2);
      if (matches && matches.length === 1) { customerId = matches[0].id; resolvedBy = 'name'; }
    }
  }

  if (!customerId) return { projectId: null, resolvedBy: null };

  const { data: proj } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { projectId: proj?.id || null, resolvedBy: proj?.id ? resolvedBy : null };
}

// Propagate a work order's state onto its linked project. Forward-only and
// non-fatal. `wo` must carry { status, start_date, linked_estimate_id,
// customer_name }. Returns a small result object for logging; never throws.
export async function syncProjectFromWorkorder(tenantId, wo) {
  try {
    if (!tenantId || !wo) return { synced: false, reason: 'no-input' };

    const { projectId, resolvedBy } = await resolveProjectIdFromWorkorder(tenantId, wo);
    if (!projectId) return { synced: false, reason: 'no-project' };

    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id, status, scheduled_start, started_at')
      .eq('tenant_id', tenantId)
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return { synced: false, reason: 'project-missing' };

    const updates = {};

    // 1) Status: forward-only, AND only when the project was matched by the
    // exact estimate link. A status write (especially `complete`) lights up
    // customer-facing surfaces, so it never fires off a fuzzier customer/name
    // match where the wrong project could be advanced.
    const target = WO_TO_PROJECT[wo.status];
    if (
      target &&
      resolvedBy === 'estimate' &&
      project.status !== 'complete' &&
      project.status !== 'cancelled'
    ) {
      const cur = STATUS_RANK[project.status] ?? 0;
      const next = STATUS_RANK[target] ?? 0;
      if (next > cur) {
        updates.status = target;
        if (target === 'active' && !project.started_at) {
          updates.started_at = new Date().toISOString();
        }
        if (target === 'complete') updates.progress_pct = 100;
      }
    }

    // 2) Schedule: backfill scheduled_start from the WO start_date, never
    // clobbering a hand-set schedule. Non-destructive and null-guarded, so it
    // is allowed for any resolution path.
    if (wo.start_date && !project.scheduled_start) {
      updates.scheduled_start = wo.start_date;
    }

    if (!Object.keys(updates).length) {
      return { synced: false, reason: 'noop', projectId, resolvedBy };
    }

    updates.updated_at = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('id', projectId);
    if (error) return { synced: false, reason: 'update-error', projectId, resolvedBy, error: error.message };

    return { synced: true, projectId, resolvedBy, updates };
  } catch (e) {
    console.warn('[projectSync] sync failed for WO', wo?.id, '-', e?.message);
    return { synced: false, reason: 'exception', error: e?.message };
  }
}
