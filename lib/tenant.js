// Ryujin OS — Tenant Resolution
// Resolves tenant from request headers, query params, or custom domain.
import { supabaseAdmin } from './supabase.js';

const tenantCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function resolveTenant(req) {
  // Priority 1: x-tenant-id header (API calls from Shenron, etc.)
  const headerTenant = req.headers['x-tenant-id'];
  if (headerTenant) return getTenantBySlug(headerTenant);

  // Priority 2: ?tenant= query param
  const queryTenant = req.query?.tenant;
  if (queryTenant) return getTenantBySlug(queryTenant);

  // Priority 3: Custom domain lookup
  const host = req.headers.host;
  if (host && !host.includes('vercel') && !host.includes('localhost')) {
    return getTenantByDomain(host);
  }

  return null;
}

async function getTenantBySlug(slug) {
  const cached = tenantCache.get(`slug:${slug}`);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (error || !data) return null;
  tenantCache.set(`slug:${slug}`, { data, ts: Date.now() });
  return data;
}

async function getTenantByDomain(domain) {
  const cached = tenantCache.get(`domain:${domain}`);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*')
    .eq('domain', domain)
    .eq('active', true)
    .single();

  if (error || !data) return null;
  tenantCache.set(`domain:${domain}`, { data, ts: Date.now() });
  return data;
}

// Middleware helper — attaches tenant to req, returns 400 if missing.
// CORS preflight (OPTIONS) bypasses the tenant check so browsers can complete
// the preflight handshake; the actual request still requires tenant.
export function requireTenant(handler) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    const tenant = await resolveTenant(req);
    if (!tenant) {
      return res.status(400).json({ error: 'Tenant not found. Pass x-tenant-id header or ?tenant= query param.' });
    }
    req.tenant = tenant;
    return handler(req, res);
  };
}
