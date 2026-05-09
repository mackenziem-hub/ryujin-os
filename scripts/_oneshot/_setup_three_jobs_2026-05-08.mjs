// One-shot — May 8 2026 (revised evening — DB-column version)
// Inserts 3 paysheets + 3 workorders into Ryujin DB for Mac's three jobs:
//   1. PU-2026-016 — Kyle Graham · 67 Fairisle Drive · SIGNED $16,157 incl HST
//   2. PU-2026-0045 — Shelagh Peach · 5360 NB-495 · SIGNED $19,702 (existing #35)
//      — patched to include 20-sheet redeck change order ($600 added to Ryan's pay)
//   3. PU-2026-018 — Christian KW · 265 Irving Blv · Gold-priced Plat upgrade $14,286
//
// REQUIRES migration 035 applied first (adds sub_acceptance_* columns to paysheets).
// Token persisted in paysheets.sub_acceptance_token column. Run script after migration.
// Sub-facing accept links printed at end.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// ── env loader ─────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
const env = readFileSync(envPath, 'utf8');
function envGet(k) {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
}
process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || envGet('BLOB_READ_WRITE_TOKEN');

const sb = createClient(envGet('SUPABASE_URL'), envGet('SUPABASE_SERVICE_KEY'), {
  auth: { persistSession: false }
});

const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b'; // Plus Ultra Roofing
const FAIRISLE_EST_ID = 'b3cf2f68-beef-498c-bd83-2efc8972dbe7'; // #30
const PEACH_EST_ID = 'd4467b55-21cd-4cb4-8ee9-c22d8b542b8a';    // #35
const IRVING_EST_ID = '9fdb6db3-5291-486c-a1e9-7dee7a742deb';   // #41

const newToken = () => randomBytes(16).toString('hex');

// ── PAYSHEET DEFINITIONS ───────────────────────────────────

const FAIRISLE = {
  job_id: 'PU-2026-016',
  address: '67 Fairisle Drive, Moncton NB',
  customer_name: 'Kyle Graham',
  subcontractor: 'Atlantic Roofing & Contracting Inc. (Ryan)',
  status: 'scheduled',
  shingle_product: 'CertainTeed Landmark Pro',
  job_type: 'replacement',
  labour_breakdown: [
    { label: 'Base labor — 4-6/12 pitch', qty: 24.2, unit: 'SQ', rate: 130, total: 3146 },
    { label: 'Pipe boots', qty: 1, unit: 'each', rate: 25, total: 25 },
    { label: 'Skylight reflash (walkable)', qty: 1, unit: 'each', rate: 75, total: 75 },
    { label: 'Ridge vent', qty: 68, unit: 'LF', rate: 1.5, total: 102 },
    { label: 'Valley metal', qty: 14, unit: 'LF', rate: 1, total: 14 }
  ],
  add_ons: [],
  surcharges: [
    { label: 'Travel (8 km, local)', total: 0 },
    { label: 'Waste removal (Ryan-supplied, in-town)', total: 350 }
  ],
  subtotal: 3712.00,
  hst: 556.80,
  total: 4268.80,
  scope_notes: [
    'Full tear-off + reinstall, asphalt, Platinum spec (CertainTeed Landmark Pro)',
    '24.2 SQ, 4/12 simple, 2-story',
    '1 pipe boot, 1 skylight (Velux FS M06 reflash — confirm full replacement vs reflash on site)',
    'Aug 2025 honor pricing — customer signed at $16,157 incl HST',
    'v2.1 canonical rates restored May 8 — base $130/SQ for 4-6 band',
    'Skylight billed as walkable-pitch reflash ($75). Bump to $500 if full Velux replacement needed.',
    'Local job (8 km from Moncton) — no travel surcharge.'
  ],
  linked_estimate_id: FAIRISLE_EST_ID
};

const PEACH = {
  job_id: 'PU-2026-0045',
  address: '5360 NB-495, Sainte-Marie-de-Kent NB',
  customer_name: 'Shelagh Peach',
  subcontractor: 'Atlantic Roofing & Contracting Inc. (Ryan)',
  status: 'in_progress',
  shingle_product: 'CertainTeed Landmark Pro — Weathered Wood',
  job_type: 'replacement',
  labour_breakdown: [
    { label: 'Main back upper+lower (3/12 — shingled as standard per Mac)', qty: 5.7, unit: 'SQ', rate: 130, total: 741 },
    { label: 'Attached garage lower back (4/12)', qty: 2.2, unit: 'SQ', rate: 130, total: 286 },
    { label: 'Front main lower (5/12)', qty: 2.4, unit: 'SQ', rate: 130, total: 312 },
    { label: 'Detached garage (9/12)', qty: 11.5, unit: 'SQ', rate: 160, total: 1840 },
    { label: 'Attached garage lower porch (10-12/12)', qty: 3.8, unit: 'SQ', rate: 190, total: 722 },
    { label: 'Front main dormer middle (10-12/12)', qty: 4.6, unit: 'SQ', rate: 190, total: 874 },
    { label: 'Re-decking — front face (20 sheets, PU-supplied) — CHANGE ORDER May 8', qty: 20, unit: 'sheet', rate: 30, total: 600 },
    { label: 'Open metal valley install', qty: 30, unit: 'LF', rate: 1, total: 30 },
    { label: 'Ridge vent install (PU-supplied)', qty: 100, unit: 'LF', rate: 1, total: 100 },
    { label: 'Pipe flashing 3"', qty: 1, unit: 'each', rate: 25, total: 25 },
    { label: 'Hydro mast boot', qty: 1, unit: 'each', rate: 25, total: 25 },
    { label: 'Brick chimney reflash (small/medium)', qty: 1, unit: 'each', rate: 150, total: 150 }
  ],
  add_ons: [],
  surcharges: [
    { label: 'Travel surcharge 40-60 km (48.1 km) — $20/SQ × 30.2', total: 604 }
  ],
  subtotal: 6309.00,
  hst: 946.35,
  total: 7255.35,
  scope_notes: [
    'Free Platinum upgrade — customer paid Gold, gets Platinum spec (Landmark Pro)',
    '6 distinct roof sections including detached 30×32 garage',
    '3/12 main back = Mac decision to shingle as standard (NOT peel-and-stick)',
    '20-sheet front-face redeck change order added May 8 (PU-supplied OSB at $30/sheet sub install rate)',
    'AJ supervises ~1.5 days (paid separately on PU side at $270/day — NOT on Ryan sheet)',
    'Decking contingency for additional rot: $30/sheet PU-supplied → $90/sheet customer-billed if more rot found',
    'Additional asphalt layer: $40/SQ if 2nd layer found (Ryan invoices, customer billed)',
    'v2.1 canonical rates locked'
  ],
  linked_estimate_id: PEACH_EST_ID,
  scheduled_date: '2026-05-05'
};

const IRVING = {
  job_id: 'PU-2026-018',
  address: '265 Irving Blv, Bouctouche NB',
  customer_name: 'Christian (KW realtor — pre-listing)',
  subcontractor: 'Atlantic Roofing & Contracting Inc. (Ryan)',
  status: 'scheduled',
  shingle_product: 'CertainTeed Landmark Pro',
  job_type: 'replacement',
  labour_breakdown: [
    { label: 'Base labor — 4-6/12 pitch', qty: 20, unit: 'SQ', rate: 130, total: 2600 },
    { label: 'Pipe boots', qty: 1, unit: 'each', rate: 25, total: 25 },
    { label: 'Ridge vent', qty: 50, unit: 'LF', rate: 1.5, total: 75 }
  ],
  add_ons: [],
  surcharges: [
    { label: 'Travel surcharge (50 km, day-trip band) — $20/SQ × 20', total: 400 },
    { label: 'Waste removal (Ryan-supplied, out-of-town band)', total: 450 }
  ],
  subtotal: 3550.00,
  hst: 532.50,
  total: 4082.50,
  scope_notes: [
    'Free Platinum upgrade — customer paying Gold ($14,286), gets Platinum spec',
    '20 SQ, up to 6/12, standard, ~50 km away (Bouctouche)',
    '1 pipe boot / penetration, 0 skylights, 0 chimneys, 0 valleys',
    'Pre-listing realtor scenario (Christian KW) — speed appreciated',
    'Day trip — no overnight',
    'v2.1 canonical rates locked'
  ],
  linked_estimate_id: IRVING_EST_ID
};

// ── INSERT WORK ───────────────────────────────────────────

async function upsertPaysheet(p, token) {
  // Check for existing by job_id (avoid dupes on rerun)
  const { data: existing } = await sb
    .from('paysheets').select('id, sub_acceptance_token')
    .eq('tenant_id', TENANT_ID).eq('job_id', p.job_id).maybeSingle();

  // Requires migration 035 applied — sub_acceptance_token + status + decision_at + decision_note columns
  const row = {
    tenant_id: TENANT_ID,
    job_id: p.job_id,
    address: p.address,
    customer_name: p.customer_name,
    subcontractor: p.subcontractor,
    status: p.status,
    shingle_product: p.shingle_product,
    job_type: p.job_type,
    labour_breakdown: p.labour_breakdown,
    add_ons: p.add_ons,
    surcharges: p.surcharges,
    subtotal: p.subtotal,
    hst: p.hst,
    total: p.total,
    scope_notes: p.scope_notes,
    linked_estimate_id: p.linked_estimate_id || null,
    scheduled_date: p.scheduled_date || null,
    sub_acceptance_token: existing?.sub_acceptance_token || token,
    sub_acceptance_status: 'pending',
    updated_at: new Date().toISOString()
  };

  if (existing) {
    const { data, error } = await sb.from('paysheets')
      .update(row).eq('id', existing.id).select('id, sub_acceptance_token').single();
    if (error) throw new Error(`update ${p.job_id}: ${error.message}`);
    return { id: data.id, sub_acceptance_token: data.sub_acceptance_token, was_existing: true };
  } else {
    const { data, error } = await sb.from('paysheets')
      .insert({ ...row, created_at: new Date().toISOString() })
      .select('id, sub_acceptance_token').single();
    if (error) throw new Error(`insert ${p.job_id}: ${error.message}`);
    return { id: data.id, sub_acceptance_token: data.sub_acceptance_token, was_existing: false };
  }
}

// (Blob-based acceptance state removed May 8 evening — moved to DB column via migration 035.)

async function upsertWorkOrder(p, paysheetId) {
  const { data: existing } = await sb
    .from('workorders').select('id')
    .eq('tenant_id', TENANT_ID)
    .eq('linked_paysheet_id', paysheetId).maybeSingle();

  const row = {
    tenant_id: TENANT_ID,
    linked_paysheet_id: paysheetId,
    linked_estimate_id: p.linked_estimate_id || null,
    customer_name: p.customer_name,
    address: p.address,
    job_type: 'full_replacement',
    sub_crew_lead: 'Atlantic Roofing (Ryan Robertson)',
    status: existing ? undefined : 'draft',
    package_tier: 'platinum',
    shingle_product: p.shingle_product,
    notes: p.scope_notes ? p.scope_notes.join('\n') : null,
    updated_at: new Date().toISOString()
  };

  if (existing) {
    const { data, error } = await sb.from('workorders')
      .update(row).eq('id', existing.id).select('id, wo_number').single();
    if (error) throw new Error(`update WO ${p.job_id}: ${error.message}`);
    return { id: data.id, wo_number: data.wo_number, was_existing: true };
  } else {
    const { data, error } = await sb.from('workorders')
      .insert({ ...row, created_at: new Date().toISOString() })
      .select('id, wo_number').single();
    if (error) throw new Error(`insert WO ${p.job_id}: ${error.message}`);
    return { id: data.id, wo_number: data.wo_number, was_existing: false };
  }
}

// ── MAIN ───────────────────────────────────────────────────

const jobs = [
  { name: 'Fairisle (Kyle Graham)', def: FAIRISLE },
  { name: 'Saint Marie (Shelagh Peach)', def: PEACH },
  { name: 'Irving (Christian KW)', def: IRVING }
];

const results = [];
for (const j of jobs) {
  console.log(`\n→ ${j.name} (${j.def.job_id})`);
  const candidateToken = newToken();
  const ps = await upsertPaysheet(j.def, candidateToken);
  console.log(`  paysheet ${ps.was_existing ? 'updated' : 'created'}: ${ps.id}`);
  console.log(`  acceptance token: ${ps.sub_acceptance_token}`);

  const wo = await upsertWorkOrder(j.def, ps.id);
  console.log(`  work order ${wo.was_existing ? 'updated' : 'created'}: WO-${wo.wo_number || '?'} ${wo.id}`);

  results.push({
    name: j.name,
    job_id: j.def.job_id,
    paysheet_id: ps.id,
    workorder_id: wo.id,
    wo_number: wo.wo_number,
    sub_acceptance_token: ps.sub_acceptance_token,
    accept_url: `https://ryujin-os.vercel.app/paysheet.html?token=${ps.sub_acceptance_token}`
  });
}

console.log('\n\n══════════════════════════════════════════════════════');
console.log('✅ ALL THREE JOBS PERSISTED');
console.log('══════════════════════════════════════════════════════\n');
for (const r of results) {
  console.log(`${r.name}`);
  console.log(`  Job ID:      ${r.job_id}`);
  console.log(`  Paysheet:    ${r.paysheet_id}`);
  console.log(`  WO #:        ${r.wo_number || '?'}`);
  console.log(`  Accept URL:  ${r.accept_url}`);
  console.log('');
}
