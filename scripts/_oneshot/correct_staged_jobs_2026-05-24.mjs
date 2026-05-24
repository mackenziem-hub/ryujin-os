// Corrections to the May 24 batch-stage after reading Obsidian deal files.
//
// Pre-correction state (what stage_in_house_jobs_2026-05-24.mjs wrote):
//   WO-18 Brian Dorken    | Wellington NB (street TBD)     | $16,200  | gold
//   WO-19 Shelley Hope    | 34 Wilbur St, Moncton          | $12,370  | gold
//
// Actual state per Obsidian + thread files:
//   - Brian signed PLATINUM with 3% cash discount = $17,945 all-in (not Gold $16,200)
//   - Brian's address is 1530 Route 475, Wellington NB
//   - Brian links to Ryujin estimate #39 (Obsidian deal file frontmatter)
//   - Shelley's actual address is 37 Wilbur St (Mac corrected May 19 — 34 was the
//     inspection booking typo)

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\\n/g, '').trim();
  }
}
const sb = createClient(
  (process.env.SUPABASE_URL || '').trim(),
  (process.env.SUPABASE_SERVICE_KEY || '').trim(),
);
const TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b';

const BRIAN_ADDRESS = '1530 Route 475, Wellington, NB';
const BRIAN_TOTAL = 17945;
const SHELLEY_ADDRESS = '37 Wilbur St, Moncton, NB';

console.log('--- Customer addresses ---');
{
  const { data: brian } = await sb.from('customers').select('id')
    .eq('tenant_id', TENANT_ID).ilike('full_name', 'Brian Dorken').maybeSingle();
  if (brian) {
    await sb.from('customers').update({ address: '1530 Route 475' }).eq('id', brian.id);
    console.log('  ✓ Brian Dorken address → 1530 Route 475');
  }
  const { data: shel } = await sb.from('customers').select('id')
    .eq('tenant_id', TENANT_ID).ilike('full_name', 'Shelley Hope').maybeSingle();
  if (shel) {
    await sb.from('customers').update({ address: '37 Wilbur St' }).eq('id', shel.id);
    console.log('  ✓ Shelley Hope address → 37 Wilbur St');
  }
}

console.log('\n--- Workorders ---');
{
  // Brian Dorken WO
  const { data: brianWo } = await sb.from('workorders').select('id, wo_number, linked_paysheet_id')
    .eq('tenant_id', TENANT_ID).eq('customer_name', 'Brian Dorken')
    .eq('start_date', '2026-05-25').maybeSingle();
  if (brianWo) {
    // Link to estimate #39
    const { data: est39 } = await sb.from('estimates').select('id, status')
      .eq('tenant_id', TENANT_ID).eq('estimate_number', 39).maybeSingle();
    const updates = {
      address: BRIAN_ADDRESS,
      package_tier: 'platinum',
      special_notes: 'GHL opp LNaCmukYK0ZpsPKHvOl7 — signed PLATINUM May 11 with 3% cash discount, $17,945 all-in (was $18,500 list). Estimate #39 Ryujin. Weather-pending Monday install.',
    };
    if (est39) updates.linked_estimate_id = est39.id;
    await sb.from('workorders').update(updates).eq('id', brianWo.id);
    console.log('  ✓ WO-' + brianWo.wo_number + ' Brian address + package_tier=platinum + estimate #39 linked');

    if (brianWo.linked_paysheet_id) {
      await sb.from('paysheets').update({
        address: BRIAN_ADDRESS,
        total: BRIAN_TOTAL,
        linked_estimate_id: est39 ? est39.id : null,
      }).eq('id', brianWo.linked_paysheet_id);
      console.log('  ✓ Brian paysheet total → $' + BRIAN_TOTAL + ' (was $16,200)');
    }
    if (est39 && est39.status !== 'accepted' && est39.status !== 'scheduled' && est39.status !== 'complete') {
      await sb.from('estimates').update({
        status: 'accepted',
        accepted_at: new Date('2026-05-11T00:00:00Z').toISOString(),  // signed May 11
      }).eq('id', est39.id);
      console.log('  ✓ Estimate #39 flipped to accepted (signed 2026-05-11)');
    }
  }

  // Shelley Hope WO
  const { data: shelWo } = await sb.from('workorders').select('id, wo_number, linked_paysheet_id')
    .eq('tenant_id', TENANT_ID).eq('customer_name', 'Shelley Hope')
    .eq('start_date', '2026-05-29').maybeSingle();
  if (shelWo) {
    await sb.from('workorders').update({ address: SHELLEY_ADDRESS }).eq('id', shelWo.id);
    console.log('  ✓ WO-' + shelWo.wo_number + ' Shelley address → 37 Wilbur St');
    if (shelWo.linked_paysheet_id) {
      await sb.from('paysheets').update({ address: SHELLEY_ADDRESS }).eq('id', shelWo.linked_paysheet_id);
      console.log('  ✓ Shelley paysheet address updated');
    }
  }
}

console.log('\n--- Verify ---');
const { data: live } = await sb.from('workorders')
  .select('wo_number, customer_name, address, start_date, package_tier')
  .eq('tenant_id', TENANT_ID)
  .in('customer_name', ['Brian Dorken', 'Shelley Hope', 'Adedoyinsola Egbuwoku', 'Roger Moreau'])
  .order('start_date', { ascending: true, nullsFirst: false });
for (const w of live || []) {
  console.log(`  WO-${w.wo_number}  ${w.customer_name.padEnd(24)}  ${(w.start_date || 'TBD').padEnd(12)}  ${(w.package_tier || '-').padEnd(10)}  ${w.address}`);
}
