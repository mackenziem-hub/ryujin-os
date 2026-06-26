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
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';
import { sendSMS } from '../lib/sms.js';
import { gmailSend } from '../lib/google.js';
import { normalizePhone } from '../lib/twilio.js';
import crypto from 'crypto';

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const { action, token, sub_id } = req.query;

  // Owner/admin gate for the management actions (list / create / rotate). The
  // admin shell carries a Bearer session via auth-guard; the service token also
  // resolves to a synthetic admin. A sub's magic-link ?token is NOT a sessions
  // row, so it cannot satisfy this (resolveSession returns null for it).
  const requireOwner = async () => {
    const session = await resolveSession(req);
    if (!isPrivileged(session)) { res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' }); return false; }
    return true;
  };

  // True only if `t` is a LIVE magic-link token (parent sub OR crew member)
  // belonging to requestedSubId. Mirrors the validate path's active/expiry checks.
  // Gates ?action=jobs so a sub can only read its OWN jobs, never another sub's.
  const tokenAuthorizesSub = async (t, requestedSubId) => {
    if (!t || !requestedSubId) return false;
    const { data: parent } = await supabaseAdmin
      .from('subcontractors')
      .select('id, active, archived_at, magic_link_expires_at')
      .eq('tenant_id', tenantId).eq('magic_link_token', t).maybeSingle();
    if (parent && parent.active && !parent.archived_at &&
        (!parent.magic_link_expires_at || new Date(parent.magic_link_expires_at) > new Date()) &&
        parent.id === requestedSubId) return true;
    const { data: member } = await supabaseAdmin
      .from('sub_crew_members')
      .select('sub_id, active, archived_at')
      .eq('tenant_id', tenantId).eq('magic_token', t).maybeSingle();
    if (member && member.active && !member.archived_at && member.sub_id === requestedSubId) return true;
    return false;
  };

  // ── Validate magic-link (sub OR crew member) ──
  // Scoped to action-less calls so a token passed alongside ?action=jobs /
  // crew_list reaches its own branch instead of being shadowed here.
  // Both branches reject any subcontractor row with archived_at IS NOT NULL.
  // Migration 071 sets active=false at archive time too, so the active
  // check would also catch it; this column is the defense-in-depth gate
  // for any future code path that archives without flipping active.
  if (req.method === 'GET' && token && !action) {
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
    // Must hold this sub's own live magic-link token (parent or crew). Closes the
    // unauthenticated read of any sub's work orders + paysheet totals by sub_id.
    if (!(await tokenAuthorizesSub(token, sub_id))) {
      return res.status(401).json({ error: 'Invalid or inactive link' });
    }
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
    if (!(await requireOwner())) return;
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
    if (!(await requireOwner())) return;
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
    if (!(await requireOwner())) return;
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

  // ── Self-serve: sub requests their magic-link via SMS + email ──
  // POST body: { phone }. Matches by E.164-normalized phone across subcontractors
  // and sub_crew_members. REUSES the live token (mints a fresh one only when none
  // exists or it has lapsed) so any link the sub already holds keeps working, and
  // pushes the expiry out 90 days. Delivers to the phone AND the email on file
  // (never to whatever the requester typed; the sender must already be in our
  // records). Email is the dependable channel; SMS can be carrier/A2P filtered.
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

    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

    // Find sub by phone. If multiple match (e.g. owner-cell shared with the
    // in-house "Crew" bucket sub), the most recently updated active row wins.
    const { data: subs } = await supabaseAdmin
      .from('subcontractors')
      .select('id, name, phone, email, magic_link_token, magic_link_expires_at')
      .eq('tenant_id', tenantId)
      .eq('phone', normalized)
      .eq('active', true)
      .is('archived_at', null)
      .order('updated_at', { ascending: false });

    let target = null;
    if (subs && subs.length) {
      const sub = subs[0];
      // Reuse the existing token when it's still valid so links already in the
      // sub's hands do not die on every request; mint only when missing/expired.
      const tokenValid = sub.magic_link_token &&
        (!sub.magic_link_expires_at || new Date(sub.magic_link_expires_at) > new Date(now));
      const minted = !tokenValid;
      const token = tokenValid ? sub.magic_link_token : newToken();
      const expires = new Date(now + NINETY_DAYS);
      const { error: writeErr } = await supabaseAdmin
        .from('subcontractors')
        .update({ magic_link_token: token, magic_link_expires_at: expires.toISOString(), updated_at: new Date(now).toISOString() })
        .eq('id', sub.id);
      // If we minted a fresh token but the write failed, the token exists only
      // in memory and any link we send would 401. Skip delivery; the throttle
      // lets the sub retry shortly. A failed write on the REUSE path is harmless
      // (the prior token is still live in the DB), so we still send there.
      if (writeErr && minted) {
        console.warn(`[sub-auth.request_link] mint write failed for ${sub.name}, not sending: ${writeErr.message}`);
      } else {
        target = { name: sub.name, phone: sub.phone, email: sub.email, token };
      }
    } else {
      // Fall back to crew members. Crew tokens carry no expiry (the validate
      // path checks active/archived only) and magic_token is NOT NULL, so in
      // practice we always reuse; the mint branch is belt-and-suspenders.
      const { data: members } = await supabaseAdmin
        .from('sub_crew_members')
        .select('id, name, phone, sub_id, magic_token')
        .eq('tenant_id', tenantId)
        .eq('phone', normalized)
        .eq('active', true)
        .is('archived_at', null)
        .order('created_at', { ascending: false });
      if (members && members.length) {
        const m = members[0];
        const token = m.magic_token || newToken();
        let writeErr = null;
        if (!m.magic_token) {
          ({ error: writeErr } = await supabaseAdmin
            .from('sub_crew_members')
            .update({ magic_token: token })
            .eq('id', m.id));
        }
        // sub_crew_members has no email column, so crew get SMS only.
        if (writeErr) {
          console.warn(`[sub-auth.request_link] crew mint write failed for ${m.name}, not sending: ${writeErr.message}`);
        } else {
          target = { name: m.name, phone: m.phone, email: null, token };
        }
      }
    }

    if (target) {
      const firstName = (target.name || '').split(/\s+/)[0] || 'there';
      const portalUrl = `https://ryujin-os.vercel.app/sub-portal.html?token=${target.token}`;

      // Deliver on every available channel and AWAIT the sends. A fire-and-forget
      // send after res.json() can be frozen when the serverless instance suspends,
      // which is itself a cause of "the link text never came". Each send is
      // bounded so an unbounded Gmail/Twilio stall can't hold the response open
      // past the function's duration limit; normal sends are sub-second.
      const withTimeout = (p, ms, ch) => Promise.race([
        p,
        new Promise(resolve => setTimeout(() => resolve({ ch, ok: false, error: `timeout after ${ms}ms` }), ms))
      ]);
      const deliveries = [];

      // Channel 1: SMS from the owner's ryujin number (a familiar sender).
      const { data: owner } = await supabaseAdmin
        .from('users')
        .select('ryujin_phone_number')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .not('ryujin_phone_number', 'is', null)
        .maybeSingle();
      const fromPhone = owner?.ryujin_phone_number || null;
      if (fromPhone && target.phone) {
        const smsBody = `Hey ${firstName}, here's your Plus Ultra portal link, good for 90 days: ${portalUrl}`;
        deliveries.push(withTimeout(
          sendSMS({ from: fromPhone, to: target.phone, body: smsBody })
            .then(r => ({ ch: 'sms', ok: !!r.ok, error: r.error }))
            .catch(e => ({ ch: 'sms', ok: false, error: e.message })),
          9000, 'sms'
        ));
      }

      // Channel 2: email via the Gmail API (same transport as the daily briefing).
      // Dodges carrier/A2P filtering, so it is the reliable path. The '@' guard
      // skips a guaranteed Gmail 400 when the email field holds junk.
      if (target.email && target.email.includes('@')) {
        const subject = 'Your Plus Ultra crew portal link';
        const emailBody = [
          `Hi ${firstName},`,
          ``,
          `Here is your Plus Ultra crew portal link. It works on your phone and stays good for 90 days:`,
          ``,
          portalUrl,
          ``,
          `Open it any time to see your assigned jobs, pay sheets, and schedule. Bookmark it and it is one tap next time.`,
          ``,
          `Plus Ultra Roofing`
        ].join('\n');
        deliveries.push(withTimeout(
          gmailSend(target.email, subject, emailBody)
            .then(() => ({ ch: 'email', ok: true }))
            .catch(e => ({ ch: 'email', ok: false, error: e.message })),
          8000, 'email'
        ));
      }

      const results = await Promise.all(deliveries);
      for (const r of results) {
        if (!r.ok) console.warn(`[sub-auth.request_link] ${r.ch} to ${target.name} failed: ${r.error}`);
      }
      if (!deliveries.length) {
        console.warn(`[sub-auth.request_link] no delivery channel for ${target.name} (fromPhone=${!!fromPhone}, email=${!!target.email})`);
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
