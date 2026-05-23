// Ryujin OS - Crew roster
// Returns active crew (users where role='crew' and active=true) plus active
// subcontractors (archived_at is null). Replaces hardcoded crew arrays in
// public/classic.html, public/admin.html, and other surfaces.
//
// Consumed by /api/crew-roster (exposed to clients) and any server-side
// rendering surface that needs to populate a crew/sub dropdown.
import { supabaseAdmin } from './supabase.js';

const SAFE_CREW_FIELDS = 'id, name, email, phone, role, avatar_url, active';
const SAFE_SUB_FIELDS = 'id, name, company, phone, email, trade, active, archived_at';

export async function getCrewRoster(tenantId) {
  if (!tenantId) return { crew: [], subs: [] };

  const [crewRes, subsRes] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select(SAFE_CREW_FIELDS)
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('role', 'crew')
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
