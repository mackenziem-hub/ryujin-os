// ─────────────────────────────────────────────────────────────────────────
// sync-estimates-to-workorders.mjs
//
// Closes the gap that makes the Production views "always out of date": a sold
// job (an accepted estimate) is invisible in Production until someone hand-keys
// a work order. The workorders table is the spine of every Production screen
// (overview, Job Folders, 3D hub panel), so any accepted estimate without a WO
// silently never appears.
//
// This finds every accepted estimate that has no work order and creates a
// DRAFT work order from the estimate's own data (customer, measurements, pitch,
// package, linked back via linked_estimate_id). Draft WOs show in Job Folders
// (with DQ chips flagging missing color/scope) but do not inflate the overview
// "in flight" KPI, which is correct: a sold-but-unscheduled job needs a WO and
// a schedule, and now it is visible instead of lost.
//
// Idempotent: an estimate already linked to a WO (linked_estimate_id) or whose
// customer first+last name already appears on a non-cancelled WO is skipped, so
// re-running never duplicates.
//
// Usage (token read from _brain/.env):
//   node scripts/sync-estimates-to-workorders.mjs            # dry-run, prints plan
//   node scripts/sync-estimates-to-workorders.mjs --commit   # creates the WOs
// ─────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';

const BASE = process.env.RYUJIN_BASE || 'https://ryujin-os.vercel.app';
const TENANT = 'plus-ultra';
const COMMIT = process.argv.includes('--commit');
const ALLOWED_TIERS = new Set(['gold', 'platinum', 'diamond', 'grand_manor']);

function readToken() {
  const envPath = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env';
  const txt = fs.readFileSync(envPath, 'utf8');
  const line = txt.split(/\r?\n/).find(l => /^RYUJIN_SERVICE_TOKEN\s*=/.test(l));
  if (!line) throw new Error('RYUJIN_SERVICE_TOKEN not found in _brain/.env');
  return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const TOKEN = readToken();
const authHeaders = { 'x-tenant-id': TENANT, 'Authorization': `Bearer ${TOKEN}` };

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: authHeaders });
  if (!r.ok) throw new Error(`GET ${path} -> HTTP ${r.status}`);
  return r.json();
}

// First + last significant name token, lowercased. "Gary & Karen Pardy" -> ["gary","pardy"]
function nameTokens(name) {
  const cleaned = String(name || '')
    .replace(/\(.*?\)/g, ' ')          // drop "(APHL)" etc
    .replace(/&.*?(?=\s\S+$)/, ' ')    // drop "& Karen" before the surname
    .replace(/[^a-zA-Z\s]/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (cleaned.length === 0) return [];
  return [cleaned[0], cleaned[cleaned.length - 1]];
}

function woMatchesEstimate(estName, woName) {
  const [eFirst, eLast] = nameTokens(estName);
  if (!eLast) return false;
  const w = String(woName || '').toLowerCase();
  return w.includes(eLast) && (eFirst ? w.includes(eFirst) : true);
}

function buildWoBody(e, woNumber) {
  const c = e.customer || {};
  const tier = ALLOWED_TIERS.has(e.selected_package) ? e.selected_package : null;
  const address = [c.address, c.city].filter(Boolean).join(', ') || null;
  const startDate = e.scheduled_at ? String(e.scheduled_at).slice(0, 10) : null;
  return {
    wo_number: woNumber,
    linked_estimate_id: e.id,
    customer_name: c.full_name || `Estimate #${e.estimate_number}`,
    address,
    phone: c.phone || null,
    status: 'draft',
    start_date: startDate,
    job_type: e.new_construction ? 'full_replacement' : 'full_replacement',
    package_tier: tier,
    total_sq: e.roof_area_sqft ? Math.round((e.roof_area_sqft / 100) * 100) / 100 : null,
    roof_pitch: e.roof_pitch || null,
    layers_to_remove: e.extra_layers != null ? Number(e.extra_layers) + 1 : null,
    pipes: e.pipes ?? null,
    special_notes: `Auto-created from accepted Estimate #${e.estimate_number} (sync). Confirm scope, color, and schedule before dispatch.`,
  };
}

async function main() {
  const [estRes, woRes] = await Promise.all([
    get('/api/estimates?limit=500'),
    get('/api/workorders?limit=500'),
  ]);
  const estimates = (estRes.estimates || estRes || []).filter(e => e.status === 'accepted');
  const workorders = woRes.workorders || woRes || [];

  const linkedEstIds = new Set(workorders.map(w => w.linked_estimate_id).filter(Boolean));
  let nextWoNumber = workorders.reduce((m, w) => Math.max(m, Number(w.wo_number) || 0), 0) + 1;

  const toCreate = [];
  for (const e of estimates) {
    if (linkedEstIds.has(e.id)) continue;                       // already linked
    const estName = e.customer?.full_name;
    const nameHit = workorders.some(w => woMatchesEstimate(estName, w.customer_name));
    if (nameHit) continue;                                      // legacy WO, unlinked but same person
    toCreate.push(e);
  }

  console.log(`Accepted estimates: ${estimates.length} | existing work orders: ${workorders.length}`);
  console.log(`Accepted estimates with NO work order: ${toCreate.length}`);
  console.log('');
  for (const e of toCreate) {
    const c = e.customer || {};
    console.log(`  Est #${e.estimate_number}  ${c.full_name || '(no name)'}  ${[c.address, c.city].filter(Boolean).join(', ')}  [${e.selected_package || 'no pkg'}]  $${e.final_accepted_total ?? '?'}`);
  }
  console.log('');

  if (!toCreate.length) { console.log('Nothing to sync. Production is in step with accepted estimates.'); return; }
  if (!COMMIT) { console.log('DRY RUN. Re-run with --commit to create these draft work orders.'); return; }

  let created = 0;
  for (const e of toCreate) {
    const body = buildWoBody(e, nextWoNumber);
    const r = await fetch(`${BASE}/api/workorders`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (r.status === 201) {
      created++; nextWoNumber++;
      console.log(`  + WO-${data.wo_number}  ${data.customer_name}  (draft, linked to Est #${e.estimate_number})`);
    } else {
      console.log(`  ! FAILED Est #${e.estimate_number}: HTTP ${r.status} ${data.error || ''}`);
    }
  }
  console.log(`\nCreated ${created} draft work order(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
