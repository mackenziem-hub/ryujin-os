// Backfill proposal artifact for Shelagh Peach — 5360 NB-495, Sainte-Marie-de-Kent
//
// Why this exists:
//   Job was sold verbally with a $6,797.19 deposit cleared Apr 29. No estimate
//   record was ever created in Ryujin. With install Tue May 5, Mac wants a
//   locked proposal he can text to Shelagh as the canonical scope+price
//   document — confirms address, color, and the Free Platinum Upgrade structure.
//
// Pricing structure: Free Platinum Upgrade promo
//   - Customer pays Gold-tier price: $19,702 (CRM canonical, HST-incl)
//   - Customer receives Platinum-tier scope + warranty (Landmark Pro, Grace IWS,
//     Roof Runner synthetic, 20-yr Plus Ultra workmanship)
//
// Run: node scripts/_create_peach_proposal_2026-05-04.mjs
// Re-runnable: detects existing share_token and updates in place.
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

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const sb = createClient(url, key);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
if (!tenant) { console.error('plus-ultra tenant not found'); process.exit(1); }
const tenantId = tenant.id;

// ── Customer ──
let { data: customer } = await sb.from('customers').select('*')
  .eq('tenant_id', tenantId).ilike('full_name', '%shelagh%peach%').maybeSingle();
if (!customer) {
  const { data, error } = await sb.from('customers').insert({
    tenant_id: tenantId,
    full_name: 'Shelagh Peach',
    email: 'peachyshelagh@hotmail.com',
    phone: '(519) 654-2778',
    address: '5360 NB-495',  // install address; Mac to confirm 5360 vs 5380 with customer
    city: 'Sainte-Marie-de-Kent',
    province: 'NB'
  }).select('*').single();
  if (error) { console.error('customer insert', error); process.exit(1); }
  customer = data;
  console.log('Created customer', customer.id);
} else {
  console.log('Reusing customer', customer.id, customer.full_name);
}

// ── Pricing — Free Platinum Upgrade ──
// Customer pays Gold-tier price ($19,702 HST-incl per CRM canonical).
// Receives Platinum scope + warranty (Landmark Pro, Grace IWS, Roof Runner, 20yr workmanship).
// Display only the Platinum tier at the locked price — single-tier presentation
// avoids confusion about what was actually purchased.
const LOCKED_TOTAL = 19702;
const SQ = 30.2;
const calculatedPackages = {
  platinum: {
    total: LOCKED_TOTAL,
    persq: Math.round(LOCKED_TOTAL / SQ),
    summary: { sellingPrice: LOCKED_TOTAL, pricePerSQ: Math.round(LOCKED_TOTAL / SQ) },
    lineItems: []
  }
};

const SHARE = 'plus-ultra-peach-platinum';
const { data: existing } = await sb.from('estimates').select('id, share_token, estimate_number, locked_at')
  .eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();

const payload = {
  tenant_id: tenantId,
  customer_id: customer.id,
  proposal_mode: 'Roof Only',
  pricing_model: 'Day Trip',
  roof_area_sqft: 3020,           // 30.2 SQ true area, 6 sections
  roof_pitch: 'mixed',
  complexity: 'complex',
  eaves_lf: 160,
  rakes_lf: 230,
  ridges_lf: 100,
  valleys_lf: 30,
  hips_lf: 84,                    // 30x32 detached garage 9/12 — 4 hips ~21 LF
  pipes: 2,                       // 1 pipe boot + 1 hydro mast
  chimneys: 1,
  chimney_size: 'small',
  stories: 1,
  extra_layers: 0,                // confirm on tear-off; bills $40/SQ if found
  distance_km: 48.1,
  calculated_packages: calculatedPackages,
  selected_package: 'platinum',
  custom_prices: {},
  status: 'accepted',
  accepted_at: '2026-04-29T23:12:27Z',  // deposit clear timestamp
  proposal_status: 'Published',
  final_accepted_total: LOCKED_TOTAL,
  share_token: SHARE,
  tags: ['sales_owner:darcy', 'free_platinum_promo'],
  notes: [
    {
      text: 'FREE PLATINUM UPGRADE PROMO — pays Gold-tier price ($19,702 HST-incl), receives Platinum scope: CertainTeed Landmark Pro shingles, Grace ice & water shield, Roof Runner synthetic underlayment, 20-yr Plus Ultra workmanship warranty. Deposit $6,797.19 cleared 2026-04-29. Install scheduled Tue May 5 2026 (Day 1) ~1.5 days. Source: "5-Star Roof Plan" funnel. Sales owner: Darcy.',
      date: '2026-05-04',
      author: 'system-backfill'
    },
    {
      text: 'INSTALL ADDRESS NOTE: Files use 5360 NB-495; Stripe deposit invoice issued against 5380 Rte 495; GHL contact lists 5380 NB-490. Reverse-geocode of GPS 46.4451,-64.8891 confirms Route 495 (not 490) in Sainte-Marie-de-Kent. House number (5360 vs 5380) requires direct customer confirmation before crew arrival.',
      date: '2026-05-04',
      author: 'system-backfill'
    },
    {
      text: 'SCOPE — 6 sections / ~30.2 SQ true: (1) Main back upper+lower 5.7 SQ @ 3/12 [shingled as standard per Mac decision]; (2) Attached garage lower back 2.2 SQ @ 4/12; (3) Front main lower 2.4 SQ @ 5/12; (4) Detached garage 11.5 SQ @ 9/12; (5) Attached garage lower porch 3.8 SQ @ 10-12/12; (6) Front main dormer middle 4.6 SQ @ 10-12/12. Includes: full tear-off, Grace IWS at eaves+valleys, Roof Runner full deck, drip edge, ridge vent 100 LF, open metal valley 30 LF, 1 pipe boot, 1 hydro mast boot, 1 small brick chimney reflash. Excludes: bay window, gazebo, whirlybird, mansards (wrong-house items removed Apr 28). Decking replacement conditional on rot finding ($30/sheet, photo-then-replace).',
      date: '2026-05-04',
      author: 'system-backfill'
    }
  ]
};

if (existing) {
  console.log('Updating existing estimate', existing.id, '(was locked:', !!existing.locked_at, ')');
  // Unlock first so the update can write all fields
  await sb.from('estimates').update({ locked_at: null }).eq('id', existing.id);
  const { data, error } = await sb.from('estimates').update(payload).eq('id', existing.id).select('*').single();
  if (error) { console.error('estimate update', error); process.exit(1); }
  console.log('Updated estimate', data.id, 'estimate_number=#' + data.estimate_number);
} else {
  const { data, error } = await sb.from('estimates').insert(payload).select('*').single();
  if (error) { console.error('estimate insert', error); process.exit(1); }
  console.log('Created estimate', data.id, 'estimate_number=#' + data.estimate_number);
}

// ── Proposal row (custom_message is the headline framing for the share page) ──
const { data: estimate } = await sb.from('estimates').select('id').eq('share_token', SHARE).single();
const { data: existingProp } = await sb.from('proposals').select('id, version')
  .eq('tenant_id', tenantId).eq('estimate_id', estimate.id).order('version', { ascending: false }).maybeSingle();

const proposalPayload = {
  tenant_id: tenantId,
  estimate_id: estimate.id,
  headline: 'Your Free Platinum Upgrade — Locked In',
  tagline: 'Gold price. Platinum scope. Platinum warranty.',
  custom_message: 'Hi Shelagh — this is your locked confirmation. You paid the Gold-tier price of $19,702 (HST included) and we are installing the full Platinum tier: CertainTeed Landmark Pro shingles, Grace ice & water shield, Roof Runner synthetic underlayment, with our 20-year Plus Ultra workmanship warranty on top of CertainTeed\'s lifetime limited manufacturer warranty. Install starts Tuesday May 5. Materials drop Monday May 4 EOD. Any questions, text Mac directly: (506) 540-1052.',
  template: 'standard',
  show_financing: false,
  show_warranty_comparison: false,
  highlighted_package: 'platinum',
  published: true
};

if (existingProp) {
  const { error } = await sb.from('proposals').update(proposalPayload).eq('id', existingProp.id);
  if (error) { console.error('proposal update', error); process.exit(1); }
  console.log('Updated proposal v' + existingProp.version);
} else {
  const { data, error } = await sb.from('proposals').insert(proposalPayload).select('*').single();
  if (error) { console.error('proposal insert', error); process.exit(1); }
  console.log('Created proposal', data.id);
}

console.log('\n──────────────────────────────────────────────');
console.log('Share URL: https://ryujin-os.vercel.app/proposal-client.html?share=' + SHARE);
console.log('Internal:  https://ryujin-os.vercel.app/proposal-client.html?share=' + SHARE + '&internal=1');
console.log('──────────────────────────────────────────────');
