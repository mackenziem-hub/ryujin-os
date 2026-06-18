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

  return res.status(200).json({ ok: true });
}
