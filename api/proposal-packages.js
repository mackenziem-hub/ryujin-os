// Ryujin OS - Proposal Packages API
// GET /api/proposal-packages            - list active proposal tiers (asphalt)
// GET /api/proposal-packages?system=X   - list active proposal tiers for a system
//
// Read-only catalog feed for the proposal wizard's tier-card step. Backed by
// the proposal_packages table (migration 099) with a canonical fallback in
// lib/proposalPackages.js, so this returns the tiers even before the migration
// is applied or seeded.
import { requireTenant } from '../lib/tenant.js';
import { getProposalPackages } from '../lib/proposalPackages.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const system = (req.query.system || 'asphalt').toString().toLowerCase();
  try {
    const packages = await getProposalPackages(req.tenant.id, system);
    return res.json({ system, packages });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default requireTenant(handler);
