// Ryujin OS — Estimates CRUD
// GET    /api/estimates         — List estimates (with filters)
// GET    /api/estimates?id=X    — Get single estimate
// POST   /api/estimates         — Create estimate
// PUT    /api/estimates         — Update estimate (lock-aware: locked rows accept only safe-list fields)
// DELETE /api/estimates?id=X    — Soft-delete (set status=cancelled). Locked rows can't be cancelled via this endpoint.
//
// Lock enforcement: see migration 025. Once an estimate has been presented
// to a client (status moved past draft, proposal_status=Published, accepted,
// or activity log shows client interaction), `locked_at` is set and future
// updates are restricted. To make pricing/scope edits, create a NEW estimate
// (revision) instead.
import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';

// Fields that can still be appended/edited on a locked estimate.
// Notes are jsonb arrays — we allow appends. Scheduling moves freely so
// production planning can happen post-acceptance without breaking the lock.
const SAFE_LOCKED_FIELDS = new Set([
  'notes',
  'internal_notes',
  'sales_notes',
  'production_notes',
  'scheduled_start_date',
  'scheduled_end_date'
]);

// Activity-log marker actions that retroactively prove a quote was presented
// (used both at backfill time in migration 025 and live by the auto-lock path).
const PRESENTED_ACTIVITY_ACTIONS = new Set([
  'proposal_opened',
  'tier_selected',
  'pdf_rendered',
  'pdf_downloaded',
  'video_played'
]);

// Status values that imply the proposal has gone out (moved beyond Draft)
const PRESENTED_STATUS = new Set([
  'proposal_sent', 'viewed', 'accepted', 'scheduled', 'in_progress', 'complete'
]);

function shouldAutoLock(updates, existing) {
  // Already locked — nothing to do
  if (existing.locked_at) return null;
  // Lifecycle transitions that mean "this is now presented to a client"
  if (updates.proposal_status === 'Published') return 'proposal_status flipped to Published';
  if (updates.accepted_at) return 'accepted_at set';
  if (updates.final_accepted_total != null) return 'final_accepted_total set';
  if (updates.status && PRESENTED_STATUS.has(updates.status)) return `status moved to ${updates.status}`;
  return null;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tenantId = req.tenant.id;

  // ── GET ──
  if (req.method === 'GET') {
    const { id, status, customer_id, limit = 50, offset = 0 } = req.query;

    if (id) {
      const { data, error } = await supabaseAdmin
        .from('estimates')
        .select('*, customer:customers(*), photos:estimate_photos(*), proposal:proposals(*)')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .single();

      if (error) return res.status(404).json({ error: 'Estimate not found' });
      return res.json(data);
    }

    let query = supabaseAdmin
      .from('estimates')
      .select('*, customer:customers(full_name, address, city, phone)', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'cancelled');
    if (customer_id) query = query.eq('customer_id', customer_id);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ estimates: data, total: count });
  }

  // ── POST ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // If customer info is inline, create or find customer first
    let customerId = body.customer_id;
    if (!customerId && body.customer) {
      const { data: existing } = await supabaseAdmin
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('full_name', body.customer.full_name)
        .eq('address', body.customer.address || '')
        .maybeSingle();

      if (existing) {
        customerId = existing.id;
      } else {
        const { data: newCust, error: custErr } = await supabaseAdmin
          .from('customers')
          .insert({ tenant_id: tenantId, ...body.customer })
          .select('id')
          .single();

        if (custErr) return res.status(500).json({ error: `Customer creation failed: ${custErr.message}` });
        customerId = newCust.id;
      }
    }

    const estimate = {
      tenant_id: tenantId,
      customer_id: customerId,
      created_by: body.created_by || null,
      sales_owner: body.sales_owner || null,
      proposal_mode: body.proposal_mode || 'Roof Only',
      pricing_model: body.pricing_model || 'Local',
      roof_area_sqft: body.roof_area_sqft,
      roof_pitch: body.roof_pitch,
      complexity: body.complexity || 'medium',
      eaves_lf: body.eaves_lf || 0,
      rakes_lf: body.rakes_lf || 0,
      ridges_lf: body.ridges_lf || 0,
      valleys_lf: body.valleys_lf || 0,
      walls_lf: body.walls_lf || 0,
      hips_lf: body.hips_lf || 0,
      pipes: body.pipes || 0,
      vents: body.vents || 0,
      chimneys: body.chimneys || 0,
      chimney_size: body.chimney_size || 'small',
      chimney_cricket: body.chimney_cricket || false,
      stories: body.stories || 1,
      extra_layers: body.extra_layers || 0,
      cedar_tearoff: body.cedar_tearoff || false,
      redeck_sheets: body.redeck_sheets || 0,
      new_construction: body.new_construction || false,
      siding_sqft: body.siding_sqft || 0,
      soffit_lf: body.soffit_lf || 0,
      fascia_lf: body.fascia_lf || 0,
      gutter_lf: body.gutter_lf || 0,
      window_count: body.window_count || 0,
      door_count: body.door_count || 0,
      osb_sheets: body.osb_sheets || 0,
      remediation_allowance: body.remediation_allowance || 0,
      distance_km: body.distance_km || 0,
      calculated_packages: body.calculated_packages || {},
      selected_package: body.selected_package,
      custom_prices: body.custom_prices || {},
      status: body.status || 'draft',
      notes: body.notes || [],
      tags: body.tags || [],
      ghl_opportunity_id: body.ghl_opportunity_id
    };

    const { data, error } = await supabaseAdmin
      .from('estimates')
      .insert(estimate)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Generate share token
    const shareToken = `${req.tenant.slug}-${data.estimate_number || data.id.slice(0, 8)}`;
    await supabaseAdmin
      .from('estimates')
      .update({ share_token: shareToken })
      .eq('id', data.id);

    data.share_token = shareToken;

    // Log activity
    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'estimate',
      entity_id: data.id,
      action: 'created',
      details: { proposal_mode: estimate.proposal_mode, status: estimate.status }
    });

    return res.status(201).json(data);
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    const { id, force_unlock, ...updates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Prevent cross-tenant updates + pull lock state
    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('id, locked_at, locked_reason, status, proposal_status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (!existing) return res.status(404).json({ error: 'Estimate not found' });

    // ── Lock enforcement ──────────────────────────────────────
    // If the row is locked, only safe-list fields can be modified. Anything
    // touching pricing, scope, measurements, or status changes must come
    // through a NEW estimate (revision). force_unlock=true bypasses but is
    // not advertised — internal/admin tooling only.
    if (existing.locked_at && !force_unlock) {
      const unsafeKeys = Object.keys(updates).filter(k => !SAFE_LOCKED_FIELDS.has(k));
      if (unsafeKeys.length > 0) {
        return res.status(423).json({
          error: 'Estimate is locked',
          locked_at: existing.locked_at,
          locked_reason: existing.locked_reason,
          blocked_fields: unsafeKeys,
          allowed_fields: Array.from(SAFE_LOCKED_FIELDS),
          hint: 'Locked estimates accept appends to notes/scheduling only. To make pricing/scope edits, create a NEW estimate (revision).'
        });
      }
    }

    // ── Auto-lock on lifecycle transition ─────────────────────
    // If this PUT moves the estimate into a presented state, set locked_at
    // in the same write. Subsequent edits will hit the lock check above.
    const autoLockReason = shouldAutoLock(updates, existing);
    const writePayload = autoLockReason
      ? { ...updates, locked_at: new Date().toISOString(), locked_reason: `Auto-locked on ${autoLockReason}` }
      : updates;

    const { data, error } = await supabaseAdmin
      .from('estimates')
      .update(writePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await supabaseAdmin.from('activity_log').insert({
      tenant_id: tenantId,
      entity_type: 'estimate',
      entity_id: id,
      action: 'updated',
      details: {
        fields: Object.keys(updates),
        ...(autoLockReason ? { auto_locked: autoLockReason } : {}),
        ...(force_unlock ? { force_unlock: true } : {})
      }
    });

    // ── Fire-and-forget archive on Publish transition ─────────
    // If proposal_status just flipped to Published, snapshot a PDF
    // for the historical record. Don't block the response on this —
    // the archive endpoint logs its own failures.
    if (updates.proposal_status === 'Published' && data?.share_token) {
      const archiveBase = (process.env.RYUJIN_PUBLIC_URL || 'https://ryujin-os.vercel.app').trim();
      fetch(`${archiveBase}/api/proposal-pdf?share=${encodeURIComponent(data.share_token)}`, {
        method: 'GET'
      }).then(() => {
        // Note: the actual archive insert happens in the archive script.
        // This GET just primes the PDF cache. A full auto-archive flow can
        // be added when /api/proposal-pdf-archive endpoint is built.
      }).catch(e => console.error('[estimates PUT] archive prime failed', e?.message));
    }

    return res.json(data);
  }

  // ── DELETE (soft) ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing ?id=' });

    // Refuse to cancel locked estimates via the soft-delete path. A locked
    // quote that needs to die should be handled deliberately (e.g. mark it
    // declined or void in production status, never silently flip to
    // cancelled).
    const { data: existing } = await supabaseAdmin
      .from('estimates')
      .select('locked_at, locked_reason')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (existing?.locked_at) {
      return res.status(423).json({
        error: 'Estimate is locked — cannot soft-delete',
        locked_at: existing.locked_at,
        locked_reason: existing.locked_reason,
        hint: 'A presented quote shouldn\'t be silently cancelled. Update status to declined explicitly via PUT, or use force_unlock=true if you really mean it.'
      });
    }

    const { error } = await supabaseAdmin
      .from('estimates')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ status: 'cancelled', id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default requireTenant(handler);
