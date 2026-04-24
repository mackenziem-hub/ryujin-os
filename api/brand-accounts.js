// Ryujin OS — Brand→GHL account mapping
// GET  /api/brand-accounts           — merged view: live GHL accounts + stored assignments + brand details
// POST /api/brand-accounts?sync=1    — pull latest from GHL, upsert rows (preserves existing assignments)
// PUT  /api/brand-accounts           — body: { ghl_account_id, brand_id?, excluded? } — set assignment
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { listSocialAccounts } from '../lib/ghl.js';

const PLATFORM_MAP = {
  google: 'google',       // GBP
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube'
};

async function syncFromGhl(tenantId){
  const resp = await listSocialAccounts();
  // GHL nests the account list under results.accounts
  const raw = resp?.results?.accounts || resp?.accounts?.accounts || resp?.accounts || [];
  if (!Array.isArray(raw)) return { synced: 0, accounts: [] };

  const rows = raw
    .filter(a => !a.deleted)
    .map(a => ({
      tenant_id: tenantId,
      ghl_account_id: a.id,
      platform: PLATFORM_MAP[a.platform] || a.platform,
      account_name: a.name || null,
      account_handle: a?.meta?.username || null,
      updated_at: new Date().toISOString()
    }));

  if (!rows.length) return { synced: 0, accounts: [] };

  // Upsert on (tenant_id, ghl_account_id) — preserves existing brand_id + excluded
  const { data, error } = await supabaseAdmin
    .from('brand_accounts')
    .upsert(rows, { onConflict: 'tenant_id,ghl_account_id', ignoreDuplicates: false })
    .select('*');
  if (error) throw new Error('Sync upsert failed: ' + error.message);
  return { synced: data.length, accounts: data };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    // Merged view: brand_accounts joined with brands, ordered by platform + name
    const { data, error } = await supabaseAdmin
      .from('brand_accounts')
      .select('*, brand:brands(id,slug,name,voice,cta,tagline)')
      .eq('tenant_id', tenantId)
      .order('platform', { ascending: true })
      .order('account_name', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ accounts: data });
  }

  if (req.method === 'POST') {
    // ?sync=1 → pull from GHL
    if (req.query.sync) {
      try {
        const result = await syncFromGhl(tenantId);
        return res.json({ ok: true, ...result });
      } catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    }
    return res.status(400).json({ error: 'Use ?sync=1 to sync from GHL' });
  }

  if (req.method === 'PUT') {
    const { ghl_account_id, brand_id, excluded } = req.body || {};
    if (!ghl_account_id) return res.status(400).json({ error: 'ghl_account_id required' });
    const patch = { updated_at: new Date().toISOString() };
    if (brand_id !== undefined) patch.brand_id = brand_id || null;
    if (excluded !== undefined) patch.excluded = !!excluded;
    const { data, error } = await supabaseAdmin
      .from('brand_accounts')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('ghl_account_id', ghl_account_id)
      .select('*, brand:brands(id,slug,name)')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
