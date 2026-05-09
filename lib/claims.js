// lib/claims.js
// Centralized trust-claim accessor. All customer-facing surfaces (proposal,
// contract, marketing, agent responses, generated PDFs) MUST resolve trust
// claims through this module. Never hardcode claims in templates.
//
// Status semantics:
//   'active'   → safe to render everywhere
//   'soft'     → do NOT surface to customers (drafted, pre-approval, or retracted-pending-review)
//   'disabled' → explicitly retracted, never render
//
// Migration 036 ships the schema. Seed data lives in
// scripts/_oneshot/_seed_claims_2026-05-09.mjs (run once per tenant).

import { createClient } from '@supabase/supabase-js';

const sb = () => createClient(
  process.env.SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_KEY.trim()
);

/**
 * Fetch all active claims for a tenant, optionally filtered by category.
 * Returns an array of {key, category, copy, proof_source} — only the fields
 * safe to render. Status, audit, and internal notes are intentionally excluded
 * to make accidental leakage harder.
 *
 * @param {string} tenantId
 * @param {string|string[]} [category] - optional category filter
 * @returns {Promise<Array<{key: string, category: string, copy: string, proof_source: string}>>}
 */
export async function getActiveClaims(tenantId, category) {
  let q = sb().from('claims')
    .select('key, category, copy, proof_source')
    .eq('tenant_id', tenantId)
    .eq('status', 'active');

  if (category) {
    q = Array.isArray(category) ? q.in('category', category) : q.eq('category', category);
  }

  const { data, error } = await q.order('category').order('key');
  if (error) throw new Error(`getActiveClaims: ${error.message}`);
  return data || [];
}

/**
 * Fetch a single claim by key. Returns null if not found OR not active.
 * Use this when a template needs a SPECIFIC claim (e.g. the warranty line in
 * a contract). Returning null on non-active means the calling template
 * naturally renders nothing rather than rendering a soft/retracted claim.
 */
export async function getActiveClaim(tenantId, key) {
  const { data, error } = await sb().from('claims')
    .select('key, category, copy, proof_source')
    .eq('tenant_id', tenantId)
    .eq('key', key)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new Error(`getActiveClaim(${key}): ${error.message}`);
  return data;
}

/**
 * Render a claims block as plain text lines, one claim per line.
 * Useful for agent responses + PDF generation.
 */
export async function renderClaimsBlock(tenantId, category) {
  const claims = await getActiveClaims(tenantId, category);
  return claims.map(c => c.copy).join('\n');
}

/**
 * Categories used by the system. Exported so callers can request specific
 * sets without typo risk.
 */
export const CLAIM_CATEGORIES = Object.freeze({
  INSURANCE: 'insurance',
  WARRANTY: 'warranty',
  CERTIFICATION: 'certification',
  REVIEWS: 'reviews',
  WORKMANSHIP: 'workmanship',
  DOCUMENTATION: 'documentation',
  LOCAL: 'local'
});
