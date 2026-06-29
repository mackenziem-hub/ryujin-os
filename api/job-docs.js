// api/job-docs.js - role-aware job documents for the field app.
// GET /api/job-docs?project_id=X -> { paysheet (role-sanitized), eagleViewUrl, workOrderNumber }
//
// Resolves project -> estimate -> work order -> pay sheet server-side and gates by
// the SESSION role: owner/admin/manager (privileged) get the full pay sheet; crew/
// sub get a sanitized shape (line items + totals only, per-row notes stripped, NO
// estimate share token, NO payment tracker, NO margins). This is the same sub-safe
// contract the magic-link sub portal enforces, applied to the in-app field folder.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { resolveSession, isPrivileged } from '../lib/portalAuth.js';

const stripNotes = (rows) => Array.isArray(rows)
  ? rows.map((r) => { const o = { ...(r || {}) }; delete o.note; return o; })
  : [];

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const tenantId = req.tenant.id;

  const session = await resolveSession(req);
  if (!session) return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  const role = String(session.role || '').toLowerCase();
  const priv = isPrivileged(session) || ['owner', 'admin', 'manager'].includes(role);

  const project_id = req.query.project_id;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const { data: project } = await supabaseAdmin
    .from('projects').select('id, estimate_id').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let eagleViewUrl = null, eagleViewLabel = null, estimateNumber = null, workOrderNumber = null;
  let linkedPaysheetId = null;

  if (project.estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates').select('id, estimate_number, custom_prices')
      .eq('id', project.estimate_id).eq('tenant_id', tenantId).maybeSingle();
    if (est) {
      estimateNumber = est.estimate_number;
      const cp = est.custom_prices || {};
      eagleViewUrl = cp._eagleview_pdf_url || null;      // public Blob url, operational, safe for all
      eagleViewLabel = cp._eagleview_label || null;
    }
    const { data: wos } = await supabaseAdmin
      .from('workorders').select('id, wo_number, linked_paysheet_id')
      .eq('tenant_id', tenantId).eq('linked_estimate_id', project.estimate_id)
      .order('created_at', { ascending: false }).limit(1);
    if (wos && wos[0]) { workOrderNumber = wos[0].wo_number; linkedPaysheetId = wos[0].linked_paysheet_id; }
  }

  let paysheet = null;
  if (linkedPaysheetId) {
    const { data: ps } = await supabaseAdmin
      .from('paysheets').select('*').eq('id', linkedPaysheetId).eq('tenant_id', tenantId).maybeSingle();
    if (ps) {
      if (priv) {
        paysheet = {
          id: ps.id, status: ps.status, subcontractor: ps.subcontractor,
          labour_breakdown: ps.labour_breakdown || [], add_ons: ps.add_ons || [], surcharges: ps.surcharges || [],
          subtotal: ps.subtotal, hst: ps.hst, total: ps.total, eagleview_report: ps.eagleview_report,
        };
      } else {
        // Sub/crew-safe: line items + totals, notes stripped, no add-ons-with-notes,
        // no payment_tracker / scope_notes / estimate token.
        paysheet = {
          id: ps.id, status: ps.status,
          labour_breakdown: stripNotes(ps.labour_breakdown), surcharges: stripNotes(ps.surcharges),
          subtotal: ps.subtotal, hst: ps.hst, total: ps.total,
        };
      }
    }
  }

  return res.json({ role, priv, estimateNumber, workOrderNumber, eagleViewUrl, eagleViewLabel, paysheet });
}

export default requireTenant(handler);
