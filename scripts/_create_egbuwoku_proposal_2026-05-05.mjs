// 75 Rue Rachel — Adedoyinsola Egbuwoku revisit (Darcy door-knock 2025)
// Honored Gold-tier price at $14,855 HST-incl (+$500 over June 2025 quote
// to absorb 11mo material cost movement). Net ~$1,265 after 35% S+M+O.
// Target Ryan negotiate -$500 separately for floor (12% Gold = $1,498 net).
// Shed (398sf @ 7/12) excluded per Mac call — main house only (1,444sf).
//
// Run: node scripts/_create_egbuwoku_proposal_2026-05-05.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { put } from '@vercel/blob';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
// Pull BLOB token from prod env if not local
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  const { execSync } = await import('node:child_process');
  execSync('vercel env pull .env.production.tmp --environment=production --yes', { stdio: 'pipe' });
  for (const line of fs.readFileSync('.env.production.tmp', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?$/);
    if (m && m[1] === 'BLOB_READ_WRITE_TOKEN') process.env.BLOB_READ_WRITE_TOKEN = m[2];
  }
  fs.unlinkSync('.env.production.tmp');
}

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
if (!url || !key) { console.error('Missing SUPABASE creds'); process.exit(1); }
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error('Missing BLOB token'); process.exit(1); }

const sb = createClient(url, key);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
const tenantId = tenant.id;

// ── Customer ──
const fullName = 'Adedoyinsola Egbuwoku';
let { data: customer } = await sb.from('customers').select('*')
  .eq('tenant_id', tenantId).ilike('full_name', '%egbuwoku%').maybeSingle();
if (!customer) {
  const { data, error } = await sb.from('customers').insert({
    tenant_id: tenantId,
    full_name: fullName,
    address: '75 Rue Rachel',
    city: 'Shédiac',
    province: 'NB',
    postal_code: 'E4P 9A3'
  }).select('*').single();
  if (error) { console.error('customer', error); process.exit(1); }
  customer = data;
  console.log('Created customer', customer.id);
} else {
  console.log('Reusing customer', customer.id);
}

// ── Pricing — Honored Gold @ $14,855 (single-tier presentation) ──
const LOCKED_TOTAL = 14855;
const SQ = 14.44; // EagleView 1,444 sqft / 100 = 14.44 SQ (main house, shed excluded)
const calculatedPackages = {
  gold: {
    total: LOCKED_TOTAL,
    persq: Math.round(LOCKED_TOTAL / SQ),
    summary: { sellingPrice: LOCKED_TOTAL, pricePerSQ: Math.round(LOCKED_TOTAL / SQ) },
    lineItems: []
  }
};

const SHARE = 'plus-ultra-egbuwoku-75rachel';
const { data: existing } = await sb.from('estimates').select('id, share_token, estimate_number, locked_at')
  .eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();

const nowIso = new Date().toISOString();
const payload = {
  tenant_id: tenantId,
  customer_id: customer.id,
  proposal_mode: 'Roof Only',
  pricing_model: 'Day Trip',
  roof_area_sqft: 1444,         // EagleView main house only, shed excluded
  roof_pitch: '6/12',           // predominant per EagleView (6/12 = 1188sf, 8/12 = 124sf, 10/12 = 30sf, 11/12 = 104sf)
  complexity: 'complex',        // 13 facets, multi-pitch, dormer + steep peak
  eaves_lf: 134,
  rakes_lf: 138,
  ridges_lf: 86,
  valleys_lf: 61,
  hips_lf: 40,
  pipes: 1,
  chimneys: 0,
  stories: 2,
  extra_layers: 0,
  distance_km: 28,
  calculated_packages: calculatedPackages,
  selected_package: 'gold',
  custom_prices: {},
  status: 'proposal_sent',
  proposal_status: 'Published',
  final_accepted_total: LOCKED_TOTAL,
  share_token: SHARE,
  locked_at: nowIso,
  tags: ['sales_owner:darcy', 'door_knock_2025', 'honored_legacy_pricing'],
  notes: [
    {
      text: 'HONORED LEGACY PRICING — Original quote June 19, 2025 (door-knocked by Darcy) was $14,355 HST-incl Gold. Customer revisiting May 2026, tight on money. Honored at $14,855 (+$500 to partially absorb 11-month material+labor cost movement). Real cash net ~$1,265 (10.1%) after 35% S+M+O — below 12% Gold floor. Target: negotiate $500 off Ryan separately to recover floor (~14.1% net). Shed (398sf 7/12, EagleView Structure 2) EXCLUDED per Mac call — main house only (1,444sf, 13 facets). Sales owner: Darcy.',
      date: '2026-05-05',
      author: 'system'
    },
    {
      text: 'EAGLEVIEW REPORT 65990322 (dated 6/20/2025) — Total roof 1,845sf / 13 facets / predominant 6/12. Two structures: (1) Main house 1,444sf / 10 facets — 6/12 (1187.9sf), 8/12 (123.8sf), 10/12 (30.2sf), 11/12 (103.6sf). (2) Detached shed 398sf / 3 facets / 7/12 — EXCLUDED. Lengths: ridges 86, hips 40, valleys 61, rakes 138, eaves 134.',
      date: '2026-05-05',
      author: 'system'
    },
    {
      text: 'PROFITABILITY MATH — At honored $14,855 HST-incl: pre-HST $12,917, hard cost $8,284 (Ryan+materials+disposal+mob+supervisor at 7/12 blend), gross $4,633 (35.9%), real cash net $1,265 after 35% S+M+O ($4,521). 12% Gold floor would require $14,002 gross-profit-side OR $1,498 real net — currently $233 short. Recovery path: Ryan -$500 negotiation. Watch invoice-time pushback on hydro mast vs B-vent + any unbundled drip/ridge cap line items.',
      date: '2026-05-05',
      author: 'system'
    }
  ]
};

let estimateId;
if (existing) {
  await sb.from('estimates').update({ locked_at: null }).eq('id', existing.id);
  const { data, error } = await sb.from('estimates').update(payload).eq('id', existing.id).select('*').single();
  if (error) { console.error('estimate update', error); process.exit(1); }
  estimateId = data.id;
  console.log('Updated estimate #' + data.estimate_number, estimateId);
} else {
  const { data, error } = await sb.from('estimates').insert(payload).select('*').single();
  if (error) { console.error('estimate insert', error); process.exit(1); }
  estimateId = data.id;
  console.log('Created estimate #' + data.estimate_number, estimateId);
}

// ── Photos: before + after (uploaded to Vercel Blob, linked via estimate_photos) ──
const photoSpecs = [
  { src: 'C:/Users/macke/Downloads/75 rachel before.jpg', caption: 'before', is_cover: false },
  { src: 'C:/Users/macke/Downloads/75 racher after.jpg',  caption: 'after',  is_cover: true  }
];

// Clear any existing before/after/cover photos for re-runnability
await sb.from('estimate_photos').delete().eq('estimate_id', estimateId).in('caption', ['before','after']);

for (const p of photoSpecs) {
  const buf = fs.readFileSync(p.src);
  const safeName = path.basename(p.src).replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobPath = `tenants/plus-ultra/estimates/${estimateId}/${Date.now()}-${safeName}`;
  const blob = await put(blobPath, buf, { access: 'public', contentType: 'image/jpeg', token: process.env.BLOB_READ_WRITE_TOKEN });
  if (p.is_cover) {
    await sb.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
  }
  const { error } = await sb.from('estimate_photos').insert({
    estimate_id: estimateId,
    url: blob.url,
    filename: path.basename(p.src),
    mime_type: 'image/jpeg',
    is_cover: p.is_cover,
    caption: p.caption
  });
  if (error) { console.error('photo insert', error); process.exit(1); }
  console.log('Uploaded', p.caption, '→', blob.url);
}

// ── Proposal row ──
const { data: existingProp } = await sb.from('proposals').select('id, version')
  .eq('tenant_id', tenantId).eq('estimate_id', estimateId).order('version', { ascending: false }).maybeSingle();

const proposalPayload = {
  tenant_id: tenantId,
  estimate_id: estimateId,
  headline: 'Your Roof — Locked at Last Year\'s Price',
  tagline: 'Honoring our June 2025 quote, with a small adjustment for material costs.',
  custom_message: 'Hi Adedoyinsola — thanks for circling back. We\'ve honored last year\'s pricing with a minor adjustment for material cost movement over the last 11 months. This quote covers the main house only (1,444 sq ft, 13 facets) per EagleView. The detached shed is excluded — happy to add it later if you want, but understood it\'s not the priority right now. Full CertainTeed Landmark scope, 15-year Sure Start warranty, 10-year Plus Ultra workmanship. Any questions, reach Darcy or Mac directly.',
  template: 'standard',
  show_financing: true,
  show_warranty_comparison: false,
  highlighted_package: 'gold',
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
