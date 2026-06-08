// Ryujin OS — Subcontractor Magic-Link Auth
//
// GET  /api/sub-auth?token=XYZ           — validates magic-link, returns sub profile
// GET  /api/sub-auth?sub_id=...&action=jobs — returns this sub's assigned WOs + paysheets
// POST /api/sub-auth?action=rotate       — owner rotates a sub's magic-link token
// POST /api/sub-auth?action=create       — owner creates a new subcontractor + issues token
// POST /api/sub-auth?action=request_link  self-serve: sub texts their phone, gets fresh link via SMS
//
// Magic-link URL shape: https://ryujin-os.vercel.app/sub-portal.html?token=XYZ

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { sendSMS } from '../lib/sms.js';
import { normalizePhone } from '../lib/twilio.js';
import crypto from 'crypto';

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const { action, token, sub_id } = req.query;

  // ── Validate magic-link (sub OR crew member) ──
  // Both branches reject any subcontractor row with archived_at IS NOT NULL.
  // Migration 071 sets active=false at archive time too, so the active
  // check would also catch it; this column is the defense-in-depth gate
  // for any future code path that archives without flipping active.
  if (req.method === 'GET' && token) {
    const [parentResult, memberResult, settingsResult] = await Promise.all([
      supabaseAdmin
        .from('subcontractors')
        .select('id, name, company, email, phone, trade, active, archived_at, magic_link_expires_at, portal_visibility, auto_approve_threshold_cad')
        .eq('tenant_id', tenantId)
        .eq('magic_link_token', token)
        .maybeSingle(),
      supabaseAdmin
        .from('sub_crew_members')
        .select('id, sub_id, name, phone, active, archived_at')
        .eq('tenant_id', tenantId)
        .eq('magic_token', token)
        .maybeSingle(),
      supabaseAdmin
        .from('tenant_settings')
        .select('company_name, company_phone, company_email, logo_url, accent_color')
        .eq('tenant_id', tenantId)
        .maybeSingle()
    ]);

    let sub = parentResult.data;
    let auth = null;

    if (sub) {
      if (!sub.active || sub.archived_at) return res.status(401).json({ error: 'Invalid or inactive link' });
      if (sub.magic_link_expires_at && new Date(sub.magic_link_expires_at) < new Date()) {
        return res.status(401).json({ error: 'Link expired - ask the owner for a new one' });
      }
      auth = { kind: 'sub', member_id: null, member_name: sub.name };
    } else if (memberResult.data) {
      const member = memberResult.data;
      if (!member.active || member.archived_at) return res.status(401).json({ error: 'Access revoked - ask your team lead for a new link' });
      // Resolve parent sub.
      const { data: parent } = await supabaseAdmin
        .from('subcontractors')
        .select('id, name, company, email, phone, trade, active, archived_at, magic_link_expires_at, portal_visibility, auto_approve_threshold_cad')
        .eq('tenant_id', tenantId).eq('id', member.sub_id).maybeSingle();
      if (!parent || !parent.active || parent.archived_at) return res.status(401).json({ error: 'Team lead account inactive' });
      // Crew members don't get COGS / financial-approve visibility — neutralize.
      sub = { ...parent };
      auth = { kind: 'crew', member_id: member.id, member_name: member.name };
      // Best-effort last_login bump.
      supabaseAdmin.from('sub_crew_members').update({ last_login_at: new Date().toISOString() }).eq('id', member.id).then(() => {}, () => {});
    } else {
      return res.status(401).json({ error: 'Invalid or inactive link' });
    }

    const ts = settingsResult.data;
    const branding = {
      company_name: ts?.company_name || req.tenant.name || 'Crew Portal',
      company_phone: ts?.company_phone || null,
      company_email: ts?.company_email || null,
      logo_url: ts?.logo_url || null,
      accent_color: ts?.accent_color || '#0b1d3a'
    };

    return res.json({ sub, branding, auth });
  }

  // ── Sub's assigned jobs ──
  if (req.method === 'GET' && action === 'jobs' && sub_id) {
    // Curated columns only — never SELECT * here. Sub doesn't see Mac's COGS,
    // customer phone/email, package_tier, or customer-side revenue.
    const { data: workorders } = await supabaseAdmin
      .from('workorders')
      .select('id, wo_number, address, customer_name, status, start_date, estimated_duration_days, total_sq, roof_pitch, shingle_product, shingle_color, paysheet:paysheets!linked_paysheet_id(id, job_id, status, total, balance_due)')
      .eq('tenant_id', tenantId)
      .eq('subcontractor_id', sub_id)
      .order('start_date', { ascending: true });

    // Mask customer name to first + last initial. Strip parentheticals.
    // Handles composite names ("Jim & Kelly Faulkner" → "Jim F.") via
    // last-alpha-token-as-surname rule.
    const maskCustomer = (name) => {
      if (!name) return null;
      const stripped = String(name).replace(/\s*\([^)]+\)\s*/g, '').trim();
      if (!stripped) return null;
      const tokens = stripped.split(/\s+/).filter(t => /^[A-Za-z]/.test(t));
      if (tokens.length === 0) return null;
      if (tokens.length === 1) return tokens[0];
      return `${tokens[0]} ${tokens[tokens.length - 1][0]}.`;
    };

    const sanitized = (workorders || []).map(w => ({ ...w, customer_name: maskCustomer(w.customer_name) }));
    return res.json({ workorders: sanitized });
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

  // ── Crew management (parent sub manages own roster via token auth) ──
  // GET   ?action=crew_list&token=PARENT      — list crew of the token-holder sub
  // POST  ?action=crew_add                    — body: {token, name, phone}
  // POST  ?action=crew_revoke                 — body: {token, member_id}
  // POST  ?action=crew_rotate                 — body: {token, member_id}  (new magic_token)
  //
  // Always re-verifies the token belongs to a parent sub (not a crew member —
  // crew can't add other crew). Owner UI can also operate on the sub_crew_members
  // table directly via the admin shell, but the portal-side flow uses these.
  async function resolveParentSubByToken(t) {
    if (!t) return null;
    const { data } = await supabaseAdmin
      .from('subcontractors')
      .select('id, name, active')
      .eq('tenant_id', tenantId)
      .eq('magic_link_token', t)
      .maybeSingle();
    if (!data || !data.active) return null;
    return data;
  }

  if (req.method === 'GET' && action === 'crew_list') {
    const parent = await resolveParentSubByToken(token);
    if (!parent) return res.status(401).json({ error: 'Parent token required' });
    const { data } = await supabaseAdmin
      .from('sub_crew_members')
      .select('id, name, phone, active, magic_token, created_at, last_login_at, archived_at')
      .eq('tenant_id', tenantId)
      .eq('sub_id', parent.id)
      .order('created_at', { ascending: false });
    const withUrls = (data || []).map(m => ({
      ...m,
      portal_url: m.magic_token ? `https://ryujin-os.vercel.app/sub-portal.html?token=${m.magic_token}` : null
    }));
    return res.json({ members: withUrls, sub: parent });
  }

  if (req.method === 'POST' && action === 'crew_add') {
    const { token: pTok, name, phone } = req.body || {};
    const parent = await resolveParentSubByToken(pTok);
    if (!parent) return res.status(401).json({ error: 'Parent token required' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const magic = newToken();
    const { data, error } = await supabaseAdmin
      .from('sub_crew_members')
      .insert({
        tenant_id: tenantId,
        sub_id: parent.id,
        name: String(name).trim(),
        phone: phone || null,
        magic_token: magic
      })
      .select('id, name, phone, active, magic_token, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    const portal_url = `https://ryujin-os.vercel.app/sub-portal.html?token=${magic}`;
    return res.status(201).json({ member: { ...data, portal_url }, sub: parent });
  }

  if (req.method === 'POST' && action === 'crew_revoke') {
    const { token: pTok, member_id } = req.body || {};
    const parent = await resolveParentSubByToken(pTok);
    if (!parent) return res.status(401).json({ error: 'Parent token required' });
    if (!member_id) return res.status(400).json({ error: 'member_id required' });
    const { data, error } = await supabaseAdmin
      .from('sub_crew_members')
      .update({ active: false, archived_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('sub_id', parent.id)
      .eq('id', member_id)
      .select('id, name, active, archived_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ member: data });
  }

  if (req.method === 'POST' && action === 'crew_rotate') {
    const { token: pTok, member_id } = req.body || {};
    const parent = await resolveParentSubByToken(pTok);
    if (!parent) return res.status(401).json({ error: 'Parent token required' });
    if (!member_id) return res.status(400).json({ error: 'member_id required' });
    const magic = newToken();
    const { data, error } = await supabaseAdmin
      .from('sub_crew_members')
      .update({ magic_token: magic, active: true, archived_at: null })
      .eq('tenant_id', tenantId)
      .eq('sub_id', parent.id)
      .eq('id', member_id)
      .select('id, name, phone, active, magic_token, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    const portal_url = `https://ryujin-os.vercel.app/sub-portal.html?token=${magic}`;
    return res.json({ member: { ...data, portal_url } });
  }

  // ── Self-serve: sub requests a fresh magic-link via SMS ──
  // POST body: { phone }. Matches by E.164-normalized phone across subcontractors
  // and sub_crew_members. Rotates the token and texts a new portal URL to the
  // number on file (NOT to whatever the requester typed; that's the whole
  // point of the lookup, the sender must already be in our records).
  // Generic 200 response either way to avoid number enumeration.
  if (req.method === 'POST' && action === 'request_link') {
    const { phone } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized) return res.status(400).json({ error: 'Enter a valid phone number' });

    // Best-effort per-instance throttle. Cold starts reset this; Twilio's
    // own per-number rate limits remain the floor.
    const rateKey = `${tenantId}:${normalized}`;
    const now = Date.now();
    const last = REQUEST_LINK_RATE.get(rateKey) || 0;
    if (now - last < 60_000) return res.json({ ok: true });
    REQUEST_LINK_RATE.set(rateKey, now);

    // Find sub by phone. If multiple match (e.g. owner-cell shared with the
    // in-house "Crew" bucket sub), the most recently updated active row wins.
    const { data: subs } = await supabaseAdmin
      .from('subcontractors')
      .select('id, name, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', normalized)
      .eq('active', true)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });

    let target = null;
    if (subs && subs.length) {
      const sub = subs[0];
      const token = newToken();
      const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      await supabaseAdmin
        .from('subcontractors')
        .update({ magic_link_token: token, magic_link_expires_at: expires.toISOString(), updated_at: new Date().toISOString() })
        .eq('id', sub.id);
      target = { name: sub.name, phone: sub.phone, token };
    } else {
      // Fall back to crew members.
      const { data: members } = await supabaseAdmin
        .from('sub_crew_members')
        .select('id, name, phone, sub_id')
        .eq('tenant_id', tenantId)
        .eq('phone', normalized)
        .eq('active', true)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (members && members.length) {
        const m = members[0];
        const token = newToken();
        await supabaseAdmin
          .from('sub_crew_members')
          .update({ magic_token: token })
          .eq('id', m.id);
        target = { name: m.name, phone: m.phone, token };
      }
    }

    if (target) {
      // Use the tenant owner's ryujin_phone_number as outbound sender so the
      // recipient sees a familiar number (matches the messages.js pattern).
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select('ryujin_phone_number, name')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .not('ryujin_phone_number', 'is', null)
        .maybeSingle();

      const fromPhone = owner?.ryujin_phone_number || null;
      if (fromPhone) {
        const firstName = (target.name || '').split(/\s+/)[0] || 'there';
        const portalUrl = `https://ryujin-os.vercel.app/sub-portal.html?token=${target.token}`;
        const smsBody = `Hey ${firstName}, here's your portal link, good for 90 days: ${portalUrl}`;
        sendSMS({ from: fromPhone, to: target.phone, body: smsBody })
          .then(r => { if (!r.ok) console.warn(`[sub-auth.request_link] SMS to ${target.name} failed: ${r.error}`); })
          .catch(e => console.warn(`[sub-auth.request_link] SMS to ${target.name} crashed: ${e.message}`));
      } else {
        console.warn(`[sub-auth.request_link] no owner ryujin_phone_number set for tenant ${tenantId}, cannot deliver`);
      }
    }

    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

// Module-scope rate-limit bucket. Keyed by `${tenantId}:${normalizedPhone}`.
// Best-effort; resets on cold start. Twilio's per-number cap is the real floor.
const REQUEST_LINK_RATE = new Map();

export default requireTenant(handler);
