// ═══════════════════════════════════════════════════════════════
// /api/entitlements — read-only read of the current tenant's entitlements.
// Used by the front-end gate at assets/entitlements-client.js to
// hide / lock UI affordances the tenant hasn't paid for.
//
//   GET /api/entitlements
//   →   { tier, pillars[], tools[], integrations[], features{} }
//
// No write endpoint here. Stripe webhook is the only writer of the
// entitlements column (see schema/migration_050_entitlements.sql).
// ═══════════════════════════════════════════════════════════════

import { requireTenant } from '../lib/tenant.js';
import { getEntitlements } from '../lib/entitlements.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const ent = await getEntitlements(req.tenant.id);
  return res.status(200).json(ent);
}

export default requireTenant(handler);
