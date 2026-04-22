// Ryujin OS — Public Proposal Data
// GET /api/proposal?share=<share_token>
// Returns the shape proposal-client.html expects. Public (no auth): share tokens are
// the auth. Tracks view count and last_viewed_at on the proposals row (if present).
import { supabaseAdmin } from '../lib/supabase.js';

// Tier catalog authoritative from Plus Ultra/Sales/pricing_formula_v2.md
// Manufacturer warranties use CertainTeed published terms (lifetime limited + SureStart).
const TIER_CATALOG = {
  gold: {
    tag: 'GOOD', name: 'Gold · Landmark',
    desc: 'CertainTeed Landmark architectural shingle. The industry standard.',
    perks: [
      'CertainTeed Landmark shingles',
      'Lifetime limited manufacturer warranty',
      '10-yr SureStart™ full coverage',
      '15-yr Plus Ultra workmanship warranty',
      'Full tear-off + new synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Drip edge, pipe boots, step flashing'
    ]
  },
  platinum: {
    tag: 'BETTER', name: 'Platinum · Landmark Pro',
    desc: 'CertainTeed Landmark Pro. Thicker shingle, stronger granules, Class A wind.',
    perks: [
      'CertainTeed Landmark Pro shingles',
      'Lifetime limited manufacturer warranty',
      '15-yr SureStart™ full coverage',
      '20-yr Plus Ultra workmanship warranty',
      'Full tear-off + premium synthetic underlayment',
      'Ice & water shield at eaves + valleys',
      'Upgraded flashings + ridge venting'
    ]
  },
  diamond: {
    tag: 'BEST', name: 'Diamond · Presidential',
    desc: 'CertainTeed Presidential designer shingle. Luxury profile, maximum protection.',
    perks: [
      'CertainTeed Presidential designer shingles',
      'Lifetime limited manufacturer warranty',
      '15-yr SureStart™ full coverage',
      '25-yr Plus Ultra workmanship warranty',
      'Full tear-off + premium synthetic underlayment',
      'Full ice & water shield coverage',
      'All upgrade flashings + ridge venting',
      'Priority scheduling'
    ]
  },
  economy: {
    tag: 'ECONOMY', name: 'Economy · 3-tab',
    desc: 'Budget 3-tab asphalt. Gets you a new roof.',
    perks: ['25-yr basic asphalt shingle', 'Standard manufacturer warranty', '5-yr workmanship', 'Full tear-off']
  }
};

const BRAND_BASE = '/brand/plus-ultra';

const REPS = {
  mackenzie: {
    name: 'Mackenzie Mazerolle',
    title: 'Owner · Plus Ultra Roofing',
    initials: 'MM',
    phone: '(506) 540-1052',
    email: 'mackenzie.m@plusultraroofing.com',
    photo: `${BRAND_BASE}/rep-mackenzie.png`,
    introVideo: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/69c29e439728a19e9eb265cd.mp4',
    bio: "Mackenzie is the owner of Plus Ultra Roofing — a third-generation roofing company serving Greater Moncton and beyond. He grew up on job sites, runs the crews hands-on, and signs his own name to every proposal he writes. Tech-forward, certification-backed, and committed to doing every job the way he'd want it done on his own home."
  },
  darcy: {
    name: 'Darcy Mazerolle',
    title: 'Outside Sales · Plus Ultra Roofing',
    initials: 'DM',
    phone: '(506) 232-2272',
    email: 'plusultraroofinginfo@gmail.com',
    photo: `${BRAND_BASE}/rep-darcy.jpg`,
    introVideo: 'https://assets.cdn.filesafe.space/aHotOUdq9D8m3JPrRz9n/media/69c29e439728a19e9eb265cd.mp4',
    bio: "Darcy has been in the trades for over 20 years, helping homeowners plan and price the right roof for their home. He's part of the Plus Ultra Roofing family and is here to give expert advice on any and all of your roofing needs. All you have to do is ask."
  }
};

const CERTIFICATIONS = [
  { label: 'CertainTeed ShingleMaster™', image: `${BRAND_BASE}/cert-shinglemaster.webp` },
  { label: 'CompanyCam Verified', image: `${BRAND_BASE}/cert-companycam.png` },
  { label: 'BBB A+ Accredited (2024)', image: null }
];

const TESTIMONIALS = [
  {
    name: 'Norm Clark',
    city: 'Moncton, NB',
    rating: 5,
    quote: 'Amazing all around experience. From how quickly I received an estimate for a new roof, to getting the work done quickly and at a great price! Highly recommend Mackenzie and his crew!',
    source: 'Google',
    date: '2025-07'
  },
  {
    name: 'Rick Porter',
    city: 'Riverview, NB',
    rating: 5,
    quote: 'Having Plus Ultra Roofing re-shingle our roof was a great decision. The finished roof looks amazing! It was a pleasure working with both Mackenzie (owner), AJ and the rest of their crew. Thank you for a job well done!',
    source: 'Google',
    date: '2025'
  },
  {
    name: 'Verified homeowner',
    city: 'Moncton, NB',
    rating: 5,
    quote: 'Easy to deal with, professional, good communication. I wasn\'t home when they did the majority of the roof but my neighbors said they were very hard workers! Roof looks great and we have had a lot of compliments!',
    source: 'Google',
    date: '2025'
  }
];

const REVIEW_STATS = {
  averageRating: 5.0,
  totalReviews: 35,
  source: 'Google',
  asOf: '2025-09-12',
  screenshot: `${BRAND_BASE}/google-reviews-screenshot.jpg`
};

const GALLERY = [
  { img: `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`, loc: 'MONCTON · LAKESIDE', desc: 'CertainTeed Landmark · full reroof · drone' },
  { img: `${BRAND_BASE}/gallery/02-topdown-architectural.jpg`, loc: 'RIVERVIEW · 2025',    desc: 'Complex architectural roof · top-down drone' },
  { img: `${BRAND_BASE}/gallery/07-valley-detail.jpg`,          loc: 'RIVERVIEW · 2025',    desc: 'Woven valley detail · architectural shingle' },
  { img: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,         loc: 'DIEPPE · 2025',       desc: 'Full tear-off · safety-harnessed crew' },
  { img: `${BRAND_BASE}/gallery/04-job-complete.jpg`,           loc: 'MONCTON · 2025',      desc: 'Job complete · debris staged for haul' },
  { img: `${BRAND_BASE}/gallery/08-new-construction-2.jpg`,     loc: 'MONCTON · 2025',      desc: 'New build · crew installing deck + underlayment' },
  { img: `${BRAND_BASE}/gallery/05-new-construction.jpg`,       loc: 'RIVERVIEW · 2025',    desc: 'New-construction install' },
  { img: `${BRAND_BASE}/gallery/06-drone-completion.jpg`,       loc: 'MONCTON · 2025',      desc: 'Drone completion shot' }
];

const PU_DEFAULT_MEDIA = {
  beforeImage: `${BRAND_BASE}/gallery/03-crew-in-action.jpg`,
  afterImage:  `${BRAND_BASE}/gallery/04-job-complete.jpg`,
  videoCover:  `${BRAND_BASE}/gallery/01-hero-lakeside-landmark.jpg`,
  videoUrl:    REPS.darcy.introVideo,
  gallery:     GALLERY
};

const TENANT_BRANDING_DEFAULT = {
  companyName: 'Plus Ultra Roofing',
  phone: '(506) 540-1052',
  email: 'plusultraroofing@gmail.com',
  website: 'plusultraroofing.com',
  address: '6 McDowell Ave, Riverview, NB',
  logoUrl: `${BRAND_BASE}/logo.png`,
  accentColor: '#22d3ee',
  tagline: 'Go Beyond. Go Plus Ultra.'
};

function buildScopeLineItems(est) {
  const sq = est.roof_area_sqft ? (est.roof_area_sqft / 100).toFixed(1) : null;
  const sel = String(est.selected_package || 'platinum').toLowerCase();
  const prod = {
    gold: 'CertainTeed Landmark',
    platinum: 'CertainTeed Landmark Pro',
    diamond: 'CertainTeed Presidential'
  }[sel] || 'CertainTeed Landmark';
  const workmanship = { gold: '15 yr', platinum: '20 yr', diamond: '25 yr' }[sel] || '15 yr';
  const surestart = sel === 'gold' ? '10 yr' : '15 yr';
  const iwsProd = sel === 'gold' ? 'standard' : 'Grace';
  const underlayProd = sel === 'gold' ? 'standard' : 'Roof Runner';

  const items = [
    { label: prod + ' + install', value: (sq ? sq + ' SQ' : '—') + ' · included' },
    { label: 'Full tear-off to deck', value: 'included' },
    { label: iwsProd + ' ice & water shield', value: est.eaves_lf ? (est.eaves_lf + (est.valleys_lf ? '+' + est.valleys_lf : '') + ' LF eaves+valleys') : 'included' },
    { label: underlayProd + ' synthetic underlayment', value: 'full deck' },
    { label: 'Drip edge', value: est.eaves_lf && est.rakes_lf ? (est.eaves_lf + est.rakes_lf) + ' LF' : 'included' },
    { label: 'Ridge venting', value: est.ridges_lf ? est.ridges_lf + ' LF' : 'included' },
    { label: 'Valley metal', value: est.valleys_lf ? est.valleys_lf + ' LF' : 'included where applicable' },
    { label: 'Pipe boots (3-inch)', value: est.pipes ? est.pipes + ' boots' : 'included' },
    { label: 'Hip and ridge caps', value: 'included' },
    { label: 'Substrate inspection', value: 'included' },
  ];
  if (est.osb_sheets) items.push({ label: 'OSB decking allowance', value: est.osb_sheets + ' sheets' });
  if (est.remediation_allowance) items.push({ label: 'Remediation allowance', value: '$' + est.remediation_allowance + ' · credited back unused' });
  items.push({ label: 'Magnetic cleanup + debris haul', value: 'included' });
  items.push({ label: 'Manufacturer warranty', value: 'Lifetime + ' + surestart + ' SureStart™' });
  items.push({ label: 'Plus Ultra workmanship', value: workmanship + ' + leak-free guarantee' });
  return items;
}

function resolveRep(salesOwner) {
  const key = String(salesOwner || '').toLowerCase().trim();
  if (key.includes('mack')) return REPS.mackenzie;
  if (key.includes('darcy')) return REPS.darcy;
  return REPS.darcy;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const share = String(req.query.share || '').trim();
  if (!share) return res.status(400).json({ error: 'Missing ?share=<token>' });

  const { data: est, error } = await supabaseAdmin
    .from('estimates')
    .select('*, customer:customers(*), photos:estimate_photos(*), proposal:proposals(*)')
    .eq('share_token', share)
    .single();
  if (error || !est) return res.status(404).json({ error: 'Proposal not found' });

  const { data: tenantSettings } = await supabaseAdmin
    .from('tenant_settings')
    .select('company_name, company_phone, company_email, company_website, logo_url, accent_color, tagline')
    .eq('tenant_id', est.tenant_id)
    .single();

  const branding = tenantSettings ? {
    companyName: tenantSettings.company_name || TENANT_BRANDING_DEFAULT.companyName,
    phone: tenantSettings.company_phone || TENANT_BRANDING_DEFAULT.phone,
    email: tenantSettings.company_email || TENANT_BRANDING_DEFAULT.email,
    website: tenantSettings.company_website || TENANT_BRANDING_DEFAULT.website,
    logoUrl: tenantSettings.logo_url || TENANT_BRANDING_DEFAULT.logoUrl,
    accentColor: tenantSettings.accent_color || TENANT_BRANDING_DEFAULT.accentColor,
    tagline: tenantSettings.tagline || TENANT_BRANDING_DEFAULT.tagline,
    address: TENANT_BRANDING_DEFAULT.address
  } : TENANT_BRANDING_DEFAULT;

  const photos = Array.isArray(est.photos) ? est.photos : [];
  const cover = photos.find(p => p.is_cover) || photos[0];
  const beforePhoto = photos.find(p => (p.caption || '').toLowerCase() === 'before');
  const afterPhoto = photos.find(p => (p.caption || '').toLowerCase() === 'after');
  const customGallery = photos
    .filter(p => !p.is_cover && !['before','after'].includes((p.caption || '').toLowerCase()))
    .map(p => ({
      loc: (branding.companyName || 'Plus Ultra Roofing').toUpperCase(),
      desc: p.caption || 'Project photo',
      img: p.url
    }));

  const packages = est.calculated_packages || {};
  const tierEntries = Object.entries(packages)
    .map(([id, pkg]) => {
      const meta = TIER_CATALOG[id] || { tag: id.toUpperCase(), name: id, desc: '', perks: [] };
      return {
        id,
        tag: meta.tag,
        name: meta.name,
        desc: meta.desc,
        total: pkg.total || 0,
        persq: pkg.persq || 0,
        perks: meta.perks
      };
    })
    .filter(t => t.total > 0)
    .sort((a, b) => a.total - b.total);

  const customerName = est.customer?.full_name || '';
  const customerAddress = [est.customer?.address, est.customer?.city, est.customer?.province]
    .filter(Boolean).join(', ');

  const rep = resolveRep(est.sales_owner);

  const data = {
    refId: `PU-${est.estimate_number || est.id.slice(0, 8).toUpperCase()}`,
    estimateId: est.id,
    shareToken: est.share_token,
    customer: {
      name: customerName,
      address: customerAddress,
      phone: est.customer?.phone || '',
      email: est.customer?.email || '',
      coverImage: cover?.url || PU_DEFAULT_MEDIA.afterImage
    },
    rep,
    branding,
    certifications: CERTIFICATIONS,
    testimonials: TESTIMONIALS,
    reviewStats: REVIEW_STATS,
    scope: {
      system: 'asphalt',
      recommended: est.selected_package || 'platinum',
      roofArea: est.roof_area_sqft,
      pitch: est.roof_pitch,
      eaves: est.eaves_lf, rakes: est.rakes_lf, ridges: est.ridges_lf,
      soffit: est.soffit_lf, fascia: est.fascia_lf, gutter: est.gutter_lf,
      osbSheets: est.osb_sheets, remediation: est.remediation_allowance,
      measure: { sq: est.roof_area_sqft ? (est.roof_area_sqft / 100).toFixed(1) : '—' },
      lineItems: buildScopeLineItems(est)
    },
    optionalAdders: est.custom_prices || {},
    media: {
      ...PU_DEFAULT_MEDIA,
      beforeImage: beforePhoto?.url || PU_DEFAULT_MEDIA.beforeImage,
      afterImage: afterPhoto?.url || PU_DEFAULT_MEDIA.afterImage,
      videoUrl: rep.introVideo || PU_DEFAULT_MEDIA.videoUrl,
      gallery: customGallery.length ? [...customGallery, ...GALLERY].slice(0, 8) : GALLERY
    },
    tiers: {
      asphalt: tierEntries.length ? tierEntries : [
        { id: 'gold', tag: 'GOOD', name: TIER_CATALOG.gold.name, desc: TIER_CATALOG.gold.desc, total: 0, perks: TIER_CATALOG.gold.perks }
      ]
    }
  };

  supabaseAdmin
    .from('proposals')
    .update({ view_count: (est.proposal?.[0]?.view_count || 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('estimate_id', est.id)
    .then(() => {}, () => {});

  return res.json(data);
}
