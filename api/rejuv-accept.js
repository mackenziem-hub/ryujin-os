// Ryujin OS — Rejuvenation (Revive) proposal acceptance
//
// POST /api/rejuv-accept
// Body: { name, contact, address, job, amount, slug? }
//
// The standalone Plus Ultra Revive proposals (public/proposals/*-revive.html) are
// static pages, not estimate-backed records, so they cannot use /api/proposal-accept
// (which verifies a share token against a Supabase estimate). This is the lightweight
// equivalent: it captures the customer's acceptance and fires notifyLeadEvent so the
// signed event lands in the owner inbox + email + the Automator owner SMS.
//
// Public endpoint (no auth) like proposal-accept. Low blast radius: it only sends a
// notification (no DB writes beyond the notify inbox row). dedupeKey prevents a single
// acceptance from buzzing repeatedly.

import { supabaseAdmin } from '../lib/supabase.js';
import { notifyLeadEvent } from '../lib/leadNotify.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { name, contact, address, job, amount, slug } = req.body || {};
  if (!name || !String(name).trim() || !address || !String(address).trim()) {
    return res.status(400).json({ error: 'Name and address are required' });
  }

  const tenantSlug = String(slug || 'plus-ultra').trim();
  const { data: tenant } = await supabaseAdmin
    .from('tenants').select('id').eq('slug', tenantSlug).eq('active', true).maybeSingle();
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  const title = `Revive ACCEPTED: ${clean(address)}`;
  const body = [
    `${clean(name)} accepted the Plus Ultra Revive proposal.`,
    `Address: ${clean(address)}`,
    job ? `Scope: ${clean(job)}` : null,
    amount ? `Investment: ${clean(amount)}` : null,
    contact ? `Contact: ${clean(contact)}` : null,
  ].filter(Boolean).join('\n');

  try {
    await notifyLeadEvent({
      tenantId: tenant.id,
      event: 'won',
      title,
      body,
      contactName: clean(name),
      urgency: 'high',
      dedupeKey: `rejuv-accept:${clean(address)}:${clean(name)}`.toLowerCase().slice(0, 120),
      sms: true,
    });
  } catch (e) {
    // Notification failure should not blank the customer's success screen; the inbox
    // row is written first inside notifyLeadEvent, so a failed email/SMS still leaves a ping.
    console.error('[rejuv-accept] notify failed:', e?.message);
  }

  // Revive signs follow the SAME intercom flow as roofing (Mac, 2026-06-28):
  // fire the standard sign choreography (Work order -> Mac+Cat+Diego, Schedule
  // -> Cat, Pre-site inspection -> Diego, Draft-subcontractor-paysheet -> Cat).
  // AJ is NOT involved (departed; see aj_is_arielle). No estimate_id (Revive
  // proposals are static pages). Fail-soft + idempotent: never breaks the accept.
  try {
    const { fireSignFanout } = await import('../lib/fireSignFanout.js');
    const total = Number(String(amount || '').replace(/[^0-9.]/g, '')) || null;
    await fireSignFanout({
      tenantId: tenant.id,
      customer: clean(name),
      address: clean(address),
      phone: clean(contact) || null,
      total,
      estimateId: null,
      scopeSummary: job ? `Revive: ${clean(job)}` : 'Revive',
    });
  } catch (e) {
    console.warn('[rejuv-accept] sign fanout failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ok: true });
}
