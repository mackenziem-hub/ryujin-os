// ═══════════════════════════════════════════════════════════════
// FIRE SIGN FANOUT — the one call every "job signs" endpoint makes.
//
// Resolves the tenant slug + the fan-out people from the DB, then runs the
// (battle-tested, idempotent) executeSignFanout. Best-effort + FAIL-SOFT: it
// NEVER throws, because the caller has already saved the acceptance and a
// fan-out problem must never fail a customer's signing. Returns a small
// log-friendly summary.
//
// estimateId should be a real estimate UUID (or null). executeSignFanout
// UUID-guards it, so passing a non-UUID code just means the artifacts are not
// FK-linked rather than a 500.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';
import { executeSignFanout } from './signFanout.js';

export async function fireSignFanout({ tenantId, customer, address, phone, total, estimateId, scopeSummary } = {}) {
  try {
    if (!tenantId) { console.warn('[fireSignFanout] no tenantId; skipping'); return { ok: false, error: 'no tenantId' }; }
    let tenantSlug = 'plus-ultra';
    try {
      const { data: t } = await supabaseAdmin.from('tenants').select('slug').eq('id', tenantId).single();
      if (t?.slug) tenantSlug = t.slug;
    } catch { /* default plus-ultra */ }
    const { data: us } = await supabaseAdmin.from('users').select('id,name').eq('tenant_id', tenantId);
    const byFirst = (n) => ((us || []).find(u => String(u.name || '').toLowerCase().startsWith(n)) || {}).id || null;
    const people = { ryan: byFirst('ryan'), diego: byFirst('diego'), cat: byFirst('cath') || byFirst('cat'), mac: byFirst('mac') };
    const fan = await executeSignFanout(
      { customer, address, phone, total_incl_hst: total, scope_summary: scopeSummary || null, estimate_id: estimateId || null },
      people,
      { baseUrl: 'https://ryujin-os.vercel.app', serviceToken: (process.env.RYUJIN_SERVICE_TOKEN || '').trim(), tenant: tenantSlug },
    );
    const summary = fan.skipped ? { skipped: fan.skipped } : (fan.created || []).map(c => `${c.kind}->${c.to}:${c.id || c.error}`);
    console.log('[fireSignFanout]', JSON.stringify(summary));
    return { ok: true, fan };
  } catch (e) {
    console.warn('[fireSignFanout] failed (non-fatal):', e.message);
    return { ok: false, error: e.message };
  }
}

export default { fireSignFanout };
