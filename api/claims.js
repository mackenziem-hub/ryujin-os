// Ryujin OS — Public Claims Endpoint
//
// GET /api/claims?tenant_id=X[&category=insurance,warranty]
//
// Returns ONLY active claims (status='active') for client-side rendering.
// Soft + disabled claims are filtered server-side — they never reach the wire.
// Pattern B from docs/integration_proposal_client_claims.md.
//
// Cached at the edge for 60s + stale-while-revalidate. Tenant-scoped.

import { getActiveClaims } from '../lib/claims.js';

const PLUS_ULTRA_TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

function resolveTenantId(req) {
  return (req.query?.tenant_id || req.headers?.['x-tenant-id'] || PLUS_ULTRA_TENANT_ID).toString().trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tenant-id');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tenantId = resolveTenantId(req);
  const categoryParam = req.query?.category;
  const categories = categoryParam ? String(categoryParam).split(',').map(s => s.trim()).filter(Boolean) : null;

  try {
    const claims = await getActiveClaims(tenantId, categories);
    return res.status(200).json({
      tenant_id: tenantId,
      count: claims.length,
      claims  // [{ key, category, copy, proof_source }]
    });
  } catch (e) {
    console.error('[api/claims] failed', e);
    return res.status(500).json({ error: 'Failed to fetch claims', detail: e.message });
  }
}
