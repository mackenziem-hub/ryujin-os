// Ryujin OS — Pay Sheet Calculator
// POST /api/paysheet-calc
// Server-side compute of subcontractor labor breakdown + add-ons + surcharges + totals.
// Source of truth: lib/subcontractor-rates.js (computeSubPaysheet)
//
// Designed to be called by chat tool compute_paysheet_lines BEFORE create_paysheet,
// so the brain never inserts an empty paysheet again.
//
// As of Apr 27 2026 the actual line-item math lives in lib/subcontractor-rates.js
// so the quote engine can share it. This file is the HTTP wrapper.
import { requireTenant } from '../lib/tenant.js';
import { computeSubPaysheet } from '../lib/subcontractor-rates.js';

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const {
    subcontractor_slug,
    customer_name,
    address,
    job_id,
    measurements = {},
    package_tier,
    scope_extras = {}
  } = body;

  if (!subcontractor_slug) {
    return res.status(400).json({ error: 'subcontractor_slug is required (e.g. "atlantic-roofing")' });
  }

  let result;
  try {
    result = computeSubPaysheet(measurements, package_tier, scope_extras, subcontractor_slug);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Add the request-scoped fields back to the computed_from block so the
  // existing chat tool / paysheet drafter doesn't lose them.
  result.computed_from = {
    ...result.computed_from,
    job_id: job_id || null,
    customer_name: customer_name || null,
    address: address || null
  };

  return res.json(result);
}

export default requireTenant(handler);
