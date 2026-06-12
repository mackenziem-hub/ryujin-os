// ═══════════════════════════════════════════════════════════════
// Payment-to-estimate matcher (extracted from api/agents/cashflow.js).
//
// Dependency-free on purpose: the cashflow agent's module graph pulls in
// supabase/google clients that throw at import time without env vars, which
// made the matcher untestable in isolation. This module is pure functions.
//
// Match order: exact full name, then unique distinctive last name, then
// address. The address fallback requires BOTH a civic-number window AND a
// shared street-name token. The old number-only +-20 window mis-attributed
// cross-street payments (a payment for "30 Main St" could glue to
// "25 Windy Hill" whenever it was the only estimate in the numeric band),
// which is how money landed on the wrong jobs silently. With the token
// requirement, ambiguous payments fall through to unmatched, where the
// arExceptions surface makes them visible instead of silently wrong.
// ═══════════════════════════════════════════════════════════════

// Generic address words that carry no street identity. Includes the road-type
// suffixes plus unit/route designator words. Numeric tokens are NOT noise:
// "Route 495" reduces to the token "495", which is the street's real identity.
const ADDRESS_NOISE_TOKENS = new Set([
  'rd', 'road', 'st', 'street', 'ave', 'avenue', 'dr', 'drive',
  'cres', 'crescent', 'ln', 'lane', 'blvd', 'boulevard', 'ct', 'court',
  'pl', 'place', 'terr', 'terrace', 'way', 'hwy', 'highway',
  'rte', 'route', 'rt', 'chemin', 'ch', 'rue',
  'unit', 'apt', 'suite', 'nb', 'new', 'brunswick'
]);

// Tokenize an address (or invoice descriptor) into its identifying street
// tokens: lowercase, strip punctuation, drop the LEADING civic number (it is
// compared separately via the number window), drop generic suffix words.
// "5380 Rte. 495" -> {495}   "25 Windy Hill Rd" -> {windy, hill}
// "10406 route 134 St Louis" -> {134, louis}
export function addressNameTokens(str) {
  const tokens = (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length && /^\d+$/.test(tokens[0])) tokens.shift();
  return new Set(tokens.filter(t => !ADDRESS_NOISE_TOKENS.has(t)));
}

function firstCivicNumber(str) {
  const m = (str || '').match(/\b(\d{2,5})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function shareToken(a, b) {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

// Match by: exact name -> last-name -> address (number window + street token).
// Estimates are the unified pool from BOTH sources (estimator-os + ryujin),
// each with normalized {id, source, fullName, address, finalAcceptedTotal, ...}.
export function matchPaymentToEstimate(payment, estimates) {
  const pmtName = (payment.customer || '').toLowerCase().trim();
  if (!pmtName) return null;

  // Exact full-name match
  const hit = estimates.find(e => (e.fullName || '').toLowerCase().trim() === pmtName);
  if (hit) return hit;

  // Last-name match (only if last name is distinctive, avoid "Smith" collisions)
  const pmtParts = pmtName.split(/\s+/);
  const lastName = pmtParts[pmtParts.length - 1];
  if (lastName && lastName.length >= 4) {
    const matches = estimates.filter(e => {
      const fn = (e.fullName || '').toLowerCase();
      const parts = fn.split(/\s+/);
      return parts[parts.length - 1] === lastName;
    });
    if (matches.length === 1) return matches[0];
  }

  // Address match from the invoice description. Requires BOTH:
  //  - civic number within +-20 (keeps absorbing data-entry slop, 5380 vs 5360)
  //  - at least one shared street-name token (stops cross-street collisions)
  // When several estimates pass both gates, prefer an exact civic-number hit;
  // still ambiguous means no match. Unmatched-and-visible beats wrong-and-silent
  // for money attribution.
  if (payment.invoiceDescription) {
    const streetNum = firstCivicNumber(payment.invoiceDescription);
    if (streetNum != null) {
      const pmtTokens = addressNameTokens(payment.invoiceDescription);
      if (pmtTokens.size > 0) {
        const candidates = estimates.filter(e => {
          const estNum = firstCivicNumber(e.address);
          if (estNum == null || Math.abs(estNum - streetNum) > 20) return false;
          return shareToken(pmtTokens, addressNameTokens(e.address));
        });
        if (candidates.length === 1) return candidates[0];
        if (candidates.length > 1) {
          const exact = candidates.filter(e => firstCivicNumber(e.address) === streetNum);
          if (exact.length === 1) return exact[0];
        }
      }
    }
  }

  return null;
}

// Collapse duplicate customers across the two estimate sources. The same
// customer often exists in BOTH Estimator OS and Ryujin, and the rows disagree:
// Estimator OS finalAcceptedTotal is pre-tax on some rows and null on others,
// while Ryujin final_accepted_total is the tax-inclusive customer-pays number
// (verified Jun 12 2026: Seyeau 26,000 pre-tax vs 29,900 tax-in, Arzaga 16,191
// vs 17,971.12 = exactly what he paid, Fram null vs 13,428.55 = exactly his
// 30% deposit + 70% balance). Name-matching bound to whichever row was pushed
// first (Estimator OS), so contracts read wrong: phantom over-collections
// (Seyeau +3,900, Arzaga +1,780.12) and null contracts that hid a real $6,000
// anomaly on Fram. Keep ONE row per customer name: prefer a non-null contract
// total, then prefer the ryujin source (tax-inclusive basis).
export function dedupeEstimatePool(estimates) {
  const byName = new Map();
  const keep = [];
  for (const e of estimates) {
    const key = (e.fullName || '').toLowerCase().trim();
    if (!key) { keep.push(e); continue; }
    const prev = byName.get(key);
    if (!prev) { byName.set(key, e); continue; }
    byName.set(key, betterEstimateRow(prev, e));
  }
  return [...keep, ...byName.values()];
}

function betterEstimateRow(a, b) {
  const aHasTotal = a.finalAcceptedTotal != null;
  const bHasTotal = b.finalAcceptedTotal != null;
  if (aHasTotal !== bHasTotal) return aHasTotal ? a : b;
  if (a.source !== b.source) return a.source === 'ryujin' ? a : b;
  return a;
}
