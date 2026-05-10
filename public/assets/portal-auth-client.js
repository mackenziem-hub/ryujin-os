// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Portal auth client gate.
//
// Drop-in script for any /portal-*.html, /messages.html, or panel
// page that requires a logged-in session. Checks for a token in
// localStorage / sessionStorage; if missing, redirects to
// /login.html?next=<current> so the user comes back here after
// signing in.
//
// Soft mode: pages can opt out by setting
//   <html data-portal-auth="off">
// before this script loads. Used during dev / for the public
// pricing+signup flow.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (document.documentElement.dataset.portalAuth === 'off') return;
  const tok = localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token');
  if (tok) return;
  // No token — bounce to login. Don't loop if we're already on login.
  const path = window.location.pathname;
  if (path === '/login.html' || path === '/signup.html' || path === '/pricing.html' || path === '/demo.html' || path === '/upgrade.html' || path === '/onboarding.html' || path === '/' || path === '/index.html' || path === '/landing.html' || path.startsWith('/proposal-client') || path.startsWith('/sub-portal') || path.startsWith('/paysheet') || path.startsWith('/doc.html')) return;
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace('/login.html?next=' + encodeURIComponent(next));
})();
