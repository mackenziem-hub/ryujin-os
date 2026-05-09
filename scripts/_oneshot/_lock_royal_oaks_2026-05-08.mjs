// Lock both Royal Oaks duplex estimates at honored pricing floor.
// Ryan pre-approved the tightened sub margin; Darcy cleared on the comp side.
// No further price drops authorized. Status remains draft (customer hasn't
// signed yet) — but the price can no longer be discounted without explicit
// unlock by Mac.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());

const NOW = new Date().toISOString();
const LOCKED_REASON = 'Honored neighbor pricing locked May 8 2026 — Ryan pre-approved sub margin, Darcy cleared on comp. Floor reached, cannot drop further without explicit unlock from Mac.';

const ESTS = [
  { id: '1a368c06-76ec-4962-99a2-fb9001fb7ee9', label: 'Jean Gauvin #46' },
  { id: '4ac7f40e-d85d-4cba-9abc-e5d4c5e0fefb', label: 'Sharon #47' }
];

for (const e of ESTS) {
  const { data: existing } = await sb.from('estimates').select('tags').eq('id', e.id).single();
  // Drop the pre-approval-required tag (Ryan confirmed) and add the locked tag
  const tags = (existing.tags || [])
    .filter(t => t !== 'ryan_pre_approval_required')
    .concat(['ryan_pre_approval_confirmed', 'pricing_locked_at_floor']);
  const uniqueTags = Array.from(new Set(tags));

  const { error } = await sb.from('estimates').update({
    locked_at: NOW,
    locked_reason: LOCKED_REASON,
    tags: uniqueTags
  }).eq('id', e.id);

  if (error) { console.error(`✗ ${e.label}: ${error.message}`); continue; }
  console.log(`✓ ${e.label} locked at ${NOW.slice(0,16).replace('T',' ')}`);
}

console.log('\nBoth estimates locked. Pricing cannot drop further.');
console.log('Share URLs unchanged:');
console.log('  https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-46');
console.log('  https://ryujin-os.vercel.app/proposal-client.html?share=plus-ultra-47');
