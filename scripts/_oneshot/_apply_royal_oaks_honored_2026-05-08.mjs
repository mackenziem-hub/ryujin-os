// Apply honored 2024-Hiscock pricing (with mild inflation adjustment) to Royal
// Oaks duplex #46 + #47. Strikethrough shows SOP → honored on the proposal page.
//
// Tiers (per side):
//   Gold      $20,750  (vs SOP $21,550)
//   Platinum  $22,500  (vs SOP $25,750)  ← recommended
//   Diamond   $34,200  (vs SOP $37,450)
//
// Each tier honors Hiscock 689 Royal Oaks 2024 per-SQ + ~$650/side inflation bump
// for materials since Aug 2024. Combined Mac net at Platinum (both sides) = $4,053.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const HONORED = {
  gold:     { total: 20750, totalWithTax: 23863 },
  platinum: { total: 22500, totalWithTax: 25875 },
  diamond:  { total: 34200, totalWithTax: 39330 }
};

const ESTS = [
  { id: '1a368c06-76ec-4962-99a2-fb9001fb7ee9', label: 'Jean Gauvin #46' },
  { id: '4ac7f40e-d85d-4cba-9abc-e5d4c5e0fefb', label: 'Sharon #47' }
];

const TAGS_TO_ADD = [
  'legacy_pricing_honored',
  'neighbor_rate_2024_hiscock_689_inflation_adjusted',
  'price_to_sell',
  'ryan_pre_approval_required'
];

const NOTE = {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: 'Honored 2024 Hiscock-689 per-SQ pricing + mild inflation adjustment. SOP would be Gold $21,550 / Plat $25,750 / Dmd $37,450 per side at v2.1 canonical rates; honored at $20,750 / $22,500 / $34,200. Combined Mac net at Platinum (both sides): $4,053. THIN-BUT-DEFENSIBLE floor — Ryan must pre-approve the tightened sub margin before this quote goes firm. Trial run; reassess if margin compresses further on next neighbor deal.'
};

for (const e of ESTS) {
  // Read current calculated_packages so we preserve lineItems + percentages, only overlay totals
  const { data: existing } = await sb.from('estimates').select('calculated_packages, tags, notes').eq('id', e.id).single();
  const cp = { ...(existing.calculated_packages || {}) };

  for (const slug of ['gold','platinum','diamond']) {
    if (!cp[slug]) continue;
    const sopTotal = cp[slug].total;
    cp[slug] = {
      ...cp[slug],
      originalTotal: sopTotal,            // strikethrough source
      total: HONORED[slug].total,
      totalWithTax: HONORED[slug].totalWithTax,
      tax: HONORED[slug].totalWithTax - HONORED[slug].total,
      persq: Math.round(HONORED[slug].total / 33),
      customPrice: true,
      promoLabel: 'NEIGHBOR HONORED RATE'
    };
  }

  const newTags = Array.from(new Set([...(existing.tags || []), ...TAGS_TO_ADD]));
  const newNotes = [...(existing.notes || []), NOTE];

  const { error } = await sb.from('estimates').update({
    calculated_packages: cp,
    tags: newTags,
    notes: newNotes
  }).eq('id', e.id);

  if (error) { console.error(`✗ ${e.label}: ${error.message}`); continue; }
  console.log(`✓ ${e.label} updated`);
  console.log(`    Gold      $20,750  (was $21,550)`);
  console.log(`    Platinum  $22,500  (was $25,750)  ← recommended`);
  console.log(`    Diamond   $34,200  (was $37,450)`);
}

console.log('\nShare URLs:');
console.log('  https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-46');
console.log('  https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-47');
