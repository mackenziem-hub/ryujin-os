// Ryujin OS — edge auth gate (default-deny).
//
// Policy [[feedback_ryujin_everything_behind_login]]: internal pages require a
// logged-in session. Only the explicit PUBLIC allowlist (customer funnels, auth
// pages, token-scoped customer shares) is open. Everything else needs the
// `ryujin_session` cookie (minted at login = the sessions-table token), validated
// against Supabase at the edge. Missing/invalid -> 307 redirect to /login.html.
//
// Default-deny means any NEW internal page is gated automatically; only add a
// genuinely customer-facing page to PUBLIC_PAGES / PUBLIC_PREFIXES.
//
// The API layer self-gates (requireOwnerOrAdmin / requirePortalSessionAndTenant),
// so /api/* is excluded from the matcher; this gate is purely for the page bytes.

export const config = {
  // Skip API (self-gated), static assets, and Vercel internals. Everything else
  // (page navigations) runs through the gate.
  matcher: ['/((?!api/|assets/|_vercel/|favicon|robots\\.txt|sitemap|manifest|sw\\.js).*)'],
};

const PUBLIC_PAGES = new Set([
  '/', '/index.html', '/landing.html', '/signup.html', '/login.html',
  '/reset-password.html', '/accept-invite.html', '/pricing.html', '/demo.html',
  '/onboarding.html', '/upgrade.html',
  // lead-capture funnels
  '/instant-estimator.html', '/follow-up-instant-estimator.html',
  '/follow-up-inspections.html', '/follow-up-revive-rejuvenation.html',
  '/summer-campaign-2026.html', '/nanoseal-partnership.html',
  '/marketing-capture.html', '/customer-showcase.html',
  // token-scoped customer-facing shares (the share/token gates the data at the API)
  '/photos-share.html', '/before-after-preview.html',
  '/proposal-client.html', '/custom-proposal.html', '/commercial-proposal.html',
  '/sales-client.html', '/proposal-v2.html',
  // per-address static customer proposals
  '/proposal-715-rt-11.html', '/ranch-road-rejuvenation.html',
  '/lefurgey-gutter-proposal.html', '/tara-court-proposal.html',
  '/tara-court-aphl.html', '/224-route-530-roof-proposal.html',
  '/62-charlotte-roof-proposal.html',
]);

// Customer-facing rewrite prefixes (see vercel.json): /p/:slug -> proposal-v2,
// /proposals/custom/:slug -> custom-proposal, /i/:slug -> redirect.
const PUBLIC_PREFIXES = ['/p/', '/proposals/custom/', '/i/'];

function isPublic(pathname) {
  if (PUBLIC_PAGES.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  // Allow any non-HTML file (root-level static like manifest/icons/json data the
  // matcher did not already exclude). HTML pages are always gated unless allowlisted.
  if (pathname.includes('.') && !pathname.endsWith('.html')) return true;
  return false;
}

async function sessionValid(token) {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key || !token) return false;
  try {
    const r = await fetch(
      `${url}/rest/v1/sessions?select=expires_at&limit=1&token=eq.${encodeURIComponent(token)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return new Date(rows[0].expires_at).getTime() > Date.now();
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isPublic(pathname)) return; // allowed, continue to origin

  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|;\s*)ryujin_session=([^;]+)/);
  const token = match ? decodeURIComponent(match[1]) : null;

  if (token && (await sessionValid(token))) return; // authenticated, continue

  const loginUrl = new URL('/login.html', request.url);
  loginUrl.searchParams.set('next', pathname + url.search);
  return Response.redirect(loginUrl, 307);
}
