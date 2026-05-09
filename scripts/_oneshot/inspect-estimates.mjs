// Inspect Tobias/Midway/Chartersville/Cornhill estimates
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const url = process.env.SUPABASE_URL.trim();
const key = process.env.SUPABASE_SERVICE_KEY.trim();
const tokens = ['plus-ultra-24','plus-ultra-26','plus-ultra-27','plus-ultra-28'];

async function main() {
  const r = await fetch(`${url}/rest/v1/estimates?select=*,customer:customers(*)&share_token=in.(${tokens.join(',')})`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  const rows = await r.json();
  for (const e of rows) {
    console.log('\n=== ' + e.share_token + ' #' + e.estimate_number + ' (' + (e.customer?.full_name || '?') + ') ===');
    console.log('id:', e.id, 'tenant:', e.tenant_id);
    console.log('sqft:', e.roof_area_sqft, 'pitch:', e.roof_pitch, 'complexity:', e.roof_complexity, 'distance_km:', e.distance_km);
    console.log('LF: eaves=', e.eaves_lf, 'rakes=', e.rakes_lf, 'ridges=', e.ridges_lf, 'hips=', e.hips_lf, 'valleys=', e.valleys_lf);
    console.log('pipes:', e.pipes, 'vents:', e.vents, 'extra_layers:', e.extra_layers, 'osb_sheets:', e.osb_sheets);
    console.log('selected_package:', e.selected_package, 'tags:', e.tags);
    if (e.calculated_packages) {
      for (const [k, v] of Object.entries(e.calculated_packages)) {
        console.log('  pkg.' + k, '→ total:', v.total, 'persq:', v.persq);
        if (v.summary) {
          console.log('     summary: sell=', v.summary.sellingPrice, 'hard=', v.summary.hardCost, 'mult=', v.summary.multiplier, 'netMargin=', v.summary.netMargin);
        }
        if (v.measurements) console.log('     workdays=', v.measurements.workdays, 'projectType=', v.measurements.projectType);
      }
    } else {
      console.log('  (no calculated_packages)');
    }
    console.log('custom_prices:', JSON.stringify(e.custom_prices));
    console.log('chimneys:', e.chimneys, 'chimney_size:', e.chimney_size, 'chimney_cricket:', e.chimney_cricket);
    console.log('cedar_tearoff:', e.cedar_tearoff, 'redeck_sheets:', e.redeck_sheets);
    console.log('soffit_lf:', e.soffit_lf, 'fascia_lf:', e.fascia_lf, 'gutter_lf:', e.gutter_lf, 'leaf_guard:', e.leaf_guard);
    console.log('wall_sqft:', e.wall_sqft, 'siding_choice:', e.siding_choice);
    console.log('window_count:', e.window_count, 'door_count:', e.door_count);
    if (e.scope_extras) console.log('scope_extras:', JSON.stringify(e.scope_extras));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
