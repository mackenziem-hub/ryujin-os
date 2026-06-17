// Ryujin OS · client-side session gate + auth-headers helper
//
// One include per portal page (before any data-fetching inline script):
//
//   <script src="/assets/auth-guard.js"></script>
//
// Behavior:
//   - If no session token in localStorage/sessionStorage, redirects to
//     /login.html?next=<current-url> synchronously. Other scripts on
//     the page never run with a missing token.
//   - If a session token IS present, exposes `window.RyujinAuth` with
//     helpers for fetches and a clearAndRedirect() escape hatch.
//
// Fetch-site usage (v1 pages):
//
//   fetch('/api/customers', {
//     headers: { 'x-tenant-id': TENANT, ...window.RyujinAuth.headers() }
//   });
//
// On 401 responses, call `window.RyujinAuth.clearAndRedirect()` to wipe
// the stale token and bounce to login.
//
// SECURITY NOTE: This is a UX guard, not a security boundary. Enforcement
// lives on the API endpoints (requirePortalSession + requirePortalSessionAndTenant
// in lib/portalAuth.js). A user who skips this script gets 401s from the
// backend anyway.

(function () {
  const TOKEN_KEY = 'ryujin_token';
  const USER_KEY = 'ryujin_user';
  const TENANT_KEY = 'ryujin_tenant';
  const LOGIN_URL = '/login.html';

  function readToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  }

  function redirectToLogin() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${LOGIN_URL}?next=${next}`;
  }

  function clearAndRedirect() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TENANT_KEY);
    } catch { /* ignore */ }
    redirectToLogin();
  }

  const token = readToken();
  if (!token) {
    redirectToLogin();
    return;
  }

  // ── Shared signed-out partial (Walk 2 item 2) ──────────────────
  // Every authed page used to hand-roll its failure state ("Could not load
  // customers: HTTP 401") with no door in. This is the ONE implementation:
  // plain words plus a Sign in button that returns here via login's ?next=.
  function authErrorHtml() {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return '<div class="ry-auth-error" style="text-align:center;padding:34px 16px">' +
      '<div style="margin-bottom:14px;opacity:0.85">Your session ended.</div>' +
      '<a href="' + LOGIN_URL + '?next=' + next + '" style="display:inline-block;padding:12px 28px;border-radius:10px;border:1px solid rgba(34,211,238,0.5);background:rgba(34,211,238,0.10);color:#22d3ee;text-decoration:none;font-weight:600;letter-spacing:0.5px">Sign in</a>' +
      '</div>';
  }

  // Call on any 401: wipes the stale token and renders the door into the
  // given container (element or selector string). With no container it falls
  // back to the login redirect.
  function sessionEnded(container) {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
    const el = (typeof container === 'string') ? document.querySelector(container) : container;
    if (el) { el.innerHTML = authErrorHtml(); return; }
    redirectToLogin();
  }

  window.RyujinAuth = Object.freeze({
    token,
    headers() {
      return { Authorization: `Bearer ${token}` };
    },
    clearAndRedirect,
    redirectToLogin,
    authErrorHtml,
    sessionEnded
  });

  // ── Fleet-wide Cmd-K command palette ──────────────────────────
  // This script is the operator-page marker (every authed internal page
  // includes it; client-facing renderers do not), so loading the palette
  // here mounts Cmd-K across the whole operator app with no per-page edits
  // and never bleeds onto a client-facing page. Only reached when a token is
  // present (signed-out users were redirected above). command-palette.js
  // self-guards against double-load, so pages that include it directly still
  // work. Non-critical chrome: any failure is swallowed.
  try {
    if (!window.__ryujinPaletteInjected) {
      window.__ryujinPaletteInjected = true;
      var cpScript = document.createElement('script');
      cpScript.src = '/assets/command-palette.js';
      cpScript.defer = true;
      (document.head || document.documentElement).appendChild(cpScript);
    }
  } catch (e) { /* palette is non-critical */ }

  // ── Fleet-wide unread "!" RPG badge ───────────────────────────
  // Same operator-page-marker logic as the palette: loading the badge here
  // lights up every nav item / tile / artifact across the whole operator app
  // when its content changed since this user last opened it, with no per-page
  // edits, and never on a client-facing page. The registry loads first (the
  // badge reads window.RYUJIN_ARTIFACTS); both self-guard against double-load.
  // Non-critical chrome: any failure is swallowed.
  try {
    if (!window.__ryujinUnreadInjected) {
      window.__ryujinUnreadInjected = true;
      var ubScript = document.createElement('script');
      ubScript.src = '/assets/unread-badge.js';
      ubScript.defer = true;
      var mountBadge = function () {
        (document.head || document.documentElement).appendChild(ubScript);
      };
      var regScript = document.createElement('script');
      regScript.src = '/assets/artifact-registry.js';
      regScript.defer = true;
      // mount the badge after the registry resolves either way: even without the
      // static map it still works off self-declared data-updated-at pages.
      regScript.addEventListener('load', mountBadge);
      regScript.addEventListener('error', mountBadge);
      (document.head || document.documentElement).appendChild(regScript);
    }
  } catch (e) { /* unread badge is non-critical */ }

  // ── Fleet-wide Ryujin Drive ("controlling computer") ──────────────
  // Same operator-page-marker logic as the palette + badge: mounting the drive
  // overlay here gives every operator page the AI presence that can take over and
  // visibly drive the OS (cursor + step rail + real-page takeover), surviving
  // navigations because it re-mounts on each destination. Self-guards against
  // double-load. Firm wall lives in the overlay (pending_approval pauses, never
  // auto-sends). Non-critical chrome: any failure is swallowed.
  try {
    if (!window.__ryujinDriveMounted) {
      window.__ryujinDriveMounted = true;
      var dCss = document.createElement('link');
      dCss.rel = 'stylesheet';
      dCss.href = '/assets/ryujin-drive.css';
      (document.head || document.documentElement).appendChild(dCss);
      var dScript = document.createElement('script');
      dScript.src = '/assets/ryujin-drive.js';
      dScript.defer = true;
      (document.head || document.documentElement).appendChild(dScript);
    }
  } catch (e) { /* drive overlay is non-critical */ }

  // ── Fleet-wide navigation prefetch ─────────────────────────────────
  // Same operator-page-marker logic as the palette/badge/drive: warms the next
  // page in the HTTP cache on hover/idle so operator navigation feels instant
  // (the warm-page foundation the Drive takeover rides on). Purely additive
  // browser hints: no fetch interception, no data cache, no behavior change.
  // Self-guards double-load. Non-critical chrome: any failure is swallowed.
  try {
    if (!window.__ryujinPrefetchInjected) {
      window.__ryujinPrefetchInjected = true;
      var pfScript = document.createElement('script');
      pfScript.src = '/assets/ryujin-prefetch.js';
      pfScript.defer = true;
      (document.head || document.documentElement).appendChild(pfScript);
    }
  } catch (e) { /* prefetch is non-critical */ }

  // ── Fleet-wide global pillar nav ───────────────────────────────────
  // The visible persistent "where am I / where can I go / how back" launcher
  // (one small floating pill, collapsed by default) the audit found missing.
  // Same operator-page-marker logic as the palette/badge/drive/prefetch; never
  // on a client-facing page. Self-guards double-load. Non-critical: swallowed.
  try {
    if (!window.__ryujinGlobalNavInjected) {
      window.__ryujinGlobalNavInjected = true;
      var gnScript = document.createElement('script');
      gnScript.src = '/assets/ryujin-globalnav.js';
      gnScript.defer = true;
      (document.head || document.documentElement).appendChild(gnScript);
    }
  } catch (e) { /* global nav is non-critical */ }
})();
