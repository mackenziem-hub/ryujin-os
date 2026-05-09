// Detailed customer-facing breakdown for Lonsdale #38 (Concepcion Omega).
// Margin wrapped into the Labor line — materials shown at hard cost so the
// customer can see exactly what materials are going on her roof, with the
// crew labor + supervision + project management + warranty absorbing the markup.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const SHARE = 'plus-ultra-omega-200lonsdale';
const { data: e } = await sb.from('estimates').select('estimate_number, calculated_packages, roof_area_sqft, roof_pitch, customers(full_name, address)').eq('share_token', SHARE).single();

function $(n) { return '$' + Math.round(n).toLocaleString(); }

function buildBreakdown(slug) {
  const tier = e.calculated_packages[slug];
  if (!tier) return null;
  const items = (tier.lineItems || []).filter(li => li.included && li.total_cost > 0);

  // Materials at hard cost (visible to customer)
  const materials = items.filter(li => li.category === 'materials');
  const matSubtotal = materials.reduce((s, l) => s + l.total_cost, 0);

  // Customer-facing labor = sell price minus materials hard cost
  // Margin entirely absorbed in this line
  const sell = tier.total;
  const laborBudget = sell - matSubtotal;

  // Sub-line breakdown — granular labor lines that sum to laborBudget
  // Allocation: ~70% install labor / ~15% tear-off & disposal / ~10% flashing & ventilation / ~5% site supervision
  const laborLines = [
    { label: 'Tear-off, deck inspection & disposal', share: 0.15 },
    { label: 'Roofing system installation (skilled crew, multi-day)', share: 0.65 },
    { label: 'Flashing, ventilation & detail work', share: 0.12 },
    { label: 'Site supervision, project management & 15-year workmanship warranty', share: 0.08 }
  ];
  // Compute exact dollar amounts, ensuring sum hits laborBudget
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
out.push(`Estimate #${e.estimate_number} · Roof: ${e.roof_area_sqft} sqft @ ${e.roof_pitch} pitch`);
out.push(`Prepared by Plus Ultra Roofing`);
out.push(``);
out.push(`---`);
out.push(``);

for (const slug of ['gold','platinum','diamond']) {
  const b = buildBreakdown(slug); if (!b) continue;
  const tier = e.calculated_packages[slug];
  const tax = Math.round(b.sell * 0.15);
  const total = b.sell + tax;

  out.push(`## ${slug.toUpperCase()} PACKAGE`);
  out.push(``);
  out.push(`### Materials`);
  out.push(`| Line item | Qty | Subtotal |`);
  out.push(`|---|---|---|`);
  for (const m of b.materials) {
    const lbl = (m.label || '').replace(/\|/g, ' ');
    out.push(`| ${lbl} | ${m.quantity} ${m.unit || ''} | ${$(m.total_cost)} |`);
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
console.log('--- Preview (Gold) ---');
console.log(out.slice(0, out.indexOf('---', 30)).join('\n').slice(0, 2500));
