// ═══════════════════════════════════════════════════════════════
// FIRE QUOTE REQUESTED — the intercom's front-of-funnel event.
//
// A real quote request (Instant Estimator / Revive estimator submission) means
// Cat + Mac prepare the video proposal presentation. This fires ONE task to Cat
// ("Prepare video proposal"); Mac sees it (owner sees all + the lead already
// notifies the owner). Diego is deliberately NOT involved here -- inspections
// are a separate "inspection booked" event, not a quote request.
//
// Best-effort + FAIL-SOFT: never throws (the lead is already captured by the
// caller). Idempotent by exact task title, so a returning lead / re-submit does
// not pile up duplicate "prepare proposal" tasks.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

const BASE = 'https://ryujin-os.vercel.app';

export async function fireQuoteRequested({ tenantId, customer, address, phone, source } = {}) {
  try {
    if (!tenantId) { console.warn('[fireQuoteRequested] no tenantId; skipping'); return { ok: false, error: 'no tenantId' }; }
    let tenantSlug = 'plus-ultra';
    try {
      const { data: t } = await supabaseAdmin.from('tenants').select('slug').eq('id', tenantId).single();
      if (t?.slug) tenantSlug = t.slug;
    } catch { /* default plus-ultra */ }
    const { data: us } = await supabaseAdmin.from('users').select('id,name').eq('tenant_id', tenantId);
    const lc = (u) => String(u.name || '').toLowerCase();
    const catId = ((us || []).find(u => lc(u).startsWith('cath') || lc(u).startsWith('cat')) || {}).id || null;

    const cust = customer || 'New lead';
    const title = `Prepare video proposal: ${cust}${address ? ' - ' + address : ''}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantSlug,
      Authorization: `Bearer ${(process.env.RYUJIN_SERVICE_TOKEN || '').trim()}`,
    };

    // Idempotency: skip if this exact "prepare proposal" task already exists.
    try {
      const r = await fetch(`${BASE}/api/tickets`, { headers });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        const arr = (j && (j.tickets || j.items)) || (Array.isArray(j) ? j : []);
        if (Array.isArray(arr) && arr.some(t => (t.title || '') === title)) {
          console.log('[fireQuoteRequested] skipped (already created):', title);
          return { ok: true, skipped: 'already created' };
        }
      }
    } catch { /* non-fatal: proceed; a rare dup is better than a missed task */ }

    const body = {
      title,
      assigned_to: catId,
      priority: 'high',
      status: 'open',
      description: `New quote request from ${cust}${source ? ` (${source})` : ''}${phone ? ` · ${phone}` : ''}. Cat + Mac: build the video proposal presentation. Address: ${address || 'TBD'}.`,
    };
    const r = await fetch(`${BASE}/api/tickets`, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.warn('[fireQuoteRequested] task POST failed:', j.error || `HTTP ${r.status}`); return { ok: false, error: j.error || `HTTP ${r.status}` }; }
    console.log('[fireQuoteRequested] task created #' + (j.ticket_number || j.id));
    return { ok: true, id: j.id || null, number: j.ticket_number || null };
  } catch (e) {
    console.warn('[fireQuoteRequested] failed (non-fatal):', e.message);
    return { ok: false, error: e.message };
  }
}

export default { fireQuoteRequested };
