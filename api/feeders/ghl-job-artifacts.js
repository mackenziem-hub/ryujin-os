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

const PLUS_ULTRA_SLUG = 'plus-ultra';

export async function runGhlFeeder({ tenantSlug = PLUS_ULTRA_SLUG } = {}) {
  const report = { feeder: 'ghl', tenant: tenantSlug, timestamp: new Date().toISOString(), folders_processed: 0, artifacts_posted: 0, customer_name_backfills: 0, errors: [] };

  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').eq('slug', tenantSlug).maybeSingle();
  if (!tenant) { report.errors.push(`tenant ${tenantSlug} not found`); return report; }

  const { data: folders } = await supabaseAdmin
    .from('job_folders')
    .select('id, address, customer_name, linked_ghl_contact_id')
    .eq('tenant_id', tenant.id)
    .not('linked_ghl_contact_id', 'is', null);

  if (!folders?.length) { report.errors.push('no job_folders have linked_ghl_contact_id; discovery pass not yet built'); return report; }

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

      manifest.push({
        address: f.address,
        customer_name: resolvedName || undefined,
        linked_ghl_contact_id: f.linked_ghl_contact_id,
        artifacts: notes,
      });
      report.folders_processed += 1;
      report.artifacts_posted += notes.length;
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
