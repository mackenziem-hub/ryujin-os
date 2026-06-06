// Ryujin OS — Customers CRUD
// GET    /api/customers           — List/search customers
// GET    /api/customers?id=X      — Get single customer
// POST   /api/customers           — Create customer
// PUT    /api/customers           — Update customer
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, search, limit = 50, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('customers')
        .select('*, estimates(*)')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'Customer not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (search) {
      // P3: sanitize before interpolating into a PostgREST .or() filter tree.
      // Commas/parens/dots/backslashes are PostgREST logic-tree control chars;
      // an attacker could otherwise inject extra OR clauses. Strip them; the
      // value is already wrapped in %...% for ilike so trimming is safe.
      const term = String(search).replace(/[,()\\*]/g, '').slice(0, 100);
      if (term) {
        query = query.or(`full_name.ilike.%${term}%,address.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
      }
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ customers: data, total: count });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    // Strip client-controlled identity/ownership + server-managed columns so a
    // caller cannot forge tenant_id (cross-tenant write), set a primary key, or
    // backdate rows. tenant_id is then applied authoritatively from the session.
    const { id: _ignoredId, tenant_id: _ignoredTenant, created_at: _ignoredCreated, updated_at: _ignoredUpdated, ...safeBody } = body;
    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({ ...safeBody, tenant_id: tenantId })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
