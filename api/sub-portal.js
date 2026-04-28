// Ryujin OS — Subcontractor Portal v2 endpoints
//
// Consolidated routing (single Vercel function, action-routed):
//   GET  /api/sub-portal?action=photos&wo_id=X&token=Y      — photos for the linked estimate
//   GET  /api/sub-portal?action=materials&wo_id=X&token=Y   — materials list (from calculated_packages)
//   GET  /api/sub-portal?action=schedule&wo_id=X&token=Y    — start date, address, GPS, AJ contact
//   GET  /api/sub-portal?action=rates&token=Y               — rate sheet for this sub
//   PUT  /api/sub-portal?action=admin-settings              — owner: update sub visibility + threshold
//
// Auth: every action requires a valid magic-link token. Owner action (admin-settings)
// requires the tenant header AND a valid sub_id+updates payload — assumes the caller
// is the owner UI (admin-job-log.html) gated behind the same surface.

import { supabaseAdmin } from '../lib/supabase.js';
import { requireTenant } from '../lib/tenant.js';
import { SUB_RATES, RATE_SHEET_VERSION } from '../lib/subcontractor-rates.js';

// ── Token verification ──────────────────────────────────────────
async function verifyToken(tenantId, token) {
  if (!token) return null;
  const { data: sub } = await supabaseAdmin
    .from('subcontractors')
    .select('id, name, company, magic_link_expires_at, active, portal_visibility')
    .eq('tenant_id', tenantId)
    .eq('magic_link_token', token)
    .single();
  if (!sub || !sub.active) return null;
  if (sub.magic_link_expires_at && new Date(sub.magic_link_expires_at) < new Date()) return null;
  return sub;
}

// ── Photos (read-only, scoped to linked estimate) ───────────────
async function getPhotos(tenantId, woId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, linked_estimate_id, address, customer_name')
    .eq('tenant_id', tenantId).eq('id', woId)
    .single();
  if (!wo) return { error: 'Work order not found', status: 404 };

  if (!wo.linked_estimate_id) {
    return { wo, photos: [], note: 'No linked estimate yet — ask the owner.' };
  }

  // Pull photos with relevant captions: cover, before, drone, eagleview, street*, plus any uncaptioned
  const { data: photos } = await supabaseAdmin
    .from('estimate_photos')
    .select('id, url, caption, is_cover, created_at')
    .eq('estimate_id', wo.linked_estimate_id)
    .order('is_cover', { ascending: false })
    .order('created_at', { ascending: true });

  const filtered = (photos || []).filter(p => {
    if (!p.caption) return true; // uncaptioned: include
    const c = String(p.caption).toLowerCase();
    return p.is_cover ||
           c === 'cover' ||
           c === 'before' ||
           c === 'drone' ||
           c === 'eagleview' ||
           c.includes('street');
  });

  return {
    wo: { id: wo.id, address: wo.address, customer_name: wo.customer_name },
    photos: filtered.map(p => ({
      url: p.url,
      caption: p.caption || null,
      is_cover: !!p.is_cover,
      uploaded_at: p.created_at
    }))
  };
}

// ── Materials (from calculated_packages.<tier>.lineItems where category=materials) ──
async function getMaterials(tenantId, woId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, linked_estimate_id, package_tier, shingle_color, shingle_product, total_sq, address')
    .eq('tenant_id', tenantId).eq('id', woId)
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
        // Bucket by supplier (Kent vs Coastal vs other)
        const src = li.source_detail || '';
        let supplier = 'Other';
        if (/coastal/i.test(src)) supplier = 'Coastal Drywall';
        else if (/kent/i.test(src)) supplier = 'Kent Building Supplies';
        else if (/bmr/i.test(src)) supplier = 'BMR';
        else if (/home depot/i.test(src)) supplier = 'Home Depot';
        const cost = Number(li.total_cost) || 0;
        supplier_summary[supplier] = (supplier_summary[supplier] || 0) + cost;
        total_estimated += cost;
        return {
          label: li.label,
          quantity: li.quantity,
          unit: li.unit,
          source_detail: li.source_detail || null,
          supplier,
          item_key: li.item_key
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
    wo: { id: wo.id, address: wo.address, total_sq: wo.total_sq, package_tier: wo.package_tier },
    items,
    supplier_summary,
    total_estimated: Math.round(total_estimated * 100) / 100,
    color_status,
    shingle_product: wo.shingle_product || null
  };
}

// ── Schedule (start date, address, GPS, AJ contact) ─────────────
async function getSchedule(tenantId, woId) {
  const { data: wo } = await supabaseAdmin
    .from('workorders')
    .select('id, address, start_date, estimated_duration_days, special_notes, customer_name, phone, onsite_contact')
    .eq('tenant_id', tenantId).eq('id', woId)
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

  // Supervisor contact: pull AJ from users for this tenant
  let supervisor_contact = { name: 'AJ', phone: null, role: 'Site Supervisor' };
  try {
    const { data: aj } = await supabaseAdmin
      .from('users')
      .select('full_name, phone, email, role')
      .eq('tenant_id', tenantId)
      .ilike('full_name', '%aj%')
      .limit(1)
      .maybeSingle();
    if (aj) {
      supervisor_contact = {
        name: aj.full_name || 'AJ',
        phone: aj.phone || null,
        email: aj.email || null,
        role: aj.role || 'Site Supervisor'
      };
    }
  } catch {}

  return {
    wo: { id: wo.id, customer_name: wo.customer_name },
    address: wo.address,
    start_date: wo.start_date,
    estimated_duration_days: wo.estimated_duration_days,
    gps_coords,
    gps_source,
    map_url,
    supervisor_contact,
    onsite_contact: wo.onsite_contact || null,
    phone: wo.phone || null,
    special_notes: wo.special_notes || null
  };
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
    'Travel & Waste': [
      { label: 'Travel surcharge — 40-60km', value: rates.travel_per_sq_40_60km, unit: '$/SQ', key: 'travel_per_sq_40_60km' },
      { label: 'Travel surcharge — 60+km', value: rates.travel_per_sq_60plus_km, unit: '$/SQ', key: 'travel_per_sq_60plus_km' },
      { label: 'Waste removal — in town', value: rates.waste_removal_in_town, unit: 'flat', key: 'waste_removal_in_town' },
      { label: 'Waste removal — out of town', value: rates.waste_removal_out_of_town, unit: 'flat', key: 'waste_removal_out_of_town' },
      { label: 'Waste removal — far', value: rates.waste_removal_far, unit: 'flat', key: 'waste_removal_far' }
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

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required for sub actions' });

  const woId = req.query.wo_id;

  if (action === 'photos') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getPhotos(tenantId, woId);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'materials') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getMaterials(tenantId, woId);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'schedule') {
    if (!woId) return res.status(400).json({ error: 'wo_id required' });
    const result = await getSchedule(tenantId, woId);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  if (action === 'rates') {
    const result = getRatesForSub(sub);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    return res.json(result);
  }

  return res.status(400).json({ error: 'Unknown action. Valid: photos, materials, schedule, rates, admin-settings' });
}

export default requireTenant(handler);
