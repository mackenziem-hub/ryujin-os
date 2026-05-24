// Stage 4 signed jobs into Ryujin (Sun May 24, 2026)
//
// Context: Atlantic Roofing terminated May 18. No active subs.
// Mac is field-daily alongside Diego/AJ/Pavanjot until Sukhsahib qualifies
// (trial Wed May 27). Today Mac said "you do everything, I'm handling installs"
// and asked for batch staging of the customers the cockpit currently can't see:
//
//   1. Brian Dorken       · Mon May 25 · $16,200  · Wellington NB (street TBD)
//   2. Shelley Hope       · Fri May 29 · $12,370  · 34 Wilbur St, Moncton
//   3. Adedoyinsola Egbuwoku · Wed Jun 3 · $13,570 · 75 Rue Rachel, Shediac
//   4. Roger Moreau (shed) · TBD (post-color confirm) · $1,092.50 · 160 Riverbend
//
// What this does
//   * Upserts a 'Plus Ultra Crew' subcontractor row so paysheets have a valid FK
//     without rebooting the data model (May 18 reorg = in-house crew, not sub)
//   * Upserts a customer row per job (idempotent on full_name + tenant)
//   * Marks Egbuwoku PU-37 and Shelley #62 estimates as accepted (Ryujin had
//     them as proposal-published but never flipped on signature)
//   * Inserts a lightweight estimate for Roger Moreau (no existing Ryujin
//     estimate — verbal-quoted May 12 at $1,092.50 for shed-roof)
//   * Creates WO + paysheet per job, linked to the Plus Ultra Crew sub
//   * Roger's paysheet has scheduled status but start_date is left for Mac to
//     set after Monday color confirmation
//
// Run: node scripts/_oneshot/stage_in_house_jobs_2026-05-24.mjs
//
// Idempotent: safe to re-run. Customers, sub, and estimates are upserted by
// natural keys. WOs and paysheets are skipped if a row with the same
// customer_name + start_date already exists.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local. Vercel `env pull` writes values quoted with literal
// "\n" escape sequences inside, so after stripping quotes we also strip
// any trailing backslash-n that snuck in as 2 chars. Same for embedded
// newlines from multi-line secrets (none of ours are multi-line).
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/\\n/g, '').trim();
    }
  }
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Missing SUPABASE creds in .env.local'); process.exit(1); }

const sb = createClient(url, key);

const TENANT_SLUG = 'plus-ultra';
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

// ───────────────────────────────────────────────────────────────
// 1. Plus Ultra Crew subcontractor row
// ───────────────────────────────────────────────────────────────
console.log('\n[1/6] Plus Ultra Crew sub');
let { data: crew } = await sb.from('subcontractors')
  .select('*').eq('tenant_id', TENANT_ID).ilike('name', 'plus ultra crew').maybeSingle();
if (!crew) {
  const { data, error } = await sb.from('subcontractors').insert({
    tenant_id: TENANT_ID,
    name: 'Plus Ultra Crew',
    company: 'Plus Ultra Roofing',
    phone: '+15065401052',
    email: 'mackenzie.m@plusultraroofing.com',
    trade: 'roofing',
    active: true,
    notes: 'In-house crew: Mac + Diego + AJ + Pavanjot. Active May 18 2026 onward after Atlantic Roofing terminated. Placeholder while subcontracting paused; new external subs trialing.',
  }).select('*').single();
  if (error) { console.error('subcontractor insert failed', error); process.exit(1); }
  crew = data;
  console.log('  + created', crew.id);
} else {
  console.log('  = exists', crew.id);
}
const CREW_ID = crew.id;
const CREW_NAME = crew.name;

// ───────────────────────────────────────────────────────────────
// 2. Customers (upsert by full_name + tenant)
// ───────────────────────────────────────────────────────────────
console.log('\n[2/6] Customers');

const customerSpecs = [
  {
    full_name: 'Brian Dorken',
    email: 'penny.dorken@gmail.com',
    phone: '+15066088332',
    address: null, city: 'Wellington', province: 'NB', postal_code: null,
    source: 'GHL Operations Pipeline',
    ghl_contact_id: 'wyggLnTgtInMQwcLdOv6',
    tags: ['contract_signed_2026', 'in_house_crew'],
  },
  {
    full_name: 'Shelley Hope',
    email: null,
    phone: null,
    address: '34 Wilbur St', city: 'Moncton', province: 'NB', postal_code: null,
    source: "Darcy's Pipeline",
    ghl_contact_id: null,
    tags: ['contract_signed_2026', 'in_house_crew', 'package_gold'],
  },
  {
    full_name: 'Adedoyinsola Egbuwoku',
    email: 'doyine242@gmail.com',
    phone: '+15063122654',
    address: '75 Rue Rachel', city: 'Shediac', province: 'NB', postal_code: 'E4P 9A3',
    source: 'Darcy Door Knocking 2025',
    ghl_contact_id: null,
    tags: ['contract_signed_2026', 'in_house_crew', 'scope_corrected_main_house_only'],
  },
  {
    full_name: 'Roger Moreau',
    email: 'moreaubenner@gmail.com',
    phone: '+15063724441',
    address: '160 Riverbend Dr', city: 'Moncton', province: 'NB', postal_code: null,
    source: 'GHL Voice AI 10 Tips PDF',
    ghl_contact_id: 'EjoIGbMxk6E6qwHmWbZM',
    tags: ['contract_signed_verbal_2026-05-12', 'in_house_crew', 'shed_roof'],
  },
];

const customerIds = {};
for (const spec of customerSpecs) {
  let { data: cu } = await sb.from('customers')
    .select('*').eq('tenant_id', TENANT_ID).ilike('full_name', spec.full_name).maybeSingle();
  if (cu) {
    // Refresh tags + ghl_contact_id if missing
    const updates = {};
    if (spec.ghl_contact_id && !cu.ghl_contact_id) updates.ghl_contact_id = spec.ghl_contact_id;
    const tagSet = new Set([...(cu.tags || []), ...spec.tags]);
    if (tagSet.size !== (cu.tags || []).length) updates.tags = [...tagSet];
    if (Object.keys(updates).length) {
      await sb.from('customers').update(updates).eq('id', cu.id);
      console.log('  ~ updated', spec.full_name, Object.keys(updates).join(','));
    } else {
      console.log('  = exists', spec.full_name);
    }
    customerIds[spec.full_name] = cu.id;
  } else {
    const { data, error } = await sb.from('customers').insert({
      tenant_id: TENANT_ID, ...spec,
    }).select('id').single();
    if (error) { console.error('customer insert failed', spec.full_name, error); process.exit(1); }
    customerIds[spec.full_name] = data.id;
    console.log('  + created', spec.full_name);
  }
}

// ───────────────────────────────────────────────────────────────
// 3. Mark Egbuwoku PU-37 + Shelley #62 estimates as accepted
// ───────────────────────────────────────────────────────────────
console.log('\n[3/6] Estimates accepted');

const SIGNED_AT = new Date().toISOString();
const ACCEPT_TAG = 'accepted_2026-05-24';

// Find by estimate_number first (more reliable than share_token which
// can drift). Falls back to share_token if the number lookup misses.
const estimateAccepts = [
  { num: 37, share_token: 'plus-ultra-egbuwoku-75rachel', label: 'Egbuwoku PU-37' },
  { num: 62, share_token: '9034ed69-838d-49cc-9889-92832f63ebf4', label: 'Shelley Hope #62' },
];

const estimateIds = {};
for (const { num, share_token, label } of estimateAccepts) {
  let { data: est } = await sb.from('estimates')
    .select('id, estimate_number, tags, customer_id, status, accepted_at, share_token')
    .eq('tenant_id', TENANT_ID)
    .eq('estimate_number', num)
    .maybeSingle();
  if (!est && share_token) {
    const r2 = await sb.from('estimates')
      .select('id, estimate_number, tags, customer_id, status, accepted_at, share_token')
      .eq('share_token', share_token).maybeSingle();
    est = r2.data;
  }
  if (!est) { console.log('  ! not found', label); continue; }
  estimateIds[label] = est.id;
  const newTags = Array.from(new Set([...(est.tags || []), ACCEPT_TAG]));
  const updates = { tags: newTags };
  if (!est.accepted_at) updates.accepted_at = SIGNED_AT;
  if (est.status !== 'accepted' && est.status !== 'scheduled' && est.status !== 'complete') {
    updates.status = 'accepted';
  }
  await sb.from('estimates').update(updates).eq('id', est.id);
  console.log('  ✓', label, '(was status=' + est.status + ') now accepted');
}

// ───────────────────────────────────────────────────────────────
// 4. Roger Moreau lightweight estimate
// ───────────────────────────────────────────────────────────────
console.log('\n[4/6] Roger Moreau estimate');

const ROGER_SHARE = 'plus-ultra-moreau-160riverbend-shed';
let { data: rogerEst } = await sb.from('estimates')
  .select('id, estimate_number').eq('share_token', ROGER_SHARE).maybeSingle();
if (!rogerEst) {
  const { data, error } = await sb.from('estimates').insert({
    tenant_id: TENANT_ID,
    customer_id: customerIds['Roger Moreau'],
    share_token: ROGER_SHARE,
    status: 'accepted',
    accepted_at: SIGNED_AT,
    selected_package: 'gold',
    calculated_packages: { gold: { total: 1092.50, totalWithTax: 1092.50, persq: null, customPrice: true, lineItems: [] } },
    tags: ['shed_roof', 'verbal_quote_2026-05-12', ACCEPT_TAG, 'in_house_crew'],
    notes: 'Lightweight estimate created May 24 to stage WO + paysheet. Verbal-quoted May 12 at $1,092.50 for shed-roof. Color confirmation Mon May 25 before install scheduling.',
  }).select('id, estimate_number').single();
  if (error) { console.error('roger estimate insert failed', error); process.exit(1); }
  rogerEst = data;
  console.log('  + created PU-' + rogerEst.estimate_number);
} else {
  console.log('  = exists PU-' + rogerEst.estimate_number);
}
estimateIds['Roger Moreau shed'] = rogerEst.id;

// ───────────────────────────────────────────────────────────────
// 5. WO + paysheet per job (4 total)
// ───────────────────────────────────────────────────────────────
console.log('\n[5/6] Work orders + paysheets');

const jobs = [
  {
    customer_name: 'Brian Dorken',
    address: 'Wellington, NB (street address pending — confirm with customer)',
    phone: '+15066088332',
    email: 'penny.dorken@gmail.com',
    start_date: '2026-05-25',
    estimated_duration_days: 1,
    job_id: 'PU-2026-DORK',
    total: 16200.00,
    package_tier: 'gold',
    estimate_id: null,
    customer_id: customerIds['Brian Dorken'],
    special_notes: 'GHL opp LNaCmukYK0ZpsPKHvOl7 — $16,200 Operations Pipeline / Contract Signed via Darcy. Weather-pending Monday install — rain forecast Sat night, confirm Sun PM. Street address still needed (Wellington NB only on GHL).',
  },
  {
    customer_name: 'Shelley Hope',
    address: '34 Wilbur St, Moncton, NB',
    phone: null,
    email: null,
    start_date: '2026-05-29',
    estimated_duration_days: 3,
    job_id: 'PU-2026-HOPE',
    total: 12370.00,
    package_tier: 'gold',
    estimate_id: estimateIds['Shelley Hope #62'],
    customer_id: customerIds['Shelley Hope'],
    special_notes: 'Estimate #62, share 9034ed69. $12,370 Gold via Darcy. Originally scheduled Tue May 26, pushed to Fri May 29 per Mac (24 May). 3 work day estimate.',
  },
  {
    customer_name: 'Adedoyinsola Egbuwoku',
    address: '75 Rue Rachel, Shediac, NB E4P 9A3',
    phone: '+15063122654',
    email: 'doyine242@gmail.com',
    start_date: '2026-06-03',
    estimated_duration_days: 1,
    job_id: 'PU-2026-EGBU',
    total: 13570.00,
    package_tier: 'gold',
    estimate_id: estimateIds['Egbuwoku PU-37'],
    customer_id: customerIds['Adedoyinsola Egbuwoku'],
    special_notes: 'Estimate PU-37, share plus-ultra-egbuwoku-75rachel. Gold $13,570 scope-corrected to main-house-only (4 SQ, 7/12 pitch, 1444sf). 10-yr warranty negotiated May 9. Sales owner Darcy. Mac confirmed signed May 24. Start day after Shelley wraps.',
  },
  {
    customer_name: 'Roger Moreau',
    address: '160 Riverbend Dr, Moncton, NB',
    phone: '+15063724441',
    email: 'moreaubenner@gmail.com',
    start_date: null,                          // post-color-confirm
    estimated_duration_days: 1,
    job_id: 'PU-2026-MORE',
    total: 1092.50,
    package_tier: 'gold',
    estimate_id: estimateIds['Roger Moreau shed'],
    customer_id: customerIds['Roger Moreau'],
    special_notes: 'Shed-roof. Verbal quote May 12 at $1,092.50. Color samples dropoff Mon May 25 at Riverview shed (Mac personally). Install date TBD after color confirmation. GHL opp creation outstanding (tracked separately).',
  },
];

for (const j of jobs) {
  // Skip if a WO already exists for this customer + start_date combo
  let woQuery = sb.from('workorders')
    .select('id, wo_number, start_date')
    .eq('tenant_id', TENANT_ID)
    .eq('customer_name', j.customer_name);
  if (j.start_date) woQuery = woQuery.eq('start_date', j.start_date);
  const { data: existingWos } = await woQuery;
  if (existingWos && existingWos.length) {
    console.log('  = WO exists for', j.customer_name, '(WO-' + existingWos[0].wo_number + ')');
    continue;
  }

  // Create paysheet first so we have the id to link from WO
  const { data: ps, error: psErr } = await sb.from('paysheets').insert({
    tenant_id: TENANT_ID,
    job_id: j.job_id,
    address: j.address,
    customer_name: j.customer_name,
    subcontractor: CREW_NAME,
    subcontractor_id: CREW_ID,
    status: 'scheduled',
    total: j.total,
    linked_estimate_id: j.estimate_id,
    scope_notes: [j.special_notes],
  }).select('id').single();
  if (psErr) { console.error('paysheet insert failed', j.customer_name, psErr); process.exit(1); }

  const { data: wo, error: woErr } = await sb.from('workorders').insert({
    tenant_id: TENANT_ID,
    linked_estimate_id: j.estimate_id,
    linked_paysheet_id: ps.id,
    customer_name: j.customer_name,
    address: j.address,
    phone: j.phone,
    email: j.email,
    special_notes: j.special_notes,
    start_date: j.start_date,
    estimated_duration_days: j.estimated_duration_days,
    sub_crew_lead: CREW_NAME,
    subcontractor_id: CREW_ID,
    package_tier: j.package_tier,
    job_type: 'full_replacement',
  }).select('id, wo_number').single();
  if (woErr) { console.error('workorder insert failed', j.customer_name, woErr); process.exit(1); }

  // Link the paysheet back to the WO (workorder.linked_paysheet_id is set
  // already, but the paysheet usually carries job_id text; we leave it as
  // the natural key. The estimate link is enough for joining.)
  console.log('  + WO-' + wo.wo_number + ' + paysheet for', j.customer_name, j.start_date || '(unscheduled)');
}

// ───────────────────────────────────────────────────────────────
// 6. Summary
// ───────────────────────────────────────────────────────────────
console.log('\n[6/6] Verify');

const { data: live } = await sb.from('workorders')
  .select('wo_number, customer_name, address, start_date, package_tier, sub_crew_lead')
  .eq('tenant_id', TENANT_ID)
  .in('customer_name', ['Brian Dorken', 'Shelley Hope', 'Adedoyinsola Egbuwoku', 'Roger Moreau'])
  .order('start_date', { ascending: true, nullsFirst: false });

console.log('\n──── STAGED ────');
for (const w of live || []) {
  console.log(`  WO-${w.wo_number}  ${w.customer_name.padEnd(24)}  ${(w.start_date || 'TBD').padEnd(12)}  ${w.address}`);
}

console.log('\nDone. Next: open /production-jobs.html in a signed-in browser and confirm 4 cards visible.');
