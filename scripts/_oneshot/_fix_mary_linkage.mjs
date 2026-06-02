// Reconcile Mary's split customer rows + link project <-> estimate.
//
// Before: two Mary rows (c342cb14 has PU-78 estimate but no GHL link;
// e5732e2e has GHL link but no estimate). The project was created against
// e5732e2e. Job.html filters estimates by project.customer.id, so the
// upload button never renders because PU-78 isn't visible.
//
// After: project points at c342cb14 (canonical Mary, linked to PU-78);
// GHL contact id moves over; project.estimate_id = PU-78; orphan e5732e2e
// gets deleted.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]]) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
function clean(v) { return String(v || '').replace(/\\n/g, '').replace(/\n/g, '').trim(); }
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY));

const TENANT_ID  = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const CANONICAL  = 'c342cb14-2786-4013-b515-0f19f63ca1b9'; // PU-78's customer
const ORPHAN     = 'e5732e2e-8227-40ee-966d-b412bfa03ffd'; // project's current customer
const PROJECT_ID = 'e080e448-8f03-4487-b149-34f69cca0da4';
const ESTIMATE_ID = '179cacdc-a4cd-48c5-91ba-b65930c7fd32';

// 1. Copy GHL contact id from orphan to canonical (canonical doesn't have one)
const { data: orphanRow } = await sb.from('customers').select('ghl_contact_id, full_name').eq('id', ORPHAN).single();
console.log('orphan ghl_contact_id to migrate:', orphanRow?.ghl_contact_id);

if (orphanRow?.ghl_contact_id) {
  const { error: e1 } = await sb.from('customers')
    .update({ ghl_contact_id: orphanRow.ghl_contact_id })
    .eq('id', CANONICAL);
  if (e1) { console.error('canonical update failed:', e1); process.exit(1); }
  console.log('OK ghl_contact_id migrated to canonical');
}

// 2. Repoint project to canonical customer + link estimate
const { error: e2 } = await sb.from('projects')
  .update({ customer_id: CANONICAL, estimate_id: ESTIMATE_ID })
  .eq('id', PROJECT_ID);
if (e2) { console.error('project update failed:', e2); process.exit(1); }
console.log('OK project repointed to canonical customer + linked to PU-78');

// 3. Check if anything else points at the orphan before deleting
const { count: refs } = await sb.from('estimates').select('id', { count: 'exact', head: true }).eq('customer_id', ORPHAN);
const { count: projRefs } = await sb.from('projects').select('id', { count: 'exact', head: true }).eq('customer_id', ORPHAN);
console.log('orphan references remaining: estimates=' + (refs || 0) + ', projects=' + (projRefs || 0));

if ((refs || 0) === 0 && (projRefs || 0) === 0) {
  const { error: e3 } = await sb.from('customers').delete().eq('id', ORPHAN);
  if (e3) console.error('orphan delete failed (non-fatal):', e3.message);
  else console.log('OK orphan customer row deleted');
} else {
  console.log('orphan kept (other rows still reference it)');
}

console.log('\nReload Mary now:');
console.log('https://ryujin-os.vercel.app/job.html?id=' + PROJECT_ID);
console.log('The UPLOAD PHOTOS button should appear in the PHOTOS & VIDEO section.');
