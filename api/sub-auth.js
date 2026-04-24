// Ryujin OS — Subcontractor Magic-Link Auth
//
// GET  /api/sub-auth?token=XYZ           — validates magic-link, returns sub profile
// GET  /api/sub-auth?sub_id=...&action=jobs — returns this sub's assigned WOs + paysheets
// POST /api/sub-auth?action=rotate       — owner rotates a sub's magic-link token
// POST /api/sub-auth?action=create       — owner creates a new subcontractor + issues token
//
// Magic-link URL shape: https://ryujin-os.vercel.app/sub-portal.html?token=XYZ

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import crypto from 'crypto';

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const { action, token, sub_id } = req.query;

  // ── Validate magic-link ──
  if (req.method === 'GET' && token) {
    const { data: sub } = await supabaseAdmin
      .from('subcontractors')
      .select('id, name, company, email, phone, trade, active, magic_link_expires_at')
      .eq('tenant_id', tenantId)
      .eq('magic_link_token', token)
      .single();

    if (!sub || !sub.active) return res.status(401).json({ error: 'Invalid or inactive link' });
    if (sub.magic_link_expires_at && new Date(sub.magic_link_expires_at) < new Date()) {
      return res.status(401).json({ error: 'Link expired — ask the owner for a new one' });
    }
    return res.json({ sub });
  }

  // ── Sub's assigned jobs ──
  if (req.method === 'GET' && action === 'jobs' && sub_id) {
    const { data: workorders } = await supabaseAdmin
      .from('workorders')
      .select('*, paysheet:paysheets!linked_paysheet_id(id, job_id, status, total, balance_due)')
      .eq('tenant_id', tenantId)
      .eq('subcontractor_id', sub_id)
      .order('start_date', { ascending: true });

    return res.json({ workorders: workorders || [] });
  }

  // ── Owner: create new sub + issue magic-link ──
  if (req.method === 'POST' && action === 'create') {
    const { name, company, phone, email, trade, expires_days = 90 } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const token = newToken();
    const expires = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from('subcontractors')
      .insert({
        tenant_id: tenantId,
        name, company, phone, email, trade: trade || 'roofing',
        magic_link_token: token,
        magic_link_expires_at: expires.toISOString()
      })
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    const portal_url = `https://ryujin-os.vercel.app/sub-portal.html?token=${token}`;
    return res.status(201).json({ subcontractor: data, portal_url });
  }

  // ── Owner: rotate magic-link ──
  if (req.method === 'POST' && action === 'rotate') {
    const { id, expires_days = 90 } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    const token = newToken();
    const expires = new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000);

    const { data, error } = await supabaseAdmin
      .from('subcontractors')
      .update({ magic_link_token: token, magic_link_expires_at: expires.toISOString(), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    const portal_url = `https://ryujin-os.vercel.app/sub-portal.html?token=${token}`;
    return res.json({ subcontractor: data, portal_url });
  }

  // ── Owner: list subs ──
  if (req.method === 'GET' && action === 'list') {
    const { data } = await supabaseAdmin
      .from('subcontractors')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    return res.json({ subcontractors: data || [] });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

export default requireTenant(handler);
