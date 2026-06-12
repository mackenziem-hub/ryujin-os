// Ryujin OS - platform default brand (white-label PR3).
//
// Tenant #1's identity, centralized. These are the EXACT literals that were
// scattered through lib/documentRenderer.js, lib/pdfRenderer.js,
// lib/outputGenerators.js and api/contract-pdf.js as per-field fallbacks.
// Centralizing them changes NOTHING for plus-ultra (same values, one source;
// proven byte-identical by scripts/_oneshot/_wl3_byteproof.mjs) and gives
// every renderer one override point: callers pass tenant branding and any
// field a tenant supplies wins over these defaults.
//
// Fields that have no tenant_settings column yet (street address, sales-rep
// block) stay PU-defaulted until the Batch D migration adds sources; that is
// a documented limitation, not an accident.
//
// NOTE the two rep shapes are intentionally different: the proposal renderer's
// default rep historically had NO email (its contactEmail chain falls through
// to '' when the company has none), while the sales-page rep carries
// email + phoneTel. Collapsing them would change plus-ultra output.

export const DEFAULT_BRAND = {
  companyName: 'Plus Ultra Roofing',
  phone: '(506) 540-1052',
  email: 'plusultraroofing@gmail.com',
  website: 'plusultraroofing.com',
  address: '6 McDowell Ave, Riverview, NB',
  tagline: 'Go Beyond.',

  // accent tokens differ per surface on purpose; do not unify values
  accentColor: '#FF6B00',        // outputGenerators sales-page branding
  contractAccent: '#0b1d3a',     // api/contract-pdf document accent

  // lib/pdfRenderer.js header block (work orders + pay sheets)
  pdfHeaderName: 'PLUS ULTRA ROOFING',
  pdfHeaderLine: '2-6 McDowell Ave · Riverview NB · (506) 540-1052 · plusultraroofing@gmail.com',

  // lib/documentRenderer.js default reps (shapes preserved exactly)
  repProposal: { name: 'Mackenzie Mazerolle', phone: '(506) 540-1052', title: 'Owner', bio: '' },
  repSales: { name: 'Mackenzie Mazerolle', phone: '(506) 540-1052', phoneTel: '5065401052', email: 'plusultraroofing@gmail.com', title: 'Owner', bio: '' },
};
