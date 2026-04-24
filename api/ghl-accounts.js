// Ryujin OS — List connected social accounts from GoHighLevel
// GET /api/ghl-accounts
// Returns the raw GHL response so we can see account IDs + platform names
// for the brand-tagging UI. Tenant-gated.
import { requireTenant } from '../lib/tenant.js';
import { listSocialAccounts, getLocation } from '../lib/ghl.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const [accounts, location] = await Promise.all([
      listSocialAccounts().catch(e => ({ error: e.message, status: e.status })),
      getLocation().catch(e => ({ error: e.message, status: e.status }))
    ]);
    return res.json({
      ok: !accounts.error,
      locationName: location?.location?.name || location?.name || null,
      locationError: location?.error || null,
      accounts: accounts?.accounts || accounts?.results || [],
      accountsError: accounts?.error || null,
      raw: { accounts, location }
    });
  } catch (err) {
    return res.status(500).json({ error: 'GHL call failed', detail: err?.message || String(err) });
  }
}

export default requireTenant(handler);
