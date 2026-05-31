// ═══════════════════════════════════════════════════════════════
// /api/schedule — admin view of scheduled installs + service tickets
// across the next N days. Powers /admin-dispatch.html.
//
//   GET /api/schedule?days=14
//   Headers: Authorization: Bearer <session token>, x-tenant-id
//
// Returns:
//   {
//     days: [
//       { date: '2026-05-12', installs: [...], service: [...] }
//     ],
//     total_installs: N,
//     total_service: N,
//   }
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required' });
  // Schedule read is open to any authenticated tenant member — crew need it
  // to see their own dispatch list on portal-mobile. (Admin-only writes/edits
  // happen on other endpoints.) Tenant scoping below filters to the user's
  // tenant via requireTenant + req.tenant.id.
  void isPrivileged; // kept imported for parity with other handlers

  const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 14));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + days * 86400000);

  const todayIso = today.toISOString();
  const todayDay = todayIso.slice(0, 10);
  const horizonIso = horizon.toISOString();
  const horizonDay = horizonIso.slice(0, 10);

  // Estimates with a scheduled_at in the window. (migration_038 added
  // scheduled_at as a timestamptz; there's no separate start/end date.)
  // We embed the auto-created project so the mobile dispatch list can wire
  // each card to /api/files for photo capture.
  const ests = await supabaseAdmin
    .from('estimates')
    .select(`
      id, estimate_number, scheduled_at, state, final_accepted_total, deposit_amount,
      customer:customers(full_name, phone, address),
      projects(id, share_token, status, progress_pct, started_at, scheduled_end, crew_members,
               crew_lead:users!projects_crew_lead_id_fkey(id, name, avatar_url))
    `)
    .eq('tenant_id', req.tenant.id)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', todayIso)
    .lte('scheduled_at', horizonIso)
    .order('scheduled_at', { ascending: true })
    .limit(120);

  if (ests.error) {
    console.error('[schedule] estimates query failed:', ests.error.message);
    return res.status(500).json({ error: 'schedule_query_failed', message: ests.error.message });
  }

  // Resolve crew_members uuid[] → list of {id, name, avatar_url} for every
  // project in the window in a single round-trip. Cheap with small N.
  const allCrewIds = new Set();
  for (const e of ests.data || []) {
    for (const p of (e.projects || [])) {
      for (const uid of (p.crew_members || [])) allCrewIds.add(uid);
    }
  }
  const crewById = {};
  if (allCrewIds.size > 0) {
    const cr = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url')
      .in('id', [...allCrewIds]);
    for (const u of (cr.data || [])) crewById[u.id] = u;
  }

  // Service tickets with a scheduled_at in the window.
  const tix = await supabaseAdmin
    .from('service_tickets')
    .select('id, title, scheduled_at, priority, status, customer:customers(full_name, phone)')
    .eq('tenant_id', req.tenant.id)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', todayIso)
    .lte('scheduled_at', horizonIso)
    .order('scheduled_at', { ascending: true })
    .limit(120);

  if (tix.error) {
    console.error('[schedule] service_tickets query failed (non-fatal):', tix.error.message);
    tix.data = [];
  }

  // Workorders with start_date in the window. In practice this is the source
  // of truth for upcoming installs — estimates.scheduled_at is sparsely
  // populated (most jobs get scheduled by issuing the WO, not by stamping
  // the estimate). Without this query, /api/schedule misses every active
  // install and shows only whichever stale estimate happens to have an
  // un-cleared scheduled_at in range.
  const wos = await supabaseAdmin
    .from('workorders')
    .select(`
      id, wo_number, start_date, estimated_duration_days, status, customer_name, address, phone,
      sub_crew_lead, total_sq, linked_estimate_id, special_notes,
      estimate:estimates!workorders_linked_estimate_id_fkey(
        id, estimate_number, final_accepted_total, deposit_amount,
        customer:customers(full_name, phone, address),
        projects(id, share_token, status, progress_pct, started_at, scheduled_end, crew_members,
                 crew_lead:users!projects_crew_lead_id_fkey(id, name, avatar_url))
      )
    `)
    .eq('tenant_id', req.tenant.id)
    .not('start_date', 'is', null)
    .not('status', 'in', '("complete","cancelled")')
    .gte('start_date', todayDay)
    .lte('start_date', horizonDay)
    .order('start_date', { ascending: true })
    .limit(120);

  if (wos.error) {
    console.error('[schedule] workorders query failed (non-fatal):', wos.error.message);
    wos.data = [];
  }

  // Merge workorder-linked project crew_member ids into the lookup set so
  // crew avatars resolve for WO-driven installs the same way they do for
  // estimate-driven ones.
  for (const w of wos.data || []) {
    for (const p of (w.estimate?.projects || [])) {
      for (const uid of (p.crew_members || [])) allCrewIds.add(uid);
    }
  }
  if (allCrewIds.size > 0) {
    const cr2 = await supabaseAdmin
      .from('users')
      .select('id, name, avatar_url')
      .in('id', [...allCrewIds]);
    for (const u of (cr2.data || [])) crewById[u.id] = u;
  }

  // Photo count per project, single round-trip for the whole window.
  const projectIds = [
    ...(ests.data || []).flatMap(e => (e.projects || []).map(p => p.id)),
    ...(wos.data || []).flatMap(w => (w.estimate?.projects || []).map(p => p.id)),
  ].filter(Boolean);
  const photoCountByProject = {};
  if (projectIds.length > 0) {
    const pc = await supabaseAdmin
      .from('project_files')
      .select('project_id')
      .in('project_id', projectIds);
    for (const row of pc.data || []) {
      photoCountByProject[row.project_id] = (photoCountByProject[row.project_id] || 0) + 1;
    }
  }

  // Bucket by day. Estimates use scheduled_start_date (date-only).
  // Service tickets use scheduled_at (timestamp) — bucket by its day.
  const byDay = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    byDay.set(d.toISOString().slice(0, 10), { date: d.toISOString().slice(0, 10), installs: [], service: [] });
  }

  // Also collect a flat job list — the mobile dispatch surface flattens by
  // day-then-time, the admin grid keeps the per-day buckets.
  const jobs = [];

  // Map estimate id -> its backing workorder (if any). When an estimate keeps a
  // scheduled_at AND has a linked WO, the dedup below renders the estimate
  // install and skips the WO row; attaching the WO here keeps that install
  // editable from the calendar and writing to the right workorder.
  const woByEstimateId = {};
  for (const w of (wos.data || [])) if (w.linked_estimate_id) woByEstimateId[w.linked_estimate_id] = w;

  for (const e of ests.data || []) {
    const key = (e.scheduled_at || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    const linkedProject = (e.projects && e.projects[0]) || null;
    const linkedWo = woByEstimateId[e.id] || null;
    const crewIds = linkedProject?.crew_members || [];
    let crew = crewIds.map(id => crewById[id]).filter(Boolean);
    // Fallback: if crew_members[] is empty but crew_lead exists, show the
    // lead as the single crew avatar (Codex round caught the "No crew
    // assigned" state on crew-lead-only projects).
    if (crew.length === 0 && linkedProject?.crew_lead) crew = [linkedProject.crew_lead];
    const install = {
      id: e.id,
      label: e.customer?.full_name || 'Unnamed customer',
      ref: e.estimate_number || `est-${e.id.slice(0, 6)}`,
      state: e.state || null,
      address: e.customer?.address || null,
      phone: e.customer?.phone || null,
      value: e.final_accepted_total || e.deposit_amount || null,
      time: (e.scheduled_at || '').slice(11, 16),
      // Mobile dispatch + Jobs card v2 fields. Bundles the auto-created
      // project + state machine + crew. Jobs card uses `live` (computed
      // from status === 'active') to render the pulsing LIVE pill.
      scheduled_at: e.scheduled_at,
      project_id: linkedProject?.id || null,
      share_token: linkedProject?.share_token || null,
      project_status: linkedProject?.status || null,
      live: (linkedProject?.status || '').toLowerCase() === 'active',
      progress_pct: linkedProject?.progress_pct ?? null,
      started_at: linkedProject?.started_at || null,
      scheduled_end: linkedProject?.scheduled_end || null,
      crew_lead: linkedProject?.crew_lead || null,
      crew,
      photo_count: linkedProject ? (photoCountByProject[linkedProject.id] || 0) : 0,
      // WO backing (see woByEstimateId): lets the calendar edit this install in
      // place and write to the real workorder row, with accurate prefills.
      wo_id: linkedWo?.id || null,
      wo_start_date: linkedWo?.start_date || null,
      wo_number: linkedWo?.wo_number || null,
      sub_crew_lead: linkedWo?.sub_crew_lead || null,
      duration_days: linkedWo?.estimated_duration_days || null,
      special_notes: linkedWo?.special_notes || null,
    };
    byDay.get(key).installs.push(install);
    jobs.push(install);
  }

  // Dedupe: if an estimate with scheduled_at already covered a project, skip
  // the workorder row for the same project so the install only renders once.
  const seenProjectIds = new Set(jobs.map(j => j.project_id).filter(Boolean));

  for (const w of wos.data || []) {
    const key = (w.start_date || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    const linkedProject = (w.estimate?.projects && w.estimate.projects[0]) || null;
    if (linkedProject?.id && seenProjectIds.has(linkedProject.id)) continue;
    const crewIds = linkedProject?.crew_members || [];
    let crew = crewIds.map(id => crewById[id]).filter(Boolean);
    if (crew.length === 0 && linkedProject?.crew_lead) crew = [linkedProject.crew_lead];
    const wInstall = {
      id: w.estimate?.id || w.id,
      label: w.estimate?.customer?.full_name || w.customer_name || 'Unnamed customer',
      ref: w.wo_number ? `WO-${w.wo_number}` : (w.estimate?.estimate_number || `wo-${w.id.slice(0, 6)}`),
      state: w.status || null,
      address: w.estimate?.customer?.address || w.address || null,
      phone: w.estimate?.customer?.phone || w.phone || null,
      value: w.estimate?.final_accepted_total || w.estimate?.deposit_amount || null,
      time: '',  // workorders are date-only, not timestamped
      scheduled_at: w.start_date,
      project_id: linkedProject?.id || null,
      share_token: linkedProject?.share_token || null,
      project_status: linkedProject?.status || null,
      live: (linkedProject?.status || '').toLowerCase() === 'active',
      progress_pct: linkedProject?.progress_pct ?? null,
      started_at: linkedProject?.started_at || null,
      scheduled_end: linkedProject?.scheduled_end || null,
      crew_lead: linkedProject?.crew_lead || null,
      crew,
      photo_count: linkedProject ? (photoCountByProject[linkedProject.id] || 0) : 0,
      wo_number: w.wo_number || null,
      // The event `id` above is the estimate id for estimate-linked WOs, so it
      // is NOT safe to PUT against /api/workorders. Carry the real workorder id
      // + its own start_date separately for the calendar's inline edit, so the
      // editor prefills (and writes back) the WO's schedule, not the estimate's.
      wo_id: w.id,
      wo_start_date: w.start_date || null,
      sub_crew_lead: w.sub_crew_lead || null,
      total_sq: w.total_sq || null,
      duration_days: w.estimated_duration_days || null,
      special_notes: w.special_notes || null,
    };
    byDay.get(key).installs.push(wInstall);
    jobs.push(wInstall);
    if (linkedProject?.id) seenProjectIds.add(linkedProject.id);
  }

  for (const t of tix.data || []) {
    const key = (t.scheduled_at || '').slice(0, 10);
    if (!byDay.has(key)) continue;
    byDay.get(key).service.push({
      id: t.id,
      label: t.customer?.full_name || 'Unnamed customer',
      title: t.title,
      priority: t.priority || 'normal',
      status: t.status || 'open',
      phone: t.customer?.phone || null,
      time: (t.scheduled_at || '').slice(11, 16),  // HH:MM
    });
  }

  return res.status(200).json({
    generated_at: new Date().toISOString(),
    days: [...byDay.values()],
    jobs,                                          // flat list for the mobile dispatch surface
    total_installs: jobs.length,
    total_service: (tix.data || []).length,
  });
}

export default requireTenant(handler);
