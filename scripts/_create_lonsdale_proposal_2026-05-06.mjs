// 200 Lonsdale Dr — Concepcion Omega (semi-detached duplex right side)
// Mac dictated measurements while Ryujin chat was 500-ing.
// 42x25 + ~50sf extra coverage on right back ≈ 1100 sqft 2D
// 6/12 pitch, in-town (~8km), medium complexity (semi-detached single valley)
//
// Run: node scripts/_create_lonsdale_proposal_2026-05-06.mjs
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
const sb = createClient(url, key);

const { data: tenant } = await sb.from('tenants').select('id, slug').eq('slug', 'plus-ultra').single();
const tenantId = tenant.id;

// ── Customer ──
const fullName = 'Concepcion Omega';
let { data: customer } = await sb.from('customers').select('*')
  .eq('tenant_id', tenantId).ilike('full_name', '%omega%').maybeSingle();
if (!customer) {
  const { data, error } = await sb.from('customers').insert({
    tenant_id: tenantId,
    full_name: fullName,
    address: '200 Lonsdale Dr',
    city: 'Riverview',
    province: 'NB'
  }).select('*').single();
  if (error) { console.error('customer', error); process.exit(1); }
  customer = data;
  console.log('Created customer', customer.id);
} else {
  console.log('Reusing customer', customer.id);
}

// ── Pricing — CHRISTIAN RELATIONSHIP RATE — Gold reduced to $7,500 to save deal ──
// Christian (realtor) miscommunicated to client based on a $6K hearsay number.
// Mac choosing to honor close to that number to preserve the realtor pipeline.
// Gold: $10,178 retail → $7,500 (saves $2,678, ~26% off retail, well below floor)
// Platinum + Diamond visible but not the focus. Locking on Gold $7,500.
const calculatedPackages = {
  gold: { total: 6522, totalWithTax: 7500, persq: 502, summary: { sellingPrice: 6522, pricePerSQ: 502, totalWithTax: 7500 }, lineItems: [], customPrice: true },
  platinum: { total: 9696, totalWithTax: 11150, persq: 745, summary: { sellingPrice: 9696, pricePerSQ: 745, totalWithTax: 11150 }, lineItems: [], customPrice: true },
  diamond: { total: 15050, totalWithTax: 17308, persq: 1158, summary: { sellingPrice: 15050, pricePerSQ: 1158, totalWithTax: 17308 }, lineItems: [] }
};

const SHARE = 'plus-ultra-omega-200lonsdale';
const { data: existing } = await sb.from('estimates').select('id, share_token, locked_at')
  .eq('tenant_id', tenantId).eq('share_token', SHARE).maybeSingle();

const payload = {
  tenant_id: tenantId,
  customer_id: customer.id,
  proposal_mode: 'Roof Only',
  pricing_model: 'Local',
  roof_area_sqft: 1100,         // 42x25 = 1050 + ~50sf right-back extra coverage
  roof_pitch: '6/12',
  complexity: 'medium',
  eaves_lf: 50,
  rakes_lf: 80,
  ridges_lf: 45,
  valleys_lf: 30,
  hips_lf: 0,
  pipes: 1,
  chimneys: 0,
  stories: 2,
  extra_layers: 0,
  distance_km: 8,
  calculated_packages: calculatedPackages,
  selected_package: 'gold',
  custom_prices: { gold: 6522, platinum: 9696 },
  status: 'proposal_sent',
  proposal_status: 'Published',
  final_accepted_total: 7500,
  locked_at: new Date().toISOString(),
  share_token: SHARE,
  tags: ['sales_owner:mackenzie', 'semi_detached', 'duplex_right_side', 'realtor_repeat_rate', 'christian_kw'],
  notes: [
    {
      text: 'CHRISTIAN RELATIONSHIP RATE — locked at Gold $7,500 HST-incl. Christian (realtor, 3rd-4th repeat job) miscommunicated to client based on a $6K hearsay number. Mac choosing to honor close to it to preserve the realtor pipeline. Gold reduced from retail $10,178 → $7,500 (saves $2,678, ~26% off retail). Platinum + Diamond visible at reduced realtor rates but not the focus. NOT a published rate — case-by-case for Christian only.',
      date: '2026-05-06',
      author: 'system'
    },
    {
      text: 'PROFITABILITY MATH at Gold $7,500 HST-incl, full Plus Ultra spec: pre-HST $6,522, hard cost baseline $5,673. With Ryan -$500 + skip supervisor day = hard cost $4,903. Gross profit $1,619 (24.8%). After 35% S+M+O loaded ($2,283), loaded-P&L real cash net = -$664. BUT on a MARGINAL CASH BASIS (S+M+O is sunk overhead happening regardless), this job contributes +$2,597 toward overhead absorption. Mac choosing to do this on relationship grounds — Christian sends repeat volume, $664 loaded-loss is acceptable cost of preserving the pipeline. Two operational backstops still required to keep marginal cash positive: (1) Ryan -$500 sub negotiation, (2) skip dedicated supervisor day on small duplex side (AJ + Diego self-supervise).',
      date: '2026-05-06',
      author: 'system'
    },
    {
      text: 'SEMI-DETACHED DUPLEX, RIGHT SIDE ONLY. Footprint 42x25 (1,050 sf) + ~50 sf extra coverage on right side of back for proper duplex termination = ~1,100 sf 2D. 6/12 pitch, in-town ~8km from Riverview base. Medium complexity (single valley typical of semi-detached). Lengths: 50 LF eaves, 80 LF rakes, 45 LF ridge with ridge vent, 30 LF valley, 1 pipe boot. No chimney.',
      date: '2026-05-06',
      author: 'system'
    },
    {
      text: 'DUPLEX PROTOCOL: confirm with neighbor side before install that there is no shared scope or boundary issue. Ridge cap detail at side wall against neighbor side must be addressed in work order. Front rake termination clean to neighbor side.',
      date: '2026-05-06',
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

// ── Photos: cover + before + after from job folder ──
const jobFolder = 'C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/200 Lonsdale dr';
const photoSpecs = [
  { src: `${jobFolder}/cover photo.png`, caption: 'cover',  is_cover: true,  mime: 'image/png' },
  { src: `${jobFolder}/before photo.png`, caption: 'before', is_cover: false, mime: 'image/png' },
  { src: `${jobFolder}/after photo.png`,  caption: 'after',  is_cover: false, mime: 'image/png' }
];

await sb.from('estimate_photos').delete().eq('estimate_id', estimateId).in('caption', ['cover','before','after']);

for (const p of photoSpecs) {
  if (!fs.existsSync(p.src)) { console.log('Skip missing', p.src); continue; }
  const buf = fs.readFileSync(p.src);
  const safeName = path.basename(p.src).replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobPath = `tenants/plus-ultra/estimates/${estimateId}/${Date.now()}-${safeName}`;
  const blob = await put(blobPath, buf, { access: 'public', contentType: p.mime, token: process.env.BLOB_READ_WRITE_TOKEN });
  if (p.is_cover) await sb.from('estimate_photos').update({ is_cover: false }).eq('estimate_id', estimateId);
  const { error } = await sb.from('estimate_photos').insert({
    estimate_id: estimateId,
    url: blob.url,
    filename: path.basename(p.src),
    mime_type: p.mime,
    is_cover: p.is_cover,
    caption: p.caption
  });
  if (error) { console.error('photo insert', error); process.exit(1); }
  console.log('Uploaded', p.caption, '→', blob.url.split('/').slice(-1)[0]);
}

// ── Proposal row ──
const { data: existingProp } = await sb.from('proposals').select('id, version')
  .eq('tenant_id', tenantId).eq('estimate_id', estimateId).order('version', { ascending: false }).maybeSingle();

const proposalPayload = {
  tenant_id: tenantId,
  estimate_id: estimateId,
  headline: 'Your Roof, Built Right',
  tagline: 'Three options. Honest pricing. CertainTeed-certified install.',
  custom_message: 'Hi Christian, here is the proposal for 200 Lonsdale Dr (right side of the duplex). Locked at Gold $7,500 HST included as we discussed, full Plus Ultra spec — full tear-off, CertainTeed Landmark, Roof Runner synthetic, ice and water shield, drip edge, ridge vent, 10-year Plus Ultra workmanship on top of the manufacturer warranty. Drone inspection and photo documentation included. Platinum and Diamond shown if Concepcion ever wants to upgrade. Let me know when she is ready to schedule.',
  template: 'standard',
  show_financing: true,
  show_warranty_comparison: true,
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
