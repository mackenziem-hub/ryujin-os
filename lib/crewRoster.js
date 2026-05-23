// Ryujin OS - Crew roster
// Returns the active production roster (users where role IN
// {owner, admin, crew} and active=true) plus active subcontractors
// (archived_at IS NULL). The owner / admin tier is included because
// production leads at Plus Ultra carry admin or owner roles, not
// 'crew' (Mac=owner, AJ=admin, Cat=admin can all be assigned as
// crew lead on a WO). Estimators are excluded - they sell, they do
// not lead production.
//
// Consumed by /api/crew-roster (exposed to clients) and any server-side
// rendering surface that needs to populate a crew/sub dropdown.
import { supabaseAdmin } from './supabase.js';

const SAFE_CREW_FIELDS = 'id, name, email, phone, role, avatar_url, active';
const SAFE_SUB_FIELDS = 'id, name, company, phone, email, trade, active, archived_at';
const ROSTER_ROLES = ['owner', 'admin', 'crew'];

export async function getCrewRoster(tenantId) {
  if (!tenantId) return { crew: [], subs: [] };

  const [crewRes, subsRes] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select(SAFE_CREW_FIELDS)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .in('role', ROSTER_ROLES)
      .order('name'),
    supabaseAdmin
      .from('subcontractors')
      .select(SAFE_SUB_FIELDS)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .is('archived_at', null)
      .order('name'),
  ]);

  return {
    crew: crewRes.data || [],
    subs: subsRes.data || [],
  };
}
