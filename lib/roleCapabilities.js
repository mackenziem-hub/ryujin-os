// Ryujin OS - role -> capability resolution for the Companion app (Phase 1).
// ----------------------------------------------------------------------------
// Reads role_capabilities (migration_104). The map drives which tabs + features
// companion.html paints per role. It is NOT the security boundary: every data
// endpoint still re-checks scope server-side (isPrivileged / effectiveUserId /
// per-row tenant + assignment filters). This is the UI gate + a coarse default.
import { supabaseAdmin } from './supabase.js';

// Least-privilege fallback when no row exists for a (tenant, role): the
// installer tier (media + job folder only), so a misconfigured role can never
// leak tasks, pay, dashboards, or other jobs.
const FALLBACK = {
  show_tasks: false, show_schedule: false, show_jobs: true, show_media: true,
  show_clock: false, show_paysheets: false, show_workorders: false,
  show_inbox: false, show_dashboard: false,
  can_create_job: false, can_upload_photos: true, can_view_pricing: false,
  can_issue_pay: false, data_scope: 'self',
};
const CAP_KEYS = Object.keys(FALLBACK);

// Code-authoritative defaults (Mac's locked Jun 26 role model) so the Companion
// app works correctly even before migration_104 is applied. The role_capabilities
// table is an OPTIONAL override layer on top of these.
// args: tasks,sched,jobs,media,clock,pay,wo,inbox,dash, createjob,uploadphoto,viewprice,issuepay, scope
function mk(t, sc, j, md, ck, pay, wo, ib, dash, cj, up, vp, ip, scope) {
  return {
    show_tasks: t, show_schedule: sc, show_jobs: j, show_media: md, show_clock: ck,
    show_paysheets: pay, show_workorders: wo, show_inbox: ib, show_dashboard: dash,
    can_create_job: cj, can_upload_photos: up, can_view_pricing: vp, can_issue_pay: ip,
    data_scope: scope,
  };
}
const DEFAULT_BY_ROLE = {
  owner:     mk(true,  true,  true, true, true,  true,  true,  true,  true,  true,  true,  true,  true,  'all'),
  admin:     mk(true,  true,  true, true, true,  true,  true,  true,  true,  true,  true,  true,  false, 'tenant'),
  crew:      mk(true,  true,  true, true, true,  false, true,  true,  false, false, true,  false, false, 'self'),
  sub:       mk(true,  true,  true, true, false, true,  true,  true,  false, false, true,  false, false, 'self'),
  installer: mk(false, false, true, true, false, false, false, false, false, false, true,  false, false, 'self'),
  sales:     mk(true,  false, true, false,false, false, false, true,  false, true,  false, true,  false, 'self'),
  estimator: mk(true,  false, true, false,false, false, false, true,  false, true,  false, true,  false, 'self'),
  service:   mk(true,  true,  true, true, true,  false, true,  true,  false, false, true,  false, false, 'self'),
};

export async function getCapabilities(tenantId, role) {
  const r = String(role || '').toLowerCase().trim() || 'installer';
  const base = DEFAULT_BY_ROLE[r] ? { ...DEFAULT_BY_ROLE[r] } : { ...FALLBACK };
  try {
    const { data } = await supabaseAdmin
      .from('role_capabilities')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('role', r)
      .maybeSingle();
    if (data) { for (const k of CAP_KEYS) if (data[k] != null) base[k] = data[k]; }
  } catch { /* table absent or transient error -> code defaults stand */ }
  return { role: r, ...base };
}

export function hasCapability(caps, key) {
  return !!(caps && caps[key]);
}
