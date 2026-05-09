// POST /api/estimates-sync-ghl?id=<estimate_id>
// Pushes a Ryujin estimate into GHL Payments → Estimates as a draft.
// Saves the resulting GHL estimate ID back to the estimate row so we don't
// double-create on subsequent clicks.
//
// Customer matching:
//   1. customer.ghl_contact_id  → use directly
//   2. else search GHL by customer.email, take first match
//   3. else create a new GHL contact from the customer record
//
// Line items: bundles the accepted/selected package total into a single
// labor+materials line. Detailed line-item breakdown stays in the Ryujin
// proposal page; GHL estimate is for tracking + customer-side acceptance.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

// Always hit the production alias — preview deployment URLs are behind
// Vercel SSO and would 401 the self-fetch.
const GHL_BASE_LOCAL = 'https://ryujin-os.vercel.app';

function pickPrice(est) {
  if (est.final_accepted_total) return Number(est.final_accepted_total);
  const pkg = est.selected_package;
  if (pkg && est.calculated_packages?.[pkg]) {
    const p = est.calculated_packages[pkg];
    return Number(p.total || p.totalWithTax || p.sellingPrice || 0);
  }
  if (est.calculated_packages) {
    const first = Object.values(est.calculated_packages)[0];
    if (first) return Number(first.total || first.totalWithTax || first.sellingPrice || 0);
  }
  return 0;
}

function pickSubtotal(est) {
  if (est.final_accepted_total) return Number(est.final_accepted_total) / 1.15;
  const pkg = est.selected_package;
  if (pkg && est.calculated_packages?.[pkg]) {
    const p = est.calculated_packages[pkg];
    return Number(p.sellingPrice || p.total / 1.15 || 0);
  }
  if (est.calculated_packages) {
    const first = Object.values(est.calculated_packages)[0];
    if (first) return Number(first.sellingPrice || first.total / 1.15 || 0);
  }
  return 0;
}

async function findOrCreateGhlContact(customer) {
  if (customer.ghl_contact_id) {
    return { id: customer.ghl_contact_id, source: 'cached' };
  }
  const [firstName, ...rest] = (customer.full_name || 'Customer').split(' ');
  const lastName = rest.join(' ') || '';
  const cr = await fetch(`${GHL_BASE_LOCAL}/api/ghl?action=create-contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName,
      lastName,
      email: customer.email || undefined,
      phone: customer.phone || undefined,
      address1: customer.address || undefined,
      city: customer.city || undefined,
      state: customer.province || 'NB',
      country: 'Canada',
      source: 'Ryujin sync'
    })
  });
  if (cr.ok) {
    const cd = await cr.json();
    return { id: cd.contact?.id || cd.id, source: 'created' };
  }
  // GHL rejects duplicates with the existing contactId in meta.contactId.
  // The error is double-wrapped: { error: "GHL 400: {...}" } — JSON-escaped backslashes
  // break a naive regex, so unwrap the inner JSON first.
  const errText = await cr.text();
  let inner = errText;
  try {
    const outer = JSON.parse(errText);
    if (typeof outer.error === 'string') {
      const m = outer.error.match(/^GHL \d+: (.+)$/s);
      if (m) inner = m[1];
    }
  } catch {}
  try {
    const parsed = JSON.parse(inner);
    if (parsed?.meta?.contactId) return { id: parsed.meta.contactId, source: 'matched_existing' };
  } catch {}
  throw new Error(`Could not create GHL contact: ${cr.status} ${errText}`);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing estimate id' });

  const tenantId = req.tenant.id;

  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*)')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single();

  if (error || !est) return res.status(404).json({ error: 'Estimate not found' });
  if (!est.customer) return res.status(400).json({ error: 'Estimate has no linked customer — add one first' });

  if (est.ghl_estimate_id) {
    return res.status(409).json({
      error: 'Already synced',
      ghl_estimate_id: est.ghl_estimate_id,
      synced_at: est.ghl_estimate_synced_at,
      hint: 'Delete the GHL estimate first if you want to resync, or clear ghl_estimate_id on the row.'
    });
  }

  const total = pickPrice(est);
  const subtotal = pickSubtotal(est);
  if (subtotal <= 0) {
    return res.status(400).json({ error: 'Estimate has no calculable price — run the quote engine first' });
  }

  let contact;
  try {
    contact = await findOrCreateGhlContact(est.customer);
  } catch (e) {
    return res.status(500).json({ error: 'Contact resolution failed', detail: e.message });
  }

  if (contact.source === 'created' || contact.source === 'matched_by_email') {
    await supabaseAdmin.from('customers').update({ ghl_contact_id: contact.id }).eq('id', est.customer.id);
  }

  const pkg = est.selected_package || 'Quote';
  const mode = est.proposal_mode || 'Roof';
  const addr = est.customer.address ? `${est.customer.address}, ${est.customer.city || ''}`.trim().replace(/,\s*$/, '') : '';

  const itemName = `${pkg.charAt(0).toUpperCase() + pkg.slice(1)} - ${mode}`.slice(0, 100);
  const itemDescription = [
    addr ? `Site: ${addr}.` : '',
    est.roof_area_sqft ? `Roof area: ${est.roof_area_sqft} sqft.` : '',
    est.roof_pitch ? `Pitch: ${est.roof_pitch}.` : '',
    `Bundled retail: materials + labor + warranty.`,
    `Full scope detail in Ryujin proposal: https://ryujin-os.vercel.app/proposal-client.html?share=${est.share_token || est.id}`
  ].filter(Boolean).join(' ');

  const ghlBody = {
    contactId: contact.id,
    name: `${(est.customer.full_name || '').split(' ').pop() || 'Customer'} - ${mode}`.slice(0, 40),
    currency: 'CAD',
    taxPercentage: 15,
    validDays: 30,
    termsNotes: `Estimate # Ryujin-${est.estimate_number || id.slice(0, 8)}. Bundled price reflects current scope. See linked proposal for full details + tier comparison.`,
    items: [{ name: itemName, description: itemDescription, qty: 1, amount: subtotal }]
  };

  const er = await fetch(`${GHL_BASE_LOCAL}/api/ghl?action=create-estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ghlBody)
  });
  const ed = await er.json();
  if (!er.ok) {
    return res.status(502).json({ error: 'GHL estimate create failed', detail: ed });
  }

  const ghlEstimateId = ed.estimate?._id || ed.estimate?.id;
  if (ghlEstimateId) {
    await supabaseAdmin
      .from('estimates')
      .update({ ghl_estimate_id: ghlEstimateId, ghl_estimate_synced_at: new Date().toISOString() })
      .eq('id', id);
  }

  return res.json({
    action: 'synced',
    ryujin_estimate_id: id,
    ghl_estimate_id: ghlEstimateId,
    ghl_contact_id: contact.id,
    contact_source: contact.source,
    summary: ed.summary,
    timestamp: new Date().toISOString()
  });
}

export default requireTenant(handler);
