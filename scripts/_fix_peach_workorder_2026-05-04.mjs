// Sync Ryujin workorders[wo_number=15] to canonical May 4 state.
// Same corrections previously applied to the markdown WO + Material List + Pay Sheet:
//   - color: TBD → Weathered Wood (locked May 4)
//   - start_date: May 2 → May 5; load day Thu May 1 → Mon May 4 EOD
//   - Kent Building Supplies block REMOVED (single Coastal PO)
//   - material qty corrections (IWS 4→6, ridge cap 4→6, drip edge 39→42, valley 3→4, ridge vent 5→6)
//   - material_list.total_estimated 8619 → 9319
//   - Sheila → Shelagh on checklist + scope refs
//   - revenue note added
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const sb = createClient((process.env.SUPABASE_URL || '').trim(), (process.env.SUPABASE_SERVICE_KEY || '').trim());
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();

// ── Pull current row ──
const { data: wo } = await sb.from('workorders').select('*')
  .eq('tenant_id', tenant.id).eq('wo_number', 15).single();
if (!wo) { console.error('WO #15 not found'); process.exit(1); }
console.log('Patching WO id', wo.id, 'wo_number', wo.wo_number);

// ── Build replacement special_notes (full block — easier than surgical edits) ──
const newSpecialNotes = `## LOCATION + DELIVERY

**Address:** 5360 NB-495, Sainte-Marie-de-Kent, NB (locked May 4 — verbal confirm)
**GPS:** 46.4451, -64.8891
**Distance from Riverview:** 48.1 km — Day Trip pricing model
**HARD TO FIND** — use GPS coordinates above for navigation, NOT just street address. Rural NB-495 area, address may not resolve cleanly in all map apps.

## CREW

- **Lead:** Ryan (Atlantic Roofing & Contracting)
- **Supervisor:** AJ (~1.5 days on-site, pre-site inspection Mon May 4 AM)
- **Load support:** Diego (Mon May 4 EOD load — Coastal delivery + crew loads)

## SCHEDULE (REV May 4 — Ryan pushed Mon→Tue start)

- **Mon May 4** — AJ pre-site inspection AM. Diego loads Coastal materials EOD.
- **Tue May 5** — Install Day 1 (Ryan + Atlantic crew). Mac on-site AM for QC.
- **Wed May 6** — Install Day 2 if needed (~1.5 day spec).

## EAGLEVIEW CAVEAT

EagleView unavailable for this property. Measurements taken from on-site visit + Google Earth. Quantity verification on tear-off day required. Final material counts confirmed by Diego/Ryan during load day.

## COLOR

**Landmark Pro — Weathered Wood** (locked May 4 — verbal confirm).

## SUPPLIER

**Coastal Drywall Supplies — single PO ~$9,319.** Kent Building Supplies removed per no-Kent hard rule (Apr 29). Fallback if any item unavailable: Castle Building Centres or Home Depot Moncton — never Kent.

## PRICING SOURCE

Rate Sheet v2.1 [A] sections (canonical/pre-agreed; inherited unchanged in v2.2). v2.2 [M] proposed lines NOT applied — v2.2 queued until Ryan bridge-off May 22+.
`;

const newAdditionalScope = wo.additional_scope
  .replace(/\(Max Def — color TBD by Apr 29\)/g, '(Max Def — Weathered Wood)')
  .replace(/\(color TBD by Apr 29\)/g, '(Weathered Wood)');

const newScopeItems = wo.scope_items.map(s => {
  if (typeof s.item === 'string' && s.item.includes('color TBD by Apr 29')) {
    return { ...s, item: s.item.replace('(color TBD by Apr 29)', '(Weathered Wood)') };
  }
  return s;
});

// ── Rebuild material_list with single Coastal PO + qty corrections ──
const oldML = wo.material_list || {};
const coastalItems = [
  { qty: 92, item: 'CertainTeed Landmark Pro shingles (Max Def) — Weathered Wood', unit: 'bundles', notes: 'Color locked May 4. Same spec for main + detached garage.', unit_cost: 55, line_total: 5060 },
  { qty: 3,  item: 'Starter Strip', unit: 'bundles', notes: 'Eaves + rake coverage. ~120 LF/bundle.', unit_cost: 72, line_total: 216 },
  { qty: 6,  item: 'Hip & Ridge Cap (CertainTeed Pro) — Weathered Wood', unit: 'bundles', notes: 'BUMPED 4→6 May 4: 100 LF ridge + ~84 LF detached garage hips + dormer hips.', unit_cost: 67, line_total: 402 },
  { qty: 4,  item: 'Roof Runner synthetic underlayment', unit: 'rolls', notes: '30 SQ + buffer. Platinum spec.', unit_cost: 167, line_total: 668 },
  { qty: 6,  item: 'Grace Ice & Water Shield', unit: 'rolls', notes: 'BUMPED 4→6 May 4: full coverage on 3/12 main back required to preserve Landmark Pro warranty.', unit_cost: 178, line_total: 1068 },
  { qty: 42, item: 'Drip Edge (10 ft pieces)', unit: 'pieces', notes: 'BUMPED 39→42 May 4: overlap allowance.', unit_cost: 17.99, line_total: 755.58 },
  { qty: 4,  item: 'Standard Metal Valley Sheets', unit: 'sheets', notes: 'BUMPED 3→4 May 4: waste allowance.', unit_cost: 32, line_total: 128 },
  { qty: 1,  item: 'Pipe Flashing 3 inch', unit: 'each', notes: 'For 1 pipe penetration.', unit_cost: 20, line_total: 20 },
  { qty: 6,  item: 'Ridge Vent rolls', unit: 'rolls', notes: 'BUMPED 5→6 May 4: waste allowance. 100 LF / 20 LF per roll.', unit_cost: 125, line_total: 750 },
  { qty: 4,  item: 'Coil Nails', unit: 'boxes', notes: '30 SQ install.', unit_cost: 57, line_total: 228 },
  { qty: 2,  item: 'Caulking', unit: 'tubes', notes: 'Final finish.', unit_cost: 12, line_total: 24 }
];
const coastalSubtotal = coastalItems.reduce((s, i) => s + i.line_total, 0);

const newMaterialList = {
  color_status: 'Weathered Wood (locked May 4 — verbal confirm)',
  delivery_notes: 'Two delivery points: main house at 5360 NB-495 + detached garage on same property. Coordinate with Mac on access. Delivery target Mon May 4 EOD. Single Coastal PO (Kent removed May 4).',
  total_estimated: Math.round(coastalSubtotal),
  supplier_summary: {
    'Coastal Drywall Supplies': {
      items: coastalItems,
      subtotal: Math.round(coastalSubtotal)
    }
  },
  delivery_target_date: '2026-05-04'
};

// ── Update checklist line that says "Sheila" ──
const newChecklist = wo.checklist.map(c => {
  if (typeof c.task === 'string' && c.task.includes('Sheila')) {
    return { ...c, task: c.task.replace('Sheila', 'Shelagh') };
  }
  return c;
});

const update = {
  shingle_color: 'Weathered Wood',
  start_date: '2026-05-05',
  estimated_duration_days: 2,
  support_crew: ['AJ (pre-site Mon May 4 AM + 1.5 days supervision)', 'Diego (load Mon May 4 EOD)'],
  total_sq: 30.2,
  special_notes: newSpecialNotes,
  additional_scope: newAdditionalScope,
  scope_items: newScopeItems,
  material_list: newMaterialList,
  checklist: newChecklist,
  notes: (wo.notes || '') + '\n\n[REV May 4]: Color locked Weathered Wood. Address locked 5360 NB-495. Kent removed (single Coastal PO ~$9,319). Material qtys corrected. Schedule shifted Tue May 5 install / Mon May 4 load+pre-site. Revenue $19,702 CRM canonical. Ryujin estimate #35 share=plus-ultra-peach-platinum.'
};

const { error } = await sb.from('workorders').update(update).eq('id', wo.id);
if (error) { console.error(error); process.exit(1); }

// Verify
const { data: after } = await sb.from('workorders').select('shingle_color, start_date, estimated_duration_days, support_crew, total_sq')
  .eq('id', wo.id).single();
console.log('AFTER:', after);
console.log('material_list.color_status:', (await sb.from('workorders').select('material_list').eq('id', wo.id).single()).data.material_list.color_status);
console.log('material_list.total_estimated:', (await sb.from('workorders').select('material_list').eq('id', wo.id).single()).data.material_list.total_estimated);
console.log('material_list suppliers:', Object.keys((await sb.from('workorders').select('material_list').eq('id', wo.id).single()).data.material_list.supplier_summary));
