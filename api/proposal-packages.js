// api/proposal-packages.js - GET the tenant's proposal tier packages.
//
// GET /api/proposal-packages                 - all active packages (Gold/Platinum/Diamond)
// GET /api/proposal-packages?system=asphalt  - filtered to one system
//
// Read-only. Feeds the proposal wizard tier step (proposal-wizard.html). Falls
// back to the in-code TIER_CATALOG when proposal_packages is empty or not yet
// migrated (see lib/proposalPackages.js), so it is safe before the seed runs.
// No em dashes.

import { loadProposalPackages } from '../lib/proposalPackages.js';
import { requireTenant } from '../lib/tenant.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. GET only.' });
  const tenantId = req.tenant?.id || null;
  const system = req.query.system ? String(req.query.system) : null;
  try {
    const { packages, source } = await loadProposalPackages(tenantId, system);
    return res.json({ packages, source, count: packages.length });
  } catch (e) {
    return res.status(500).json({ error: 'proposal_packages_failed', message: e.message });
  }
}

export default requireTenant(handler);
