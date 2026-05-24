// ═══════════════════════════════════════════════════════════════
// GHL FEEDER -- for each job_folders row with a linked_ghl_contact_id,
// fetches contact notes from GHL and posts them as job_artifacts with
// artifact_kind='contact_note'. Backfills customer_name from the GHL
// contact when the row has none.
//
// Invoice + conversation feeders are out of scope for v1 (GHL invoice
// list endpoint requires the v2 invoices API with altId/altType params
// that are not yet wired in the repo). Contact notes alone are enough
// signal for the agent to know "this customer is still active" vs
// "no one has touched this in 60 days" (the cold-stage threshold).
//
// Schedule: cron entry in vercel.json. Manual at
//   GET /api/feeders/ghl-job-artifacts?tenant=plus-ultra
// ═══════════════════════════════════════════════════════════════

import { supabaseAdmin } from '../../lib/supabase.js';
import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { ghlFetch } from '../../lib/ghl.js';
import { normalizeAddress } from '../agents/production.js';

const PLUS_ULTRA_SLUG = 'plus-ultra';
const LOCATION_ID = (process.env.GHL_LOCATION_ID || '').trim();

// Search GHL contacts by free-text query (address fragment + customer_name).
// Returns array of { id, firstName, lastName, address1, city }.
async function searchGhlContacts(query) {
  if (!query) return [];
  try {
    const data = await ghlFetch(`/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(query)}&limit=5`);
    return data?.contacts || [];
  } catch {
    return [];
  }
}

// Discovery pass: for job_folders rows missing linked_ghl_contact_id, try
// to find a matching GHL contact by address. Link only on unambiguous match.
async function runGhlDiscovery({ tenantId, report }) {
  const { data: unlinked } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, address_key, customer_name')
    .eq('tenant_id', tenantId)
    .is('linked_ghl_contact_id', null);

  if (!unlinked?.length) return;
  report.discovery_attempted = unlinked.length;
  report.discovery_linked = 0;
  report.discovery_ambiguous = [];

  for (const f of unlinked) {
    try {
      // Search by the first two tokens of the address (e.g. "178 Summerhill")
      const fragment = (f.address || '').split(/[\s,]+/).slice(0, 2).join(' ').trim();
      if (!fragment) continue;
      const candidates = await searchGhlContacts(fragment);
      // Filter to candidates whose address1 normalizes to match address_key
      const matches = candidates.filter(c => {
        const candKey = normalizeAddress(c.address1 || '');
        return candKey && candKey.startsWith(f.address_key.split(' ').slice(0, 2).join(' '));
      });
      if (matches.length === 1) {
        const patch = { linked_ghl_contact_id: matches[0].id };
        if (!f.customer_name) {
          const name = [matches[0].firstName, matches[0].lastName].filter(Boolean).join(' ').trim();
          if (name) patch.customer_name = name;
        }
        await supabaseAdmin.from('job_folders').update(patch).eq('id', f.id);
        report.discovery_linked += 1;
      } else if (matches.length > 1) {
        report.discovery_ambiguous.push({ address: f.address, candidate_count: matches.length });
      }
    } catch (e) {
      report.errors.push(`discovery ${f.address}: ${e.message}`);
    }
  }
}

// Pull invoices for a GHL contact. Per GHL v2 docs:
// GET /invoices/?altId=<locationId>&altType=location&contactId=<id>
// Returns array of invoices; each has status (draft|sent|paid|void|partially_paid)
async function fetchContactInvoices(contactId) {
  try {
    const data = await ghlFetch(
      `/invoices/?altId=${LOCATION_ID}&altType=location&contactId=${contactId}&limit=20`
    );
    return data?.invoices || data?.data || [];
  } catch (e) {
    // Invoices endpoint may 404 for contacts without any; treat as empty
    if (e.status === 404) return [];
    throw e;
  }
}

export async function runGhlFeeder({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = { feeder: 'ghl', tenant: tenantSlug, timestamp: new Date().toISOString(), folders_processed: 0, artifacts_posted: 0, customer_name_backfills: 0, errors: [] };

  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  // Discovery pass: link unlinked job_folders to GHL contacts where unambiguous.
  await runGhlDiscovery({ tenantId: tenant.id, report });

  const { data: folders } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, customer_name, linked_ghl_contact_id')
    .eq('tenant_id', tenant.id)
    .not('linked_ghl_contact_id', 'is', null);

  if (!folders?.length) return report;

  const manifest = [];
  for (const f of folders) {
    try {
      // Backfill customer_name from GHL if missing
      let resolvedName = f.customer_name;
      if (!resolvedName) {
        try {
          const contact = await ghlFetch(`/contacts/${f.linked_ghl_contact_id}`);
          const c = contact?.contact || contact;
          resolvedName = [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim() || c?.contactName || null;
          if (resolvedName) report.customer_name_backfills += 1;
        } catch (e) {
          report.errors.push(`contact lookup ${f.linked_ghl_contact_id}: ${e.message}`);
        }
      }

      // Pull notes
      const notesData = await ghlFetch(`/contacts/${f.linked_ghl_contact_id}/notes`);
      const notes = (notesData?.notes || []).map(n => ({
        source_path: `ghl:note:${n.id}`,
        artifact_kind: 'contact_note',
        file_name: (n.body || '').slice(0, 80) || `note ${n.id}`,
        mtime: n.dateAdded || null,
        raw_meta: {
          ghl_note_id: n.id,
          ghl_contact_id: f.linked_ghl_contact_id,
          user_id: n.userId || null,
          body: n.body || '',
        },
      }));

      // Pull invoices (enables `paid` stage signal in production agent).
      // GHL v2 invoice statuses: draft|sent|paid|partially_paid|void|cancelled
      let invoiceArtifacts = [];
      try {
        const invoices = await fetchContactInvoices(f.linked_ghl_contact_id);
        invoiceArtifacts = invoices.map(inv => ({
          source_path: `ghl:invoice:${inv._id || inv.id}`,
          artifact_kind: 'invoice',
          file_name: inv.name || `Invoice ${inv.invoiceNumber || inv._id || inv.id}`,
          mtime: inv.updatedAt || inv.createdAt || null,
          raw_meta: {
            ghl_invoice_id: inv._id || inv.id,
            ghl_contact_id: f.linked_ghl_contact_id,
            status: inv.status || 'unknown',
            total: inv.total ?? inv.amountDue ?? null,
            currency: inv.currency || 'CAD',
            issued_at: inv.issuedAt || inv.createdAt || null,
            paid_at: inv.paidAt || null,
          },
        }));
        report.invoices_posted = (report.invoices_posted || 0) + invoiceArtifacts.length;
      } catch (e) {
        report.errors.push(`invoices ${f.linked_ghl_contact_id}: ${e.message}`);
      }

      manifest.push({
        address: f.address,
        customer_name: resolvedName || undefined,
        linked_ghl_contact_id: f.linked_ghl_contact_id,
        artifacts: [...notes, ...invoiceArtifacts],
      });
      report.folders_processed += 1;
      report.artifacts_posted += notes.length + invoiceArtifacts.length;
    } catch (e) {
      report.errors.push(`${f.address}: ${e.message}`);
    }
  }

  if (manifest.length) {
    const base = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
    const token = (process.env.RYUJIN_SERVICE_TOKEN || '').trim();
    if (!token) { report.errors.push('RYUJIN_SERVICE_TOKEN unset; cannot post manifest'); return report; }
    const r = await fetch(`${base}/api/job-folder-sync`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantSlug,
      },
      body: JSON.stringify({ source: 'ghl', tenant: tenantSlug, folders: manifest }),
    });
    if (!r.ok) {
      report.errors.push(`sync POST failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }

  return report;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  const auth = requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const tenantSlug = (req.query?.tenant || req.headers['x-tenant-id'] || PLUS_ULTRA_SLUG).toString();
  try {
    const report = await runGhlFeeder({ tenantSlug });
    return res.json({ feeder: 'ghl', invocation: req.method === 'GET' ? 'on-demand' : 'cron', data: report });
  } catch (e) {
    console.error('[GhlFeeder] FAILED:', e.message);
    return res.status(500).json({ feeder: 'ghl', error: e.message });
  }
}
