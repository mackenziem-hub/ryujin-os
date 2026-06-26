// Ryujin OS - Crew Roster endpoint
// GET /api/crew-roster -> { crew: [users role=crew], subs: [subcontractors not archived] }
//
// Used by job.html (Crew & Sub dropdowns), Cat's Queue task assignment,
// and any UI that needs to pick a crew lead or subcontractor.
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { getCrewRoster } from '../lib/crewRoster.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const roster = await getCrewRoster(req.tenant.id);
  return res.json(roster);
}

export default requirePortalSessionAndTenant(handler);
