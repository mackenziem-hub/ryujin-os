// One-shot: restructure Mary #78 (plus-ultra-78) metal roof into 3 tiers
// Standard (Community Barn ribbed) / Enhanced (European Clay) / Premium
// (Standing Seam = "Inquire"), high-to-low, each wired to a real Higgsfield
// render of Mary's home. Prices: clay confirmed $65,800; Community Barn derived
// from the Community Metal (G.A. Coles) rate sheet ($4.75/lin sheet-ft ~ $1.58/
// sqft + trim) via the SOP additive cost-stack / 0.53 divisor; standing seam =
// inquire. Run: node --env-file=.env.local scripts/_oneshot/_seed_78_metal_3tier_2026-06-02.mjs
import { supabaseAdmin } from '../../lib/supabase.js';

const EST = '179cacdc-a4cd-48c5-91ba-b65930c7fd32';
const BLOB = 'https://oyhn4tqzifmqqj0o.public.blob.vercel-storage.com/tenants/plus-ultra/estimates/' + EST;
const R = {
  shingle: BLOB + '/render-shingle-v1-yXPnFJwZZrA5Nf41la5hvUFbKX6jw3.jpg',
  cb:      BLOB + '/render-communitybarn-v1-xmdyEEcgG1zx1aafQxcTdoRm3kRVJP.jpg',
  clay:    BLOB + '/render-euroclay-v1-6w5wKxF0iS2jDAys3u52CRLrycp1QB.jpg',
  ss:      BLOB + '/render-standingseam-v1-CvVUvxBUl9HrPhRCFoGH4N00NUUrhr.jpg',
};

const { data: est, error: e1 } = await supabaseAdmin.from('estimates').select('custom_prices').eq('id', EST).single();
if (e1) throw e1;
const cp = est.custom_prices || {};
const env = cp._envelope;
if (!env || !env.components) throw new Error('no _envelope on estimate');

// Keep the existing clay _calc if present (carry the cost-stack provenance).
const existingClay = (env.components.roof_metal?.tiers || []).find(t => t.slug === 'euro-clay');

env.components.roof_metal.label = 'Metal Roofing Systems';
env.components.roof_metal.tiers = [
  {
    slug: 'standing-seam', tier: 3,
    label: 'Standing Seam (Premium)',
    name: 'The Lifetime Standing Seam',
    subtitle: 'Hidden-fastener, strip-sealed standing seam. Custom-fabricated to your exact 14/12 facets and both chimney saddles. The last roof this house will ever need.',
    warranty_label: 'Lifetime panel - 25-yr workmanship - 60+ yr service life',
    price: null,
    inquire: true,
    inquire_note: 'Priced per roof after a 15-minute measure-up, since every standing-seam run is fabricated to your exact facets. Tap Lock Your Price and we will run your numbers.',
    render_url: R.ss,
    hard: 0,
    popular: false,
  },
  {
    slug: 'euro-clay', tier: 2,
    label: 'European Clay (Enhanced)',
    name: 'The Heritage Tile System',
    subtitle: 'Designer metal that reads like a European clay-tile roof, installed straight over your existing roof on a strapped batten system. No tear-off, no redeck. Pad-style snow guards and full chimney flashings included.',
    warranty_label: 'Lifetime panel - 15-yr workmanship - 50+ yr service life',
    price: 65800,
    popular: true,
    recommended_note: 'Recommended for your steep 14/12 and two chimneys',
    render_url: R.clay,
    hard: existingClay?.hard ?? 34864,
    _calc: existingClay?._calc,
  },
  {
    slug: 'community-barn', tier: 1,
    label: 'Community Barn (Standard)',
    name: 'The Barn Guard',
    subtitle: 'Honest ribbed Community Barn steel (Taylor Steel, flat black), strapped and installed straight over your existing roof. No tear-off, no redeck. Snow guards and full chimney flashings included.',
    warranty_label: 'Lifetime panel - 15-yr workmanship - 50+ yr service life',
    price: 48100,
    render_url: R.cb,
    hard: 25485,
    _calc: {
      method: 'additive_cost_stack', divisor: 0.53, order_sqft: 3740, directTotal: 25485,
      direct: { panels: 5925, strapping: 1870, underlayment: 580, ice_water: 560, trim_accessories: 1600, snow_guards: 750, chimney_flash: 750, disposal: 350, labor_install: 11900, mobilization: 1200 },
      note: 'Community Metal (G.A. Coles) ribbed steel @ $4.75/lin sheet-ft (~$1.58/sqft); trim/underlay/I&W from the Community Metal rate sheet. ESTIMATE pending Mac confirm vs the Coles quote PDF.',
    },
  },
];

// Wire the per-system fallback preview renders too.
env.media = env.media || {};
env.media.after_shingle = R.shingle;
env.media.after_metal = R.cb;

cp._envelope = env;
const { error: e2 } = await supabaseAdmin.from('estimates').update({ custom_prices: cp }).eq('id', EST);
if (e2) throw e2;
console.log('OK: seeded 3 metal tiers (standing-seam inquire / euro-clay $65,800 / community-barn $48,100) + render URLs for plus-ultra-78');
