// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Entity resolver.
//
// Given a customer-name hint pulled from operator chat, find the
// closest matching customers row. Returns { customer_id, full_name,
// confidence } or null. Confidence buckets:
//   1.0  exact full-name match (case-insensitive)
//   0.85 unique distinctive last-name match (≥4 chars)
//   0.7  unique first-name match
//   0.5  fuzzy similarity > 0.5 via Postgres pg_trgm (if available)
//   null no match
//
// Pattern lifted from api/agents/cashflow.js:matchPaymentToEstimate.
// Estimate resolver below uses the same shape against the estimates
// table. Both are tenant-scoped.
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from './supabase.js';

function normalize(s) { return String(s || '').toLowerCase().trim(); }

export async function resolveCustomer(tenantId, nameHint) {
  const hint = normalize(nameHint);
  if (!hint) return null;

  // Pull a manageable working set — limit 500. Tenants past that scale
  // should add a Postgres trigram index + similarity() query; deferred.
  const { data: rows, error } = await supabaseAdmin
    .from('customers')
    .select('id, full_name, email, phone')
    .eq('tenant_id', tenantId)
    .limit(500);
  if (error || !rows?.length) return null;

  // 1. Exact full-name (case-insensitive).
  const exact = rows.find(r => normalize(r.full_name) === hint);
  if (exact) return { customer_id: exact.id, full_name: exact.full_name, confidence: 1.0 };

  // 2. Distinctive last name. "Bryon Heisler" → look for "heisler" if length ≥ 4.
  const parts = hint.split(/\s+/);
  const lastName = parts[parts.length - 1];
  if (lastName && lastName.length >= 4) {
    const lastMatches = rows.filter(r => {
      const fn = normalize(r.full_name);
      const fnParts = fn.split(/\s+/);
      return fnParts[fnParts.length - 1] === lastName;
    });
    if (lastMatches.length === 1) {
      return { customer_id: lastMatches[0].id, full_name: lastMatches[0].full_name, confidence: 0.85 };
    }
  }

  // 3. Unique first-name (rare but useful when operator says "Patricia called").
  if (parts.length === 1 && parts[0].length >= 4) {
    const firstName = parts[0];
    const firstMatches = rows.filter(r => normalize(r.full_name).startsWith(firstName + ' ') || normalize(r.full_name) === firstName);
    if (firstMatches.length === 1) {
      return { customer_id: firstMatches[0].id, full_name: firstMatches[0].full_name, confidence: 0.7 };
    }
  }

  // 4. Substring containment as a last resort (fuzzy floor).
  const contains = rows.filter(r => normalize(r.full_name).includes(hint));
  if (contains.length === 1) {
    return { customer_id: contains[0].id, full_name: contains[0].full_name, confidence: 0.5 };
  }

  return null;
}

export async function resolveEstimate(tenantId, hint) {
  // Future: match by ref id "PU-1234" or by customer_name + recent. v1 stub.
  if (!hint) return null;
  const m = String(hint).match(/PU[- ]?(\d{2,6})/i);
  if (!m) return null;
  const estimateNumber = parseInt(m[1], 10);
  const { data } = await supabaseAdmin
    .from('estimates')
    .select('id, estimate_number, customer_id')
    .eq('tenant_id', tenantId)
    .eq('estimate_number', estimateNumber)
    .maybeSingle();
  if (!data) return null;
  return { estimate_id: data.id, estimate_number: data.estimate_number, customer_id: data.customer_id, confidence: 1.0 };
}
