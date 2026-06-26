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

export async function getCapabilities(tenantId, role) {
  const r = String(role || '').toLowerCase().trim() || 'installer';
  try {
    const { data } = await supabaseAdmin
      .from('role_capabilities')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('role', r)
      .maybeSingle();
    if (!data) return { role: r, _fallback: true, ...FALLBACK };
    const caps = { role: r };
    for (const k of CAP_KEYS) caps[k] = data[k];
    return caps;
  } catch {
    return { role: r, _fallback: true, ...FALLBACK };
  }
}

export function hasCapability(caps, key) {
  return !!(caps && caps[key]);
}
