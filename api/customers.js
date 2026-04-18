// Ryujin OS — Customers CRUD
// GET    /api/customers           — List/search customers
// GET    /api/customers?id=X      — Get single customer
// POST   /api/customers           — Create customer
// PUT    /api/customers           — Update customer
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

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
      query = query.or(`full_name.ilike.%${search}%,address.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ customers: data, total: count });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({ tenant_id: tenantId, ...body })
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

export default requireTenant(handler);
