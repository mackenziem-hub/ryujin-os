// Egbuwoku #37 (75 Rue Rachel) — drop Gold tier warranty from default 15yr to 10yr.
// Per Mac directive May 9. Negotiation-stage adjustment.
// Adds explicit warranty line at top of Gold lineItems + sets warranty_years=10
// on the tier object + tag + note. No price change (Gold copy default has no warranty
// adder line — this just clarifies the customer sees 10yr not 15yr).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const { data } = await sb.from('estimates').select('id, calculated_packages, notes, tags, locked_at, locked_reason').eq('share_token', 'plus-ultra-egbuwoku-75rachel').single();
if (!data) { console.error('Estimate not found'); process.exit(1); }

const cp = { ...(data.calculated_packages || {}) };
const gold = { ...(cp.gold || {}) };

// 1. Set warranty_years field for any renderer that reads it
gold.warranty_years = 10;

// 2. Inject explicit warranty line at top of lineItems (no cost — just the term)
const existingLines = (gold.lineItems || []).filter(li => li.item_key !== 'workmanship_warranty_term');
gold.lineItems = [
  {
    unit: 'job',
    label: '10-year workmanship warranty (Gold)',
    notes: 'Standard Gold tier warranty reduced from 15yr to 10yr per customer-specific scope adjustment May 9 2026.',
    config: { tier: 'gold' },
    category: 'warranty',
    included: true,
    item_key: 'workmanship_warranty_term',
    quantity: 1,
    estimated: false,
    unit_cost: 0,
    sort_order: 0,
    total_cost: 0,
    is_override: true,
    price_source: 'manual_override',
    source_detail: 'Mac directive May 9 2026 — Egbuwoku #37 negotiation adjustment'
  },
  ...existingLines
];

cp.gold = gold;

const note = {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: 'May 9 2026 — Gold tier workmanship warranty reduced from default 15-year to 10-year per Mac directive. No price change (default Gold scope_template has no warranty adder line — this is a term reduction, not a cost reduction). Platinum and Diamond tiers untouched (Plat 20yr / Dmd 25yr unchanged). Customer-facing display now shows "10-year workmanship warranty" on the Gold breakdown. Re-locked at unchanged $11,800 pre-tax / $13,570 incl HST. If customer questions the reduced warranty, sales rep should explain this is a custom Gold variant; standard Gold elsewhere remains 15-year.'
};

const tags = Array.from(new Set([...(data.tags || []), 'warranty_reduced_gold_to_10yr_2026-05-09']));

const { error } = await sb.from('estimates').update({
  calculated_packages: cp,
  notes: [...(data.notes || []), note],
  tags,
  locked_reason: 'Re-locked May 9 2026 after Gold warranty term reduction (15yr → 10yr) per Mac directive. Scope, line items, and price unchanged from May 8 main-house-only correction. Plat + Diamond tiers untouched.',
  locked_at: new Date().toISOString()
}).eq('id', data.id);

if (error) { console.error(error.message); process.exit(1); }

console.log('✓ Egbuwoku #37 / 75 Rue Rachel updated:');
console.log('  Gold warranty: 15yr → 10yr');
console.log('  Gold price: $11,800 pre-tax / $13,570 incl HST (unchanged)');
console.log('  Platinum + Diamond untouched');
console.log('  Re-locked with updated reason');
console.log('  Share: https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-egbuwoku-75rachel');
