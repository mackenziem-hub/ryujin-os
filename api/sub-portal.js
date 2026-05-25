// Ryujin OS — Subcontractor Portal v2 endpoints
//
// Consolidated routing (single Vercel function, action-routed):
//   GET  /api/sub-portal?action=photos&wo_id=X&token=Y      — photos for the linked estimate
//   GET  /api/sub-portal?action=materials&wo_id=X&token=Y   — materials list (from calculated_packages)
//   GET  /api/sub-portal?action=schedule&wo_id=X&token=Y    — start date, address, GPS, AJ contact
//   GET  /api/sub-portal?action=scope&wo_id=X&token=Y       — scope_items + checklist + measurements
//   GET  /api/sub-portal?action=rates&token=Y               — rate sheet for this sub
//   PUT  /api/sub-portal?action=update_checklist            — sub: mark a checklist step complete
//   PUT  /api/sub-portal?action=admin-settings              — owner: update sub visibility + threshold
//
// Auth: every action requires a valid magic-link token. Owner action (admin-settings)
// requires the tenant header AND a valid sub_id+updates payload — assumes the caller
// is the owner UI (admin-job-log.html) gated behind the same surface.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { SUB_RATES, RATE_SHEET_VERSION } from '../lib/subcontractor-rates.js';
import { gmailSend } from '../lib/google.js';
import crypto from 'node:crypto';

// Topic → recipient routing for sub-portal questions.
// Goal: subs never message the owner directly for things AJ handles day-to-day.
// AJ is GM and owns Ryan comms (formalized May 11 2026). Pay/rate questions
// still escalate to the owner since AJ can't unilaterally change the rate sheet.
const QUESTION_ROUTING = {
  schedule:  { match_names: ['aj'],          match_roles: [],                  label: 'AJ' },
  scope:     { match_names: ['aj'],          match_roles: [],                  label: 'AJ' },
  materials: { match_names: ['aj'],          match_roles: [],                  label: 'AJ' },
  pay:       { match_names: [],              match_roles: ['owner'],           label: 'Mac' },
  other:     { match_names: ['aj'],          match_roles: ['owner'],           label: 'AJ + Mac' }
};

// ── Token verification ──────────────────────────────────────────
// Resolves a token in either of two namespaces:
//   1. subcontractors.magic_link_token (parent sub — e.g. Ryan)
//   2. sub_crew_members.magic_token    (Ryan's crew)
// Crew tokens inherit the parent sub's job access; the returned `sub`
// is always the parent. Crew context (member id + name) is attached
// as a non-enumerable property so audit code can credit photos/logs
// to the actual person without breaking existing destructuring.
async function verifyToken(tenantId, token) {
  if (!token) return null;
  // Try parent sub first. Reject any sub whose archived_at is set, even if
  // active=true is stale - defense-in-depth alongside migration 068 which
  // flips active=false at archive time. Either gate alone is enough; both
  // together close any window where one column drifts.
  const { data: sub } = await supabaseAdmin
    .from('subcontractors')
    .select('id, name, company, magic_link_expires_at, active, archived_at, portal_visibility')
    .eq('tenant_id', tenantId)
    .eq('magic_link_token', token)
    .maybeSingle();
  if (sub) {
    if (!sub.active || sub.archived_at) return null;
    if (sub.magic_link_expires_at && new Date(sub.magic_link_expires_at) < new Date()) return null;
    sub._auth = { kind: 'sub', member_id: null, member_name: sub.name };
    return sub;
  }
  // Fall back to sub_crew_members.
  const { data: member } = await supabaseAdmin
    .from('sub_crew_members')
    .select('id, sub_id, name, active, archived_at')
    .eq('tenant_id', tenantId)
    .eq('magic_token', token)
    .maybeSingle();
  if (!member || !member.active || member.archived_at) return null;
  const { data: parent } = await supabaseAdmin
    .from('subcontractors')
    .select('id, name, company, magic_link_expires_at, active, archived_at, portal_visibility')
    .eq('tenant_id', tenantId)
    .eq('id', member.sub_id)
    .maybeSingle();
  if (!parent || !parent.active || parent.archived_at) return null;
  // Best-effort last_login bump — fire and forget.
  supabaseAdmin.from('sub_crew_members')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', member.id)
    .then(() => {}, () => {});
  parent._auth = { kind: 'crew', member_id: member.id, member_name: member.name };
  return parent;
}

// ── Photos (read-only, scoped to linked estimate) ───────────────
// Ownership: WO must belong to the authed sub. We 404 (not 403) on a foreign WO
// so the sub can't enumerate which workorder IDs exist in the tenant.
async function getPhotos(tenantId, woId, subId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, linked_estimate_id, address, customer_name')
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  if (!wo.linked_estimate_id) {
    return { wo, photos: [], note: 'No linked estimate yet — ask the owner.' };
  }

  // Pull photos with relevant captions: cover, before, drone, eagleview,
  // street*, site*, plus any uncaptioned. Also includes the 'site' category
  // (recheck photos uploaded via job.html UPLOAD PHOTOS button).
  // Column is `uploaded_at` on estimate_photos -- NOT `created_at`. Selecting
  // a missing column silently 500s -> empty photo grid in Ryan's portal.
  const { data: photos } = await supabaseAdmin
    .from('estimate_photos')
    .select('id, url, caption, category, is_cover, uploaded_at')
    .eq('estimate_id', wo.linked_estimate_id)
    .order('is_cover', { ascending: false })
    .order('uploaded_at', { ascending: true });

  const filtered = (photos || []).filter(p => {
    if (p.is_cover) return true;
    const cap = (p.caption || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    if (!cap && !cat) return true; // fully uncaptioned: include
    if (['cover', 'before', 'drone', 'eagleview', 'site', 'damage', 'inspection'].includes(cap)) return true;
    if (['cover', 'before', 'drone', 'eagleview', 'site', 'damage', 'inspection'].includes(cat)) return true;
    if (cap.includes('street') || cat.includes('street')) return true;
    return false;
  });

  return {
    wo: { id: wo.id, address: wo.address, customer_name: wo.customer_name },
    photos: filtered.map(p => ({
      url: p.url,
      caption: p.caption || null,
      category: p.category || null,
      is_cover: !!p.is_cover,
      uploaded_at: p.uploaded_at
    }))
  };
}

// ── Materials (from calculated_packages.<tier>.lineItems where category=materials) ──
async function getMaterials(tenantId, woId, subId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, linked_estimate_id, package_tier, shingle_color, shingle_product, total_sq, address')
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  let items = [];
  let tier = wo.package_tier || 'platinum';
  let total_estimated = 0;
  let supplier_summary = {};

  if (wo.linked_estimate_id) {
    const { data: est } = await supabaseAdmin
      .from('estimates')
      .select('calculated_packages, selected_package')
      .eq('id', wo.linked_estimate_id)
      .single();

    const pkgs = est?.calculated_packages || {};
    const pkgKey = est?.selected_package || tier;
    const pkg = pkgs[pkgKey] || pkgs[tier] || pkgs.platinum || pkgs.gold || null;
    const lineItems = Array.isArray(pkg?.lineItems) ? pkg.lineItems : [];

    items = lineItems
      .filter(li => li.category === 'materials' && li.included !== false)
      .map(li => {
        // Plus Ultra sourcing rules (May 9 2026 directive from Mac):
        //   • Default supplier = Coastal Drywall (single PO for nearly everything)
        //   • OSB / plywood / decking → Home Depot
        //   • SBS / mod-bit / Soprema / IKO low-slope → QXO (Dieppe branch)
        //   • Skylights / Velux → QXO
        //   • Kent is BLACKLISTED — never display "Kent" to subs even if legacy
        //     line item source_detail mentions it (the PO would route to Coastal)
        const label = String(li.label || '').toLowerCase();
        const key = String(li.item_key || '').toLowerCase();
        const isOSB = /\bosb\b|plywood|decking|sheathing/.test(label);
        const isSBS = /\bsbs\b|mod.?bit|sopr|sopralene|soprastick|peel.and.stick|low.?slope|torchflex|hyload|membrane|cap.sheet|base.sheet|termination.bar/.test(label) || /modbit/.test(key);
        const isSkylight = /skylight|velux|fakro/.test(label);
        const supplier = isOSB ? 'Home Depot' : (isSBS || isSkylight) ? 'QXO' : 'Coastal Drywall';

        // source_detail historically carried supplier-routing notes + prices.
        // For sub-facing view: strip prices AND any Kent/legacy-supplier text
        // (sub doesn't need to know Mac's PO routing decisions).
        return {
          label: li.label,
          quantity: li.quantity,
          unit: li.unit,
          source_detail: null,  // hide raw source notes — supplier label is enough
          supplier,
          item_key: li.item_key
          // No total_cost / unit_cost — Mac's COGS is not the sub's business
        };
      });
  }

  // Color status — locked if shingle_color is set on WO, else TBD
  let color_status;
  if (wo.shingle_color && String(wo.shingle_color).trim()) {
    color_status = `locked: ${wo.shingle_color}`;
  } else {
    color_status = 'TBD — confirm with owner before pickup';
  }

  return {
    wo: { id: wo.id, address: wo.address, total_sq: wo.total_sq },
    items,
    color_status,
    shingle_product: wo.shingle_product || null
    // No supplier_summary / total_estimated — sub does not see Mac's material spend
    // No package_tier — sub does not see customer-side tier
  };
}

// Mask customer name for sub-facing views: first name + last initial only.
// Strips parentheticals like "(KW realtor — pre-listing)" that could enable poaching.
// Handles composite names ("Jim & Kelly Faulkner" → "Jim F.") by treating
// connectors (&, and, /) as a single first-name unit and the last alpha word
// as the surname source.
// Used in every sub-portal endpoint that returns customer_name.
function maskCustomer(name) {
  if (!name) return null;
  const stripped = String(name).replace(/\s*\([^)]+\)\s*/g, '').trim();
  if (!stripped) return null;
  // Tokenize, keep only words that start with a letter (drops "&", "and", "/", numbers)
  const tokens = stripped.split(/\s+/).filter(t => /^[A-Za-z]/.test(t));
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0];
  // First token = first name. Last alpha token's first letter = surname initial.
  const first = tokens[0];
  const surname = tokens[tokens.length - 1];
  return `${first} ${surname[0]}.`;
}

// ── Schedule (start date, address, GPS, AJ contact) ─────────────
async function getSchedule(tenantId, woId, subId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, address, start_date, estimated_duration_days, special_notes, customer_name, phone, onsite_contact')
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  // GPS: parse from special_notes if present (look for lat,lng or "GPS:" prefix)
  let gps_coords = null;
  let gps_source = null;
  if (wo.special_notes) {
    const text = String(wo.special_notes);
    // Match e.g. "46.4567, -64.7890" or "GPS: 46.4567,-64.7890"
    const m = text.match(/(?:GPS[:\s]*)?(-?\d{1,2}\.\d{3,8})\s*[,\s]\s*(-?\d{1,3}\.\d{3,8})/);
    if (m) {
      gps_coords = { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
      gps_source = 'special_notes';
    }
  }

  // Build google maps link off of GPS or address
  let map_url;
  if (gps_coords) {
    map_url = `https://www.google.com/maps/search/?api=1&query=${gps_coords.lat},${gps_coords.lng}`;
  } else if (wo.address) {
    map_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wo.address)}`;
  } else {
    map_url = null;
  }

  // Supervisor contact: prefer tenant_settings.default_supervisor_user_id
  // (configurable per tenant via migration 068). Falls back to AJ ilike for
  // tenants that have not set the default yet. Either path returns a tap-to-
  // call ready phone when the resolved user has one.
  let supervisor_contact = { name: 'Site Supervisor', phone: null, role: 'Site Supervisor' };
  try {
    let supRow = null;
    const { data: settings } = await supabaseAdmin
      .from('tenant_settings')
      .select('default_supervisor_user_id')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (settings?.default_supervisor_user_id) {
      const { data } = await supabaseAdmin
        .from('users')
        .select('name, phone, email, role')
        .eq('tenant_id', tenantId)
        .eq('id', settings.default_supervisor_user_id)
        .maybeSingle();
      supRow = data || null;
    }
    if (!supRow) {
      const { data } = await supabaseAdmin
        .from('users')
        .select('name, phone, email, role')
        .eq('tenant_id', tenantId)
        .ilike('name', '%aj%')
        .limit(1)
        .maybeSingle();
      supRow = data || null;
    }
    if (supRow) {
      supervisor_contact = {
        name: supRow.name || 'Site Supervisor',
        phone: supRow.phone || null,
        email: supRow.email || null,
        role: supRow.role || 'Site Supervisor'
      };
    }
  } catch {}

  return {
    wo: { id: wo.id, customer_name: maskCustomer(wo.customer_name) },
    address: wo.address,
    start_date: wo.start_date,
    estimated_duration_days: wo.estimated_duration_days,
    gps_coords,
    gps_source,
    map_url,
    supervisor_contact,
    onsite_contact: wo.onsite_contact || null,
    // phone deliberately omitted — sub routes customer comms through AJ/Mac
    special_notes: wo.special_notes || null
  };
}

// ── Scope (scope_items + checklist + measurements + tier) ───────
// Drives the guided-execution UX in sub-portal.html. Returns enough for the sub
// to know exactly what to do, in what order, with which materials, including
// any per-step critical flags or notes.
async function getScope(tenantId, woId, subId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, address, customer_name, total_sq, roof_pitch, package_tier, shingle_product, shingle_color, scope_items, additional_scope, special_notes, checklist, eaves_lf, rakes_lf, ridges_lf, hips_lf, valleys_lf, walls_lf, pipes, vents, chimneys, layers_to_remove, status, start_date')
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  const checklist = Array.isArray(wo.checklist) ? wo.checklist : [];
  const completedCount = checklist.filter(s => s && s.completed).length;
  const nextStepIndex = checklist.findIndex(s => s && !s.completed);
  const nextStep = nextStepIndex >= 0 ? checklist[nextStepIndex] : null;

  // Documents (EagleView etc.) — currently shimmed via additional_scope text-tag.
  // Format in DB: "DOCUMENTS_JSON: [{label,url,type}]"
  // URLs are whitelisted to Vercel Blob storage to prevent open-redirect via DB write.
  let documents = [];
  let cleanedAdditional = wo.additional_scope || null;
  if (typeof cleanedAdditional === 'string' && cleanedAdditional.startsWith('DOCUMENTS_JSON: ')) {
    try {
      const parsed = JSON.parse(cleanedAdditional.slice('DOCUMENTS_JSON: '.length));
      const ALLOWED_HOSTS = ['public.blob.vercel-storage.com', 'ryujin-os.vercel.app'];
      documents = (Array.isArray(parsed) ? parsed : []).filter(d => {
        if (!d || typeof d !== 'object') return false;
        if (!d.url) return true; // info/note rows allowed (no link)
        try {
          const u = new URL(d.url);
          if (u.protocol !== 'https:') return false;
          return ALLOWED_HOSTS.some(host => u.hostname === host || u.hostname.endsWith('.' + host));
        } catch { return false; }
      });
      cleanedAdditional = null; // hide raw shim from sub UI
    } catch { /* ignore parse errors */ }
  }

  return {
    wo: {
      id: wo.id, address: wo.address,
      customer_name: maskCustomer(wo.customer_name),
      status: wo.status, start_date: wo.start_date,
      total_sq: wo.total_sq, roof_pitch: wo.roof_pitch,
      shingle_product: wo.shingle_product,
      shingle_color: wo.shingle_color, layers_to_remove: wo.layers_to_remove
      // package_tier deliberately omitted — sub does not see customer-side tier
    },
    documents,
    measurements: {
      eaves_lf: wo.eaves_lf, rakes_lf: wo.rakes_lf, ridges_lf: wo.ridges_lf,
      hips_lf: wo.hips_lf, valleys_lf: wo.valleys_lf, walls_lf: wo.walls_lf,
      pipes: wo.pipes, vents: wo.vents, chimneys: wo.chimneys
    },
    scope_items: Array.isArray(wo.scope_items) ? wo.scope_items : [],
    additional_scope: cleanedAdditional,
    special_notes: wo.special_notes || null,
    checklist,
    progress: {
      completed: completedCount,
      total: checklist.length,
      next_step: nextStep,
      next_step_index: nextStepIndex
    }
  };
}

// ── Update checklist step (sub marks a step done) ───────────────
// Atomic: refetch checklist, mutate the target step, write back. Step matched
// by step_number first, falling back to array index. Sets completed_at stamp
// on completion so the owner-side review can audit who/when.
async function updateChecklistStep(tenantId, woId, subId, stepIndex, completed, subName) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, checklist')
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  const checklist = Array.isArray(wo.checklist) ? [...wo.checklist] : [];
  if (stepIndex < 0 || stepIndex >= checklist.length) {
    return { error: 'Step out of range', status: 400 };
  }

  const isCompleting = !!completed;
  checklist[stepIndex] = {
    ...checklist[stepIndex],
    completed: isCompleting,
    completed_at: isCompleting ? new Date().toISOString() : null,
    completed_by: isCompleting ? (subName || 'sub') : null
  };

  const { error } = await supabaseAdmin
    .from('workorders')
    .update({ checklist, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('subcontractor_id', subId).eq('id', woId);
  if (error) return { error: error.message, status: 500 };

  return { step: checklist[stepIndex], total: checklist.length, completed: checklist.filter(s => s && s.completed).length };
}

// ── Rates (full Atlantic Roofing rate sheet) ────────────────────
function getRatesForSub(sub) {
  // Map sub name/company to slug. Currently only Atlantic Roofing is in SUB_RATES.
  const company = (sub.company || '').toLowerCase();
  const name = (sub.name || '').toLowerCase();
  let slug = null;
  if (/atlantic/i.test(company) || /ryan/i.test(name)) slug = 'atlantic-roofing';

  if (!slug || !SUB_RATES[slug]) {
    return { error: 'No rate sheet on file for this sub yet — ask the owner.', status: 404 };
  }

  const rates = SUB_RATES[slug];

  // Group into a friendlier display structure
  const groups = {
    'Base Labor (per SQ)': [
      { label: '4/12 - 6/12 pitch', value: rates.base_per_sq['4-6'], unit: '$/SQ', key: 'base_per_sq.4-6' },
      { label: '7/12 - 9/12 pitch', value: rates.base_per_sq['7-9'], unit: '$/SQ', key: 'base_per_sq.7-9' },
      { label: '10/12 - 12/12 pitch', value: rates.base_per_sq['10-12'], unit: '$/SQ', key: 'base_per_sq.10-12' },
      { label: '13/12+ extreme', value: rates.base_per_sq['13+'], unit: '$/SQ', key: 'base_per_sq.13+' },
      { label: 'Mansard', value: rates.base_per_sq['mansard'], unit: '$/SQ', key: 'base_per_sq.mansard' }
    ],
    'Tear-Off & Decking': [
      { label: 'Extra layer tear-off', value: rates.extra_layer_per_sq, unit: '$/SQ', key: 'extra_layer_per_sq' },
      { label: 'Re-deck (PU-supplied OSB)', value: rates.deck_pu_supplied_per_sheet, unit: '$/sheet', key: 'deck_pu_supplied_per_sheet' },
      { label: 'Re-deck (sub-supplied OSB)', value: rates.deck_sub_supplied_per_sheet, unit: '$/sheet', key: 'deck_sub_supplied_per_sheet' }
    ],
    'Penetrations': [
      { label: 'Chimney flash — single flue', value: rates.chimney_flash_single_flue, unit: '$/each', key: 'chimney_flash_single_flue' },
      { label: 'Chimney flash — double flue', value: rates.chimney_flash_double_flue, unit: '$/each', key: 'chimney_flash_double_flue' },
      { label: 'Chimney flash — triple flue', value: rates.chimney_flash_triple_flue, unit: '$/each', key: 'chimney_flash_triple_flue' },
      { label: 'Chimney flash — steel/metal', value: rates.chimney_flash_steel, unit: '$/each', key: 'chimney_flash_steel' },
      { label: 'Skylight install (new)', value: rates.skylight_install_new, unit: '$/each', key: 'skylight_install_new' },
      { label: 'Skylight re-use', value: rates.skylight_reuse, unit: '$/each', key: 'skylight_reuse' },
      { label: 'Pipe boot', value: rates.pipe_boot_each, unit: '$/each', key: 'pipe_boot_each' },
      { label: 'Cut-in vent', value: rates.cut_in_vent_each, unit: '$/each', key: 'cut_in_vent_each' }
    ],
    'Linear Runs': [
      { label: 'Ridge vent', value: rates.ridge_vent_per_lf, unit: '$/LF', key: 'ridge_vent_per_lf' },
      { label: 'Valley metal', value: rates.valley_metal_per_lf, unit: '$/LF', key: 'valley_metal_per_lf' },
      { label: 'Step flashing install', value: rates.step_flash_per_lf, unit: '$/LF', key: 'step_flash_per_lf' },
      { label: 'Wall metal / counter flash', value: rates.wall_flash_per_lf, unit: '$/LF', key: 'wall_flash_per_lf' }
    ],
    'Accessories & Specialty': [
      { label: 'Starter / ridge cap install', value: rates.accessory_bundle_install, unit: '$/bundle', key: 'accessory_bundle_install' },
      { label: 'Bundle carry-up (if Mac no preload)', value: rates.bundle_carry_up, unit: '$/bundle', key: 'bundle_carry_up' },
      { label: 'Low slope peel-and-stick', value: rates.low_slope_per_sq, unit: '$/SQ', key: 'low_slope_per_sq' },
      { label: 'Pigeon brow — 1-story', value: rates.pigeon_brow_single_story, unit: '$/each', key: 'pigeon_brow_single_story' },
      { label: 'Pigeon brow — 2-story', value: rates.pigeon_brow_two_story, unit: '$/each', key: 'pigeon_brow_two_story' },
      { label: 'Bay window — standard', value: rates.bay_window_standard, unit: '$/each', key: 'bay_window_standard' },
      { label: 'Bay window — oversized', value: rates.bay_window_oversized, unit: '$/each', key: 'bay_window_oversized' },
      { label: 'Grand Manor premium', value: rates.grand_manor_premium_per_sq, unit: '$/SQ extra', key: 'grand_manor_premium_per_sq' }
    ],
    'Metal Work & Carpentry': [
      { label: 'Custom brake metal — sub-supplied', value: rates.metal_bend_sub_supplied, unit: '$/run', key: 'metal_bend_sub_supplied' },
      { label: 'Custom brake metal — PU-supplied', value: rates.metal_bend_pu_supplied, unit: '$/run', key: 'metal_bend_pu_supplied' },
      { label: 'Carpentry — half day', value: rates.carpentry_half_day, unit: '$/half-day', key: 'carpentry_half_day' },
      { label: 'Carpentry — full day', value: rates.carpentry_full_day, unit: '$/day', key: 'carpentry_full_day' }
    ],
    // v2.2 per-km linear formula (May 8 2026). Shown as a single line so the
    // displayed rate matches what the paysheet computes — the old bracket
    // values (travel_per_sq_40_60km / 60plus_km) are deprecated and were
    // confusing Ryan because his paysheet "Travel surcharge (48 km)" line
    // didn't reconcile with a $20 or $30 bracket.
    'Travel & Waste': [
      {
        label: `Travel surcharge (above ${rates.travel_free_zone_km ?? 40} km free zone)`,
        value: rates.travel_per_sq_per_km_above_40 ?? 1.00,
        unit: '$/SQ per km',
        key: 'travel_per_sq_per_km_above_40'
      },
      { label: 'Waste removal — in town (<20km)', value: rates.waste_removal_in_town, unit: 'flat', key: 'waste_removal_in_town' },
      { label: 'Waste removal — out of town (20-60km)', value: rates.waste_removal_out_of_town, unit: 'flat', key: 'waste_removal_out_of_town' },
      { label: 'Waste removal — far (60+km)', value: rates.waste_removal_far, unit: 'flat', key: 'waste_removal_far' }
    ]
  };

  return {
    sub_name: rates.name,
    sub_contact: rates.contact,
    rate_sheet_version: RATE_SHEET_VERSION,
    rate_sheet_source: rates.rate_sheet_source,
    groups
  };
}

// ── Sub: send a routed question ────────────────────────────────
// Routes through QUESTION_ROUTING by topic so subs don't have to know which
// teammate handles what. Recipient is resolved by user name + role, message is
// written to the messages table (one row per recipient sharing a thread_id),
// and a Gmail alert fires to each so they see it even before opening the portal.
async function sendQuestion(tenantId, sub, body) {
  const topic = String(body.topic || 'other').toLowerCase().trim();
  const message = String(body.message || '').trim();
  if (!message) return { error: 'Message text required', status: 400 };
  if (message.length > 4000) return { error: 'Message too long (4000 char max)', status: 400 };

  const rule = QUESTION_ROUTING[topic] || QUESTION_ROUTING.other;
  const woId = body.wo_id || null;

  // Resolve recipients: name matches first (most specific), then role matches.
  const recipientMap = new Map();
  if (rule.match_names.length) {
    const orFilter = rule.match_names.map(n => `name.ilike.%${n}%`).join(',');
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('tenant_id', tenantId)
      .or(orFilter);
    for (const u of data || []) recipientMap.set(u.id, u);
  }
  if (rule.match_roles.length) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('tenant_id', tenantId)
      .in('role', rule.match_roles);
    for (const u of data || []) recipientMap.set(u.id, u);
  }
  const recipients = Array.from(recipientMap.values());
  if (!recipients.length) {
    return { error: 'No teammate available to receive this — contact the owner directly', status: 500 };
  }

  // Pull WO context for subject + body — gives the recipient enough to act
  // without opening the portal.
  let woContext = '';
  if (woId) {
    const { data: wo } = await supabaseAdmin
      .from('workorders')
      .select('wo_number, address, customer_name')
      .eq('tenant_id', tenantId).eq('id', woId)
      .maybeSingle();
    if (wo) woContext = ` · WO#${wo.wo_number} — ${wo.address}`;
  }

  const TOPIC_LABEL = { schedule: 'Schedule', scope: 'Scope', materials: 'Materials', pay: 'Pay/Rate', other: 'Question' };
  const topicLbl = TOPIC_LABEL[topic] || topic;
  const subject = `[${topicLbl}] from ${sub.name}${woContext}`.slice(0, 200);
  const fromLabel = `${sub.name}${sub.company ? ' · ' + sub.company : ''} (sub portal)`;
  const sharedThreadId = crypto.randomUUID();

  const inserts = recipients.map(r => ({
    tenant_id: tenantId,
    thread_id: sharedThreadId,
    from_user_id: null,
    from_label: fromLabel,
    to_user_id: r.id,
    subject,
    body: message,
    ref_workorder_id: woId,
    metadata: {
      source: 'sub_portal',
      sub_id: sub.id,
      topic,
      participant_count: recipients.length
    }
  }));

  const { error: insErr } = await supabaseAdmin.from('messages').insert(inserts);
  if (insErr) return { error: insErr.message, status: 500 };

  // Best-effort Gmail alert in parallel — don't block the response if any fail.
  Promise.allSettled(recipients.map(r => {
    if (!r.email) return Promise.resolve();
    const body = [
      message,
      ``,
      `─────`,
      `From: ${sub.name} (${sub.company || 'sub'}) via sub portal`,
      `Topic: ${topicLbl}`,
      woContext ? `Job:${woContext}` : '',
      ``,
      `Reply in /messages.html to keep the thread.`
    ].filter(Boolean).join('\n');
    return gmailSend(r.email, subject, body);
  })).catch(() => {});

  return {
    sent_to: recipients.map(r => ({ name: r.name, role: r.role })),
    recipient_count: recipients.length,
    label: rule.label,
    thread_id: sharedThreadId,
    topic
  };
}

// ── Owner: admin-settings PUT (visibility + threshold) ──────────
async function updateSubSettings(tenantId, body) {
  const { sub_id, portal_visibility, auto_approve_threshold_cad } = body || {};
  if (!sub_id) return { error: 'sub_id required', status: 400 };

  const updates = { updated_at: new Date().toISOString() };
  if (portal_visibility && typeof portal_visibility === 'object') {
    updates.portal_visibility = portal_visibility;
  }
  if (auto_approve_threshold_cad !== undefined && auto_approve_threshold_cad !== null) {
    const n = Number(auto_approve_threshold_cad);
    if (!Number.isFinite(n) || n < 0) return { error: 'auto_approve_threshold_cad must be a non-negative number', status: 400 };
    updates.auto_approve_threshold_cad = n;
  }

  const { data, error } = await supabaseAdmin
    .from('subcontractors')
    .update(updates)
    .eq('tenant_id', tenantId).eq('id', sub_id)
    .select('id, name, company, portal_visibility, auto_approve_threshold_cad')
    .single();
  if (error) return { error: error.message, status: 500 };
  return { subcontractor: data };
}

// ── Handler ─────────────────────────────────────────────────────
async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const tenantId = req.tenant.id;
  const action = (req.query.action || '').toLowerCase();

  // Owner-only action — admin-settings (PUT)
  if (action === 'admin-settings' && req.method === 'PUT') {
    const result = await updateSubSettings(tenantId, req.body);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  // Sub actions — require token
  const token = req.query.token;
  const sub = await verifyToken(tenantId, token);
  if (!sub) return res.status(401).json({ error: 'Invalid or expired token' });

  // Sub-write: approve a draft WO and move it to issued.
  // Parent sub only — crew members can't bind their team-lead to scope.
  if (action === 'approve_wo' && req.method === 'POST') {
    if (sub._auth?.kind === 'crew') {
      return res.status(403).json({ error: 'Only the team lead can approve work orders' });
    }
    const { wo_id } = req.body || {};
    if (!wo_id) return res.status(400).json({ error: 'wo_id required' });
    const { data: wo, error: rerr } = await supabaseAdmin
      .from('workorders')
      .select('id, status, address, customer_name, subcontractor_id, wo_number')
      .eq('tenant_id', tenantId).eq('id', wo_id).single();
    if (rerr || !wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.subcontractor_id !== sub.id) return res.status(403).json({ error: 'Not your work order' });
    if (wo.status !== 'draft') return res.status(409).json({ error: `Cannot approve — status is ${wo.status}` });

    const { error: uerr } = await supabaseAdmin
      .from('workorders')
      .update({ status: 'issued', issued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('id', wo_id);
    if (uerr) return res.status(500).json({ error: uerr.message });

    // Log to job_log_entries so AJ + Mac see it in admin
    await supabaseAdmin.from('job_log_entries').insert({
      tenant_id: tenantId,
      workorder_id: wo_id,
      subcontractor_id: sub.id,
      entry_type: 'note',
      description: `Sub approved work order via portal: ${sub.name} (${sub.company || 'Atlantic Roofing'})`,
      status: 'approved'
    }).then(() => {}, () => {}); // non-fatal

    // SMS Mac via Automator (best-effort)
    try {
      const automatorKey = process.env.AUTOMATOR_API_KEY?.trim();
      if (process.env.OWNER_SMS_MUTED === '1') { /* muted */ }
      else if (automatorKey) {
        const msg = `${sub.name} approved WO #${wo.wo_number} (${wo.address}). Now Active — ready to schedule.`;
        await fetch('https://services.leadconnectorhq.com/hooks/' + (process.env.AUTOMATOR_HOOK_ID || ''), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId: '02IhxZfSwZZAZ2fooVGu', message: msg })
        }).catch(() => {});
      }
    } catch {}

    return res.json({ ok: true, wo_id, status: 'issued' });
  }

  // Sub-write: routed question to the right teammate (AJ for most, Mac for pay)
  if (action === 'send_question' && req.method === 'POST') {
    const result = await sendQuestion(tenantId, sub, req.body || {});
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  // Sub-write: checklist step toggle
  if (action === 'update_checklist' && req.method === 'PUT') {
    const { wo_id, step_index, completed } = req.body || {};
    if (!wo_id || step_index === undefined) {
      return res.status(400).json({ error: 'wo_id and step_index required' });
    }
    const result = await updateChecklistStep(tenantId, wo_id, sub.id, Number(step_index), completed, sub.name);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required for sub actions' });

  const woId = req.query.wo_id;

  if (action === 'photos') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getPhotos(tenantId, woId, sub.id);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'materials') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getMaterials(tenantId, woId, sub.id);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'schedule') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getSchedule(tenantId, woId, sub.id);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'scope') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getScope(tenantId, woId, sub.id);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'rates') {
    const result = getRatesForSub(sub);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  return res.status(400).json({ error: 'Unknown action. Valid: photos, materials, schedule, scope, rates, update_checklist, send_question, admin-settings' });
}

export default requireTenant(handler);
