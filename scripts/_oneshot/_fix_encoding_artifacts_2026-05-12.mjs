#!/usr/bin/env node
// One-shot: replace U+FFFD (�) replacement chars in tickets + related
// tables with proper em-dashes. Came from the Action Board migration —
// titles like "178 Summerhill Drive � Reroof · CREW Checklist".
//
// Pass --apply to actually write. Default is dry-run (lists matches only).

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envText = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const REPLACEMENT = '�';   // U+FFFD — the � character
const TARGET = '—';             // em-dash (the most common original)

// Tables + text columns that came through the migration. service_tickets is
// included defensively (in case any rows ever landed there); customers and
// projects too because the migration touched their addresses/names.
// notes is jsonb on tickets/estimates — handle separately below.
const TARGETS = [
  { table: 'tickets',          cols: ['title', 'description'] },
  { table: 'service_tickets',  cols: ['title', 'description'] },
  { table: 'customers',        cols: ['full_name', 'address', 'city'] },
  { table: 'projects',         cols: ['name', 'address'] },
];

let totalRows = 0, totalCols = 0;

for (const { table, cols } of TARGETS) {
  // Pull every row that contains the replacement char in any of the target
  // columns. We `or` the ilike filters so we don't need separate roundtrips.
  const filter = cols.map(c => `${c}.ilike.%${REPLACEMENT}%`).join(',');
  const { data, error } = await sb.from(table).select(`id, ${cols.join(', ')}`).or(filter);

  if (error) {
    console.log(`[${table}] skipped — ${error.message}`);
    continue;
  }
  if (!data?.length) {
    console.log(`[${table}] clean (0 rows)`);
    continue;
  }
  console.log(`\n[${table}] ${data.length} row(s) with artifacts:`);
  totalRows += data.length;

  for (const row of data) {
    const update = {};
    for (const c of cols) {
      const v = row[c];
      if (typeof v === 'string' && v.includes(REPLACEMENT)) {
        const fixed = v.replace(/�/g, TARGET);
        update[c] = fixed;
        totalCols++;
        console.log(`  · ${table}.${row.id.slice(0, 8)} ${c}:`);
        console.log(`      before: ${v.slice(0, 100)}${v.length > 100 ? '…' : ''}`);
        console.log(`      after:  ${fixed.slice(0, 100)}${fixed.length > 100 ? '…' : ''}`);
      }
    }
    if (APPLY && Object.keys(update).length) {
      const { error: uerr } = await sb.from(table).update(update).eq('id', row.id);
      if (uerr) console.log(`      !! update failed: ${uerr.message}`);
    }
  }
}

// jsonb fields (tickets.notes, tickets.tags, estimates.notes) — pull every
// row and scan the JSON for the replacement char, then walk the structure
// to rewrite affected leaves. Slower than ilike but jsonb-safe.
async function scanJsonb(table, cols){
  const { data, error } = await sb.from(table).select(['id', ...cols].join(', '));
  if (error) { console.log(`[${table}] jsonb scan err — ${error.message}`); return 0; }
  let n = 0;
  for (const row of (data || [])) {
    const update = {};
    for (const c of cols) {
      const v = row[c];
      if (v == null) continue;
      const raw = JSON.stringify(v);
      if (!raw.includes(REPLACEMENT)) continue;
      const fixed = JSON.parse(raw.replace(/�/g, TARGET));
      update[c] = fixed;
      n++;
      console.log(`  · ${table}.${row.id.slice(0,8)} ${c}: ${raw.slice(0,120)}${raw.length>120?'…':''}`);
      console.log(`      →           ${JSON.stringify(fixed).slice(0,120)}`);
    }
    if (APPLY && Object.keys(update).length) {
      const { error: uerr } = await sb.from(table).update(update).eq('id', row.id);
      if (uerr) console.log(`      !! update failed: ${uerr.message}`);
    }
  }
  if (n) console.log(`\n[${table} jsonb] ${n} field(s) with artifacts`);
  return n;
}

const jsonbFixes = (await scanJsonb('tickets', ['tags', 'notes', 'checklist_state']))
                 + (await scanJsonb('estimates', ['notes']));

console.log(`\n══════════════════════════════════════`);
console.log(`Mode: ${APPLY ? 'APPLIED' : 'DRY RUN'}`);
console.log(`Text rows: ${totalRows} (${totalCols} columns)`);
console.log(`Jsonb fixes: ${jsonbFixes}`);
console.log(`══════════════════════════════════════`);
if (!APPLY) console.log(`\nRun with --apply to write changes.`);
