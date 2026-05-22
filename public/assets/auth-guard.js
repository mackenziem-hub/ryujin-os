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

  window.RyujinAuth = Object.freeze({
    token,
    headers() {
      return { Authorization: `Bearer ${token}` };
    },
    clearAndRedirect,
    redirectToLogin
  });
})();
