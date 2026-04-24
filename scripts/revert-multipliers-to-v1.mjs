// One-shot: revert plus-ultra multipliers to v1 SOP values (1.47 / 1.52 / 1.58)
// after evening session raised them to 1.89 / 2.08 / 2.38.
// Mac confirmed 1.47/1.52/1.58 is the correct pricing per his documented SOP.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = resolve(process.cwd(), '.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

const sb = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SERVICE_KEY.trim());
const TENANT = '84c91cb9-df07-4424-8938-075e9c50cb3b';

const { data: before, error: e0 } = await sb
  .from('offers')
  .select('id, slug, name, active, multipliers')
  .eq('tenant_id', TENANT)
  .in('slug', ['economy','gold','platinum','diamond'])
  .order('sort_order');
if (e0) { console.error('fetch err', e0); process.exit(1); }

console.log('BEFORE:');
for (const o of before) console.log(`  ${o.slug.padEnd(10)} active=${o.active}  mults=${JSON.stringify(o.multipliers)}`);

const updates = [
  { slug: 'gold',     patch: { multipliers: { ...(before.find(x => x.slug==='gold').multipliers||{}),     local: 1.47 } } },
  { slug: 'platinum', patch: { multipliers: { ...(before.find(x => x.slug==='platinum').multipliers||{}), local: 1.52 } } },
  { slug: 'diamond',  patch: { multipliers: { ...(before.find(x => x.slug==='diamond').multipliers||{}),  local: 1.58 } } },
];

for (const u of updates) {
  const { error } = await sb.from('offers').update(u.patch).eq('tenant_id', TENANT).eq('slug', u.slug);
  if (error) { console.error(`  FAIL ${u.slug}:`, error.message); process.exit(1); }
  console.log(`  OK ${u.slug} updated:`, JSON.stringify(u.patch));
}

const { data: after } = await sb
  .from('offers')
  .select('id, slug, name, active, multipliers')
  .eq('tenant_id', TENANT)
  .in('slug', ['economy','gold','platinum','diamond'])
  .order('sort_order');

console.log('\nAFTER:');
for (const o of after) console.log(`  ${o.slug.padEnd(10)} active=${o.active}  mults=${JSON.stringify(o.multipliers)}`);
