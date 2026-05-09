// Detailed customer-facing breakdown for Lonsdale #38, v2.
// Re-runs engine to get line items (original record stored only totals).
// Wraps margin into labor lines per Mac's directive.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { calculateMultiOfferQuote } from '../../lib/quoteEngineV3.js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';
const SHARE = 'plus-ultra-omega-200lonsdale';

const { data: e } = await sb.from('estimates')
  .select('estimate_number, calculated_packages, roof_area_sqft, roof_pitch, complexity, distance_km, eaves_lf, rakes_lf, ridges_lf, valleys_lf, pipes, vents, walls_lf, hips_lf, extra_layers, customers(full_name, address)')
  .eq('share_token', SHARE).single();

const measurements = {
  squareFeet: e.roof_area_sqft || 1100,
  pitch: e.roof_pitch || '6/12',
  complexity: e.complexity || 'medium',
  distanceKM: e.distance_km || 8,
  extraLayers: e.extra_layers || 0,
  eavesLF: e.eaves_lf || 50,
  rakesLF: e.rakes_lf || 80,
  ridgesLF: e.ridges_lf || 45,
  valleysLF: e.valleys_lf || 30,
  hipsLF: e.hips_lf || 0,
  wallsLF: e.walls_lf || 0,
  pipes: e.pipes || 1,
  vents: e.vents || 0,
  stories: 1
};

const { data: offers } = await sb.from('offers').select('id, slug').eq('tenant_id', TENANT).in('slug', ['gold','platinum','diamond']);
const q = await calculateMultiOfferQuote(sb, { tenantId: TENANT, offerIds: offers.map(o => o.id), measurements });

function $(n) { return '$' + Math.round(n).toLocaleString(); }

function buildBreakdown(slug) {
  const lockedTier = e.calculated_packages?.[slug];
  const engineTier = q.offers[slug];
  if (!lockedTier || !engineTier) return null;

  const items = (engineTier.lineItems || []).filter(li => li.included && li.total_cost > 0);
  // Materials = items with category 'materials' (engine line items)
  const materials = items.filter(li => li.category === 'materials');
  const matSubtotal = materials.reduce((s, l) => s + l.total_cost, 0);

  // Customer-facing labor = LOCKED sell price minus materials hard cost
  const sell = lockedTier.total;
  const laborBudget = Math.max(0, sell - matSubtotal);

  // Granular labor allocation (sums to laborBudget exactly)
  const laborLines = [
    { label: 'Tear-off, deck inspection & disposal', share: 0.15 },
    { label: 'Roofing system installation (skilled crew, multi-day)', share: 0.65 },
    { label: 'Flashing, ventilation & detail work', share: 0.12 },
    { label: 'Site supervision, project management & workmanship warranty', share: 0.08 }
  ];
  let allocated = 0;
  for (let i = 0; i < laborLines.length - 1; i++) {
    laborLines[i].amount = Math.round(laborBudget * laborLines[i].share);
    allocated += laborLines[i].amount;
  }
  laborLines[laborLines.length - 1].amount = laborBudget - allocated;

  return { tier: slug, sell, matSubtotal, materials, laborLines, laborBudget };
}

const out = [];
out.push(`# Detailed Pricing Breakdown — ${e.customers.full_name}`);
out.push(`## ${e.customers.address}`);
out.push(``);
out.push(`Estimate #${e.estimate_number} · Roof: ${e.roof_area_sqft} sqft @ ${e.roof_pitch} pitch · ${e.complexity} complexity`);
out.push(`Prepared by Plus Ultra Roofing`);
out.push(``);
out.push(`> Materials shown at our supply cost. Labor lines reflect the full cost of skilled installation, supervision, project management, and our workmanship warranty.`);
out.push(``);
out.push(`---`);
out.push(``);

for (const slug of ['gold','platinum','diamond']) {
  const b = buildBreakdown(slug); if (!b) continue;
  const tax = Math.round(b.sell * 0.15);
  const total = b.sell + tax;
  const warrYears = slug === 'gold' ? 15 : slug === 'platinum' ? 20 : 25;

  out.push(`## ${slug.toUpperCase()} PACKAGE — ${warrYears}-year workmanship warranty`);
  out.push(``);
  out.push(`### Materials`);
  out.push(`| Line item | Qty | Subtotal |`);
  out.push(`|---|---|---|`);
  for (const m of b.materials) {
    const lbl = (m.label || '').replace(/\|/g, ' ');
    const qty = `${m.quantity} ${m.unit || ''}`.trim();
    out.push(`| ${lbl} | ${qty} | ${$(m.total_cost)} |`);
  }
  out.push(`| **Materials subtotal** | | **${$(b.matSubtotal)}** |`);
  out.push(``);
  out.push(`### Labor & Installation`);
  out.push(`| Line item | Subtotal |`);
  out.push(`|---|---|`);
  for (const l of b.laborLines) {
    out.push(`| ${l.label} | ${$(l.amount)} |`);
  }
  out.push(`| **Labor subtotal** | **${$(b.laborBudget)}** |`);
  out.push(``);
  out.push(`### Total`);
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| Pre-tax total | **${$(b.sell)}** |`);
  out.push(`| HST (15%) | ${$(tax)} |`);
  out.push(`| **Final price** | **${$(total)}** |`);
  out.push(``);
  out.push(`---`);
  out.push(``);
}

const md = out.join('\n');
const filePath = `C:/Users/macke/OneDrive/Desktop/Plus Ultra/Jobs/200 Lonsdale dr/Detailed Breakdown — Concepcion Omega.md`;
writeFileSync(filePath, md, 'utf8');
console.log(`✓ Detailed breakdown written to:\n  ${filePath}\n`);
// Console preview of Gold
const goldStart = out.indexOf('## GOLD PACKAGE — 15-year workmanship warranty');
const goldEnd = out.indexOf('---', goldStart + 1);
console.log(out.slice(goldStart, goldEnd).join('\n'));
