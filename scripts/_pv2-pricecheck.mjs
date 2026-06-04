// Compare v2 ProposalData tiers vs the live v1 /api/proposal for the same share.
// Run: node scripts/_pv2-pricecheck.mjs <v2.json> <shareToken>
import { readFileSync } from 'node:fs';
const v2 = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const share = process.argv[3] || 'plus-ultra-76';
const r = await fetch(`https://ryujin-os.vercel.app/api/proposal?share=${share}`, { headers: { Accept: 'application/json' } });
const v1 = await r.json();
const fmt = t => `${String(t.id || '').padEnd(9)} total=${t.total}  persq=${t.persq}  orig=${t.originalTotal ?? '-'}  promo=${t.promoLabel ?? '-'}`;
console.log('LIVE v1 (proposal-client) tiers.asphalt:');
(v1.tiers?.asphalt || []).forEach(t => console.log('  ' + fmt(t)));
console.log('V2 (proposal-v2) products.tiers:');
(v2.products?.tiers || []).forEach(t => console.log('  ' + fmt(t)));
console.log('recommended: v1.selected=', v1.scope?.recommended, ' v2.recommended=', v2.products?.recommended);
