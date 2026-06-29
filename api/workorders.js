// Ryujin OS - Work Orders CRUD
// GET    /api/workorders                 - list
// GET    /api/workorders?id=X            - single
// POST   /api/workorders                 - create
// PUT    /api/workorders                 - update (safe-field allow-listed)
// PATCH  /api/workorders                 - partial update (alias of PUT, safe-field allow-listed)
// DELETE /api/workorders?id=X            - cancel
import { supabaseAdmin } from '../lib/supabase.js';
import { requirePortalSessionAndTenant } from '../lib/portalAuth.js';
import { syncProjectFromWorkorder } from '../lib/projectSync.js';

// Fields a client is allowed to set via PUT/PATCH. tenant_id, id, created_at
// are NEVER editable - changing them would let a client repoint a WO at a
// different tenant. linked_estimate_id + linked_paysheet_id ARE editable
// here (the documented production flow creates the WO before the paysheet
// then PATCHes the link), but those values are revalidated server-side
// against the tenant before being persisted - see verifyLinkedRefs below.
//
// Every field below is one that production-workorders.html's saveEditWo()
// submits, plus the lifecycle/status fields that job.html drives, plus
// the linked-id fields the post-creation production flow PATCHes. When
// adding a new editable field to either surface, add it here too or the
// PUT will silently drop it and return a successful 200.
const SAFE_UPDATE_FIELDS = new Set([
  // Lifecycle + assignment
  'status',
  'sub_crew_lead',
  'sub_id',
  'subcontractor_id',
  'start_date',
  'estimated_duration_days',
  'completed_at',
  'issued_at',
  'wo_number',
  // Linked refs (validated against the tenant in verifyLinkedRefs below)
  'linked_estimate_id',
  'linked_paysheet_id',
  // Customer-on-WO contact + access
  'customer_name',
  'address',
  'phone',
  'email',
  'onsite_contact',
  'special_notes',
  'work_hours',
  // Job specs
  'job_type',
  'package_tier',
  'total_sq',
  'roof_pitch',
  'layers_to_remove',
  'shingle_product',
  'shingle_color',
  // Measurements (production-workorders.html numOrZero fields)
  'eaves_lf',
  'rakes_lf',
  'ridges_lf',
  'hips_lf',
  'valleys_lf',
  'walls_lf',
  'pipes',
  'vents',
  'chimneys',
  'osb_sheets',
  // Support crew (text[] - per migration 013, distinct from sub_crew_lead)
  'support_crew',
  // Scope + notes
  'scope_items',
  'additional_scope',
  'notes',
  // Re-decking (single canonical column from migrations.sql:117)
  'redeck_sheets',
]);

const WO_TO_PS = {
  'draft': 'scheduled',
  'issued': 'scheduled',
  'in_progress': 'in_progress',
  'complete': 'completed',
  'cancelled': 'cancelled',
};

function pickSafe(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (SAFE_UPDATE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// Cross-tenant guard: if a client tries to link this WO to an estimate or
// paysheet they do not own, reject the whole update. Each ID is checked
// against its parent table with the same tenant_id - the lookup will return
// null for any row owned by another tenant and we return an error.
async function verifyLinkedRefs(tenantId, updates) {
  if (updates.linked_estimate_id) {
    const { data } = await supabaseAdmin
      .from('estimates')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', updates.linked_estimate_id)
      .maybeSingle();
    if (!data) return { error: 'linked_estimate_id not found for this tenant' };
  }
  if (updates.linked_paysheet_id) {
    const { data } = await supabaseAdmin
      .from('paysheets')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', updates.linked_paysheet_id)
      .maybeSingle();
    if (!data) return { error: 'linked_paysheet_id not found for this tenant' };
  }
  return { ok: true };
}

async function applyUpdate(tenantId, id, rawBody) {
  const updates = pickSafe(rawBody);
  const linkCheck = await verifyLinkedRefs(tenantId, updates);
  if (linkCheck.error) return { error: { message: linkCheck.error }, status: 400 };
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('workorders')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .single();
  if (error) return { error };

  // Sync the linked paysheet status when WO status changes.
  if (updates.status && data.linked_paysheet_id) {
    const psStatus = WO_TO_PS[updates.status];
    if (psStatus) {
      const psUpdate = { status: psStatus, updated_at: new Date().toISOString() };
      if (psStatus === 'completed') psUpdate.completed_date = new Date().toISOString().slice(0, 10);
      await supabaseAdmin
        .from('paysheets')
        .update(psUpdate)
        .eq('id', data.linked_paysheet_id)
        .eq('tenant_id', tenantId);
    }
  }

  // Propagate the WO's state onto its linked project (forward-only, non-fatal).
  // A status change advances the project lifecycle; a start_date change seeds the
  // project schedule. Projects were previously orphaned from this sync loop.
  if (updates.status || updates.start_date) {
    await syncProjectFromWorkorder(tenantId, data);
  }

  return { data };
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;

  if (req.method === 'GET') {
    const { id, status, limit = 100, offset = 0, from } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('workorders')
        .select('*, estimate:estimates(estimate_number,share_token,complexity,final_accepted_total), paysheet:paysheets(job_id,status,total)')
        .eq('tenant_id', tenantId).eq('id', id).single();
      if (error) return res.status(404).json({ error: 'Work order not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('workorders')
      .select('*, estimate:estimates(estimate_number,share_token,complexity,final_accepted_total,calculated_packages,selected_package), paysheet:paysheets(job_id,status,subtotal)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('start_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'cancelled');
    // ?from=YYYY-MM-DD — only work orders starting on/after this date. Lets callers
    // (e.g. the field "Up next" strip) get UPCOMING jobs even past the page limit,
    // since the default start_date-ascending order otherwise drops future rows.
    if (from) query = query.gte('start_date', from);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Per-job gross margin for the job-list chips. Computed server-side off the
    // selected package's cost line items (pre-tax, same basis as job.html's P&L):
    // planned uses the estimate's labour cost; actual swaps the pay sheet subtotal
    // in when one exists. The heavy calculated_packages JSON is then stripped so
    // the list payload stays lean.
    const rows = (data || []).map(w => {
      const est = w.estimate;
      const pk = est && est.calculated_packages ? est.calculated_packages[est.selected_package || 'gold'] : null;
      if (pk && Number(pk.total) > 0) {
        const li = Array.isArray(pk.lineItems) ? pk.lineItems.filter(x => x && x.included !== false) : [];
        const sum = (...c) => li.filter(x => c.includes(String(x.category || '').toLowerCase())).reduce((s, x) => s + (Number(x.total_cost) || 0), 0);
        const rev = Number(pk.total);
        const mat = sum('materials', 'material');
        const lab = sum('labor', 'labour');
        const oth = sum('disposal', 'warranty', 'other', 'equipment', 'permit', 'rental');
        const plannedCost = mat + lab + oth;
        // Only surface a margin when the estimate actually carries a cost
        // breakdown. Legacy estimates with no cost line items sum to 0 and would
        // otherwise read a meaningless "100% margin" (revenue minus zero cost),
        // and the actual would be inflated by a missing material cost. No cost
        // basis -> no chip, rather than a number that is wrong.
        if (plannedCost > 0) {
          const psSub = (w.paysheet && w.paysheet.subtotal != null) ? Number(w.paysheet.subtotal) : null;
          w.margin_pct = Math.round(((rev - plannedCost) / rev) * 1000) / 10;
          w.actual_margin_pct = (psSub != null && psSub > 0)
            ? Math.round(((rev - (mat + psSub)) / rev) * 1000) / 10
            : null;
        }
      }
      if (w.estimate && w.estimate.calculated_packages) delete w.estimate.calculated_packages;
      return w;
    });
    return res.json({ workorders: rows, total: count });
  }

  if (req.method === 'POST') {
    const body = { ...(req.body || {}) };
    // wo_number is assigned by the DB serial sequence (workorders_wo_number_seq),
    // exactly like api/proposal-accept.js does on signing. Callers used to compute
    // it client-side (max+1) and pass it in, which raced across concurrent creates
    // and produced duplicate numbers (the WO-28/29 collision that broke job-by-
    // number lookups + the 15 Bissett PDF). Strip any caller-supplied value so the
    // ATOMIC serial default assigns it; migration_102's partial unique index is the
    // backstop. (migration_102 also resyncs the sequence past the current max,
    // since the old explicit inserts never advanced it.)
    delete body.wo_number;
    const row = { tenant_id: tenantId, ...body };
    const { data, error } = await supabaseAdmin.from('workorders').insert(row).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'PUT' || req.method === 'PATCH') {
    const { id, ...rest } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const result = await applyUpdate(tenantId, id, rest);
    if (result.error) {
      const status = result.status || 500;
      return res.status(status).json({ error: result.error.message });
    }
    return res.json(result.data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });
    const { data: wo, error } = await supabaseAdmin
      .from('workorders').update({ status: 'cancelled' })
      .eq('id', id).eq('tenant_id', tenantId)
      .select('id,status,start_date,linked_estimate_id,customer_name').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    // Carry the cancellation through to the linked project (forward-only, non-fatal).
    if (wo) await syncProjectFromWorkorder(tenantId, wo);
    return res.json({ status: 'cancelled', id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requirePortalSessionAndTenant(handler);
