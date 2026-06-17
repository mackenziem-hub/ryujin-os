// lib/manualProposals.js - the 4th proposal source: manual entries.
//
// Some signed deals never land in Estimator OS, Ryujin-native, or GHL in a
// reviewable shape, so they are invisible in the unified proposal book even
// though they are real, signed, and sometimes already complete. 200 Lonsdale
// is the canonical case: signed + roof complete, present only as a Ryujin-native
// row stuck in "sent" under a placeholder name, plus a local PDF. Nowhere does
// it read as the accepted/signed deal it is.
//
// This module is the lightest honest fix: a committed, per-tenant list of manual
// proposal rows the unified index reads as a 4th store. A `.js` export (not a
// JSON file) is always traced into the Vercel function bundle, so it needs no
// migration and no vercel.json includeFiles entry. To add a manual deal, append
// one object to MANUAL_PROPOSALS below and ship it; the unified read picks it up
// and dedupes it against the other stores by normalized address.
//
// A full add-from-the-UI form is a follow-up (see proposal-wizard Order 4); this
// closes the "signed-but-unstored deal is invisible everywhere" gap now.
//
// No em dashes.

// Each entry is keyed to a tenant so multi-tenant isolation holds. Fields mirror
// the normalized row shape the index already uses; the index maps these into the
// same row builder as the other three stores.
export const MANUAL_PROPOSALS = [
  {
    tenant: 'plus-ultra',
    customer: 'Concepcion Omega',
    address: '200 Lonsdale Dr, Riverview',
    // accepted = signed; the index buckets this as "accepted" (a pending bucket
    // by design) so it stays visible. The roof is complete, but the order asks
    // for it to render as a single accepted/signed row, which is what Mac signed.
    status: 'Signed',
    fromPrice: null,
    lastUpdated: '2026-06-01T00:00:00Z',
    // Local-only artifact; no shareable web link, so the UI shows "in manual".
    openUrl: null,
    ref: 'MAN-200-lonsdale'
  }
];

// Resolve the manual rows for a tenant. Tenant match is case-insensitive on the
// slug; a missing tenant returns nothing so we never leak across tenants.
export function getManualProposals(tenantId) {
  const t = String(tenantId || '').trim().toLowerCase();
  if (!t) return [];
  return MANUAL_PROPOSALS.filter(m => String(m.tenant || '').trim().toLowerCase() === t);
}
