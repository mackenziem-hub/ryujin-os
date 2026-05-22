// Ryujin OS · Tenant branding API · public
//
// GET /api/tenant-branding[?tenant=<slug>]
//
// Returns ONLY the branding-visible fields from tenant_settings. Safe to
// call from any browser context (admin, crew, or customer-facing). All
// other tenant_settings fields (labor rates, margins, overhead, entitlements,
// label_overrides, etc.) stay server-only behind requireTenant + auth.
//
// Tenant resolution mirrors the rest of the API:
//   1. x-tenant-id header
//   2. ?tenant= query param (slug)
//   3. Custom domain lookup via lib/tenant.js
// If none resolve, returns 400 tenant_required.

import { supabaseAdmin } from '../lib/supabase.js';
import { resolveTenant } from '../lib/tenant.js';

const PUBLIC_FIELDS = [
  'company_name',
  'company_phone',
  'company_email',
  'company_website',
  'logo_url',
  'accent_color',
  'tagline',
  'proposal_header',
  'proposal_footer'
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const tenant = await resolveTenant(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  const { data, error } = await supabaseAdmin
    .from('tenant_settings')
    .select(PUBLIC_FIELDS.join(','))
    .eq('tenant_id', tenant.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: 'db_error', detail: error.message });
  }

  const branding = data || {};
  // Always expose the tenant slug so the client can confirm the right one resolved.
  return res.status(200).json({
    tenant: { id: tenant.id, slug: tenant.slug },
    branding
  });
}
