// Ryujin OS — Sub-portal token verification (shared)
//
// Resolves a magic-link token in either of two namespaces:
//   1. subcontractors.magic_link_token   (parent sub — e.g. Ryan)
//   2. sub_crew_members.magic_token      (parent sub's crew)
// Crew tokens inherit the parent sub's job access; the returned `sub`
// is always the parent. Crew context (member id + name) is attached
// as a non-enumerable property so audit code can credit photos/logs
// to the actual person without breaking existing destructuring.
//
// Originally inline in api/sub-portal.js; extracted so /api/job-log-photo
// can verify the same token before bridging uploads into estimate_photos.

import { supabaseAdmin } from './supabase.js';

export async function verifySubToken(tenantId, token) {
  if (!token) return null;
  // Try parent sub first. Reject any sub whose archived_at is set, even if
  // active=true is stale - defense-in-depth alongside migration 068 which
  // flips active=false at archive time.
  const { data: sub } = await supabaseAdmin
    .from('subcontractors')
    .select('id, name, company, magic_link_expires_at, active, archived_at, portal_visibility')
    .eq('tenant_id', tenantId)
    .eq('magic_link_token', token)
    .maybeSingle();
  if (sub) {
    if (!sub.active || sub.archived_at) return null;
    if (sub.magic_link_expires_at && new Date(sub.magic_link_expires_at) < new Date()) return null;
    sub._auth = { kind: 'sub', member_id: null, member_name: sub.name };
    return sub;
  }
  const { data: member } = await supabaseAdmin
    .from('sub_crew_members')
    .select('id, sub_id, name, active, archived_at')
    .eq('tenant_id', tenantId)
    .eq('magic_token', token)
    .maybeSingle();
  if (!member || !member.active || member.archived_at) return null;
  const { data: parent } = await supabaseAdmin
    .from('subcontractors')
    .select('id, name, company, magic_link_expires_at, active, archived_at, portal_visibility')
    .eq('tenant_id', tenantId)
    .eq('id', member.sub_id)
    .maybeSingle();
  if (!parent || !parent.active || parent.archived_at) return null;
  supabaseAdmin.from('sub_crew_members')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', member.id)
    .then(() => {}, () => {});
  parent._auth = { kind: 'crew', member_id: member.id, member_name: member.name };
  return parent;
}
