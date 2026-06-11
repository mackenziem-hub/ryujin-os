#!/usr/bin/env node
// One-shot: backfill workorders.subcontractor_id from the linked paysheet.
//
// Rule: for every non-cancelled work order where subcontractor_id IS NULL but
// linked_paysheet_id points at a paysheet that DOES carry a subcontractor_id,
// copy that sub onto the work order. The paysheet is the source of truth for
// who actually got paid for the job, so it is the correct backfill source.
//
// This runs entirely through the deployed Ryujin API (GET/PUT /api/workorders
// + GET /api/paysheets) - no direct DB access. The local Supabase service key
// is dead (memory reference_supabase_local_key_invalid); prod writes serialize
// through Terminal A, which is who should run this with --apply.
//
// Usage (from anywhere; reads token from _brain/.env):
//   node scripts/_oneshot/backfill_wo_subcontractor_from_paysheet_2026-06-11.mjs           # dry-run, prints plan
//   node scripts/_oneshot/backfill_wo_subcontractor_from_paysheet_2026-06-11.mjs --apply    # execute PUTs
//
// As of 2026-06-11 the only matching row is WO-20 (Adedoyinsola Egbuwoku,
// complete) -> sub Mackenzie Mazerolle (from linked paysheet 58edd6e1). WO-17
// is skipped because its own paysheet has no sub; WO-24/25/26 have no linked
// paysheet at all (active jobs, sub not yet entered - a data-entry gap, not a
// mechanical backfill). The rule is general so it also catches future rows.

import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const BASE = 'https://ryujin-os.vercel.app';

// Token: Bearer RYUJIN_SERVICE_TOKEN + x-tenant-id are BOTH required since the
// Jun 6 gate (memory reference_ryujin_service_token_brain_env).
const envText = readFileSync('C:/Users/macke/OneDrive/Desktop/Plus Ultra/_brain/.env', 'utf8');
const token = (envText.match(/^RYUJIN_SERVICE_TOKEN=(.*)$/m)?.[1] || '').trim().replace(/^"|"$/g, '');
if (!token) {
  console.error('RYUJIN_SERVICE_TOKEN missing from _brain/.env');
  process.exit(1);
}
const H = { Authorization: `Bearer ${token}`, 'x-tenant-id': 'plus-ultra', 'Content-Type': 'application/json' };

const getJson = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
};

console.log(`Mode: ${APPLY ? 'APPLY (will PUT)' : 'DRY-RUN (no writes)'}\n`);

const { workorders } = await getJson('/api/workorders?limit=200');
// List view already excludes cancelled. Keep only WOs missing a sub but linked
// to a paysheet.
const candidates = workorders.filter((w) => !w.subcontractor_id && w.linked_paysheet_id);

const plan = [];
for (const w of candidates) {
  const ps = await getJson(`/api/paysheets?id=${w.linked_paysheet_id}`);
  if (ps && ps.subcontractor_id) {
    plan.push({ woId: w.id, wo: w.wo_number, customer: w.customer_name, sub: ps.subcontractor_id, psId: ps.id });
  } else {
    console.log(`SKIP WO-${w.wo_number} (${w.customer_name}): linked paysheet ${w.linked_paysheet_id} has no subcontractor_id`);
  }
}

if (!plan.length) {
  console.log('\nNothing to backfill. No WO has a NULL sub with a paysheet that carries one.');
  process.exit(0);
}

console.log(`\n${plan.length} work order(s) to backfill:`);
for (const p of plan) console.log(`  WO-${p.wo} (${p.customer}) -> subcontractor_id ${p.sub} (from paysheet ${p.psId})`);

if (!APPLY) {
  console.log('\nDry-run only. Re-run with --apply to write.');
  process.exit(0);
}

console.log('');
for (const p of plan) {
  const r = await fetch(`${BASE}/api/workorders`, {
    method: 'PUT',
    headers: H,
    body: JSON.stringify({ id: p.woId, subcontractor_id: p.sub }),
  });
  const body = await r.json();
  if (r.ok && body.subcontractor_id === p.sub) {
    console.log(`OK   WO-${p.wo}: subcontractor_id now ${body.subcontractor_id}`);
  } else {
    console.log(`FAIL WO-${p.wo}: ${r.status} ${JSON.stringify(body)}`);
  }
}
console.log('\nDone.');
