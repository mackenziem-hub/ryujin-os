// api/job-docs.js - role-aware job documents for the field app.
// GET /api/job-docs?project_id=X -> { paysheet (role-sanitized), eagleViewUrl, workOrderNumber }
//
// Resolves project -> estimate -> work order -> pay sheet and gates by the SESSION
// role: owner/admin/manager (privileged) get the full pay sheet; a sub/crew member
// gets a sub-safe shape (line items + totals only, allowlisted fields, no estimate
// share token, no payment tracker, no margins) AND only for a job whose sub matches
// them. EagleView (public Blob url) renders for everyone (operational, no pricing).
//
// Tenant is bound to the SESSION via requirePortalSessionAndTenant (never the
// client x-tenant-id), so a logged-in user of tenant A cannot read tenant B.
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';

// Allowlist the line-item fields a pay-sheet row may expose (no notes, cost, margin,
// or any future internal field can slip through a denylist).
const ROW_KEYS = ['label', 'description', 'qty', 'qty_sq', 'unit', 'rate', 'rate_per_sq', 'total'];
const safeRows = (rows) => Array.isArray(rows)
  ? rows.map((r) => { const o = {}; for (const k of ROW_KEYS) if (r && r[k] !== undefined) o[k] = r[k]; return o; })
  : [];

// Best-effort assignment: the field session user (e.g. "Ryan") and the subcontractor
// record (e.g. "Atlantic Roofing ... (Ryan)") have no FK, so match the user's name
// against the sub on the pay sheet / work order. A non-matching sub or an hourly
// crew member does not see another sub's pay.
function assignedToSub(session, ps, woSub) {
  const nm = String(session?.name || '').trim().toLowerCase();
  if (!nm) return false;
  const hay = (String(ps?.subcontractor || '') + ' ' + String(woSub || '')).toLowerCase();
  if (hay.includes(nm)) return true;
  const first = nm.split(/\s+/)[0];
  return first.length >= 3 && hay.includes(first);
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const session = req.session;                 // set by requirePortalSessionAndTenant
  const tenantId = req.tenant.id;              // bound to session.tenant_id, not client input
  const role = String(session?.role || '').toLowerCase();
  const priv = ['owner', 'admin', 'manager'].includes(role);

  const project_id = req.query.project_id;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  const { data: project } = await supabaseAdmin
    .from('projects').select('id, estimate_id').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  let eagleViewUrl = null, eagleViewLabel = null, estimateNumber = null, workOrderNumber = null;
  let linkedPaysheetId = null, woSubLead = null;

  if (project.estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates').select('id, estimate_number, custom_prices')
      .eq('id', project.estimate_id).eq('tenant_id', tenantId).maybeSingle();
    if (est) {
      estimateNumber = est.estimate_number;
      const cp = est.custom_prices || {};
      eagleViewUrl = cp._eagleview_pdf_url || null;   // public Blob, operational, safe for all
      eagleViewLabel = cp._eagleview_label || null;
    }
    const { data: wos } = await supabaseAdmin
      .from('workorders').select('id, wo_number, linked_paysheet_id, sub_crew_lead')
      .eq('tenant_id', tenantId).eq('linked_estimate_id', project.estimate_id)
      .order('created_at', { ascending: false }).limit(1);
    if (wos && wos[0]) { workOrderNumber = wos[0].wo_number; linkedPaysheetId = wos[0].linked_paysheet_id; woSubLead = wos[0].sub_crew_lead; }
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
      } else if (assignedToSub(session, ps, woSubLead)) {
        // Sub-safe: allowlisted line items + totals only. No estimate token, payment
        // tracker, scope notes, or margins reach a sub/crew viewer.
        paysheet = {
          id: ps.id, status: ps.status,
          labour_breakdown: safeRows(ps.labour_breakdown), add_ons: safeRows(ps.add_ons), surcharges: safeRows(ps.surcharges),
          subtotal: ps.subtotal, hst: ps.hst, total: ps.total,
        };
      }
      // else: a non-matching sub / hourly crew member sees no pay sheet (WO + EagleView still show).
    }
  }

  return res.json({ role, priv, estimateNumber, workOrderNumber, eagleViewUrl, eagleViewLabel, paysheet });
}

export default requirePortalSessionAndTenant(handler);
