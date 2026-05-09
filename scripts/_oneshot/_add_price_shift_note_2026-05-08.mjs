// Append a detailed price-shift note to both Royal Oaks duplex estimates
// (#46 Jean Gauvin / #47 Sharon) explaining the discount + 2024 comparison.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const NOTE_TEXT = `PRICE SHIFT EXPLAINED — May 8 2026

Customer-facing pricing dropped from full SOP to honored neighbor rate level on this duplex to win the deal at a price comparable to what 689 Royal Oaks (Hiscock) paid in Aug 2024. Trial run — Mac authorized "thin but defensible" floor.

PER-TIER DELTAS (per side):
- Gold:     $21,550 → $20,750   ($800 dropped /  $920 customer savings incl HST)
- Platinum: $25,750 → $22,500   ($3,250 dropped / $3,738 customer savings incl HST) ← recommended
- Diamond:  $37,450 → $34,200   ($3,250 dropped / $3,738 customer savings incl HST)

WHERE IT SITS vs HISCOCK 689 ROYAL OAKS (Aug 2024 quote):
Hiscock 2024 per-SQ rates × 33 SQ extrapolated to this side:
- Gold:     $20,064  → honored $20,750  =  $686 above 2024  (3.4%)
- Platinum: $21,846  → honored $22,500  =  $654 above 2024  (3.0%)
- Diamond:  $33,495  → honored $34,200  =  $705 above 2024  (2.1%)

We are approximately matching the 2024 neighbor pricing with a ~$650-700/side inflation adjustment for material cost increases since Aug 2024 (CertainTeed Landmark, Grace I&W, drip edge metal all up 8-12%).

COMBINED MAC NET ON THIS DUPLEX (BOTH SIDES SIGN):
- At honored Platinum (recommended): $4,053
- At honored Diamond (best for Mac):  $10,413
- At honored Gold:                    $5,640
- Crew effort: ~5 days for full duplex (single mob, shared materials order)

INTERNAL CONSTRAINTS:
- Ryan pre-approval required on tightened sub margin before either side goes firm
- Darcy commission held at 15% (old structure — he hasn't agreed to new 12%/8% comp yet)
- If Darcy moves to new comp + 5% self-gen override, future floor rises to ~$22,700/side

TRIAL RUN: If margin compresses further on next neighbor-style deal, reassess the price-to-sell policy. Per project_pricing_engine_audit_may7.md, the v2.1 canonical rate sheet is live in the engine — these honored numbers are intentional discounts off SOP, not a rate-sheet drift.`;

const NOTE = {
  author: 'claude-code',
  timestamp: new Date().toISOString().slice(0, 10),
  note: NOTE_TEXT
};

const ESTS = [
  { id: '1a368c06-76ec-4962-99a2-fb9001fb7ee9', label: 'Jean Gauvin #46' },
  { id: '4ac7f40e-d85d-4cba-9abc-e5d4c5e0fefb', label: 'Sharon #47' }
];

for (const e of ESTS) {
  const { data: existing } = await sb.from('estimates').select('notes').eq('id', e.id).single();
  const newNotes = [...(existing.notes || []), NOTE];
  const { error } = await sb.from('estimates').update({ notes: newNotes }).eq('id', e.id);
  if (error) { console.error(`✗ ${e.label}: ${error.message}`); continue; }
  console.log(`✓ ${e.label}  — note appended  (now ${newNotes.length} notes total)`);
}
