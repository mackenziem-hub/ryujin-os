// Fixture run: computeMetrics against live DB. Expected (from 2026-06-09
// load-scan): collected d30 ~= 12752, d90 ~= 158918. Eyeball the rest.
import { createClient } from '@supabase/supabase-js';
import { computeMetrics } from '../../lib/metricsContract.js';

const clean = (v) => (v || '').replace(/^"|"$/g, '').replace(/\\n/g, '').trim();
const sb = createClient(clean(process.env.SUPABASE_URL), clean(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));

const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').maybeSingle();
const m = await computeMetrics(sb, tenant.id);
console.log(JSON.stringify(m, null, 1));

const assertClose = (name, got, want, tolPct = 2) => {
  const ok = want === 0 ? got === 0 : Math.abs(got - want) / want * 100 <= tolPct;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${got}, expected ~${want}`);
  if (!ok) process.exitCode = 1;
};
assertClose('collected.d30', m.collected.d30.value, 12752);
assertClose('collected.d90', m.collected.d90.value, 158918);
