// /assets/ryujin-prefetch.js
//
// Fleet-wide navigation prefetch. Purely additive speed: on hover / touch / focus
// of an internal catalogued link, and on idle for the visible links, inject a
// <link rel="prefetch"> for the destination page so the next page is warm in the
// HTTP cache before the click lands. This is the "instant navigation" half of the
// magical-fast goal and the warm-page foundation the Ryujin Drive takeover rides on.
//
// HARD CONSTRAINT: this never intercepts fetches, never caches data, never changes
// any page behavior. It only emits browser prefetch HINTS, which the browser is
// free to ignore (low connectivity, Save-Data, already cached). Every path is
// wrapped so a failure is a silent no-op: a prefetch layer must never break a page.
//
// Mounted fleet-wide by auth-guard.js (operator pages only, never client-facing).
// Self-guards against double-load. No em dashes.
(function () {
  'use strict';
  if (window.__ryujinPrefetch) return;
  window.__ryujinPrefetch = true;

  try {
    // Honor an explicit data-saver preference: skip prefetch entirely.
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(String(conn.effectiveType || '')))) return;

    var done = Object.create(null); // pathnames already hinted
    var MAX = 12;                   // cap total hints per page (no network storm)
    var count = 0;

    // Resolve an href to a same-origin .html pathname, or null if it is not a
    // real internal page (external, anchor, mailto, self, query-only, etc).
    function pagePath(href) {
      try {
        if (!href) return null;
        var u = new URL(href, location.href);
        if (u.origin !== location.origin) return null;
        if (!/\.html$/.test(u.pathname)) return null;
        if (u.pathname === location.pathname) return null;
        return u.pathname; // hint the path only; query/hash do not change the cached doc much
      } catch (e) { return null; }
    }

    // Defense in depth: if the page catalog allow-list is loaded, only warm
    // catalogued routes. Absent catalog never blocks (returns true).
    function allowed(path) {
      try {
        if (window.RyujinPages && typeof window.RyujinPages.validateUrl === 'function') {
          return window.RyujinPages.validateUrl(path);
        }
      } catch (e) {}
      return true;
    }

    function prefetch(href) {
      if (count >= MAX) return;
      var path = pagePath(href);
      if (!path || done[path] || !allowed(path)) return;
      done[path] = true; count++;
      try {
        var l = document.createElement('link');
        l.rel = 'prefetch';
        l.as = 'document';
        l.href = path;
        (document.head || document.documentElement).appendChild(l);
      } catch (e) { /* hint failed: no-op */ }
    }

    // Hover / touch / keyboard-focus on a link = the strongest "about to
    // navigate" intent signal. Delegated so it covers dynamically added links.
    function onIntent(e) {
      try {
        var t = e.target;
        var a = (t && t.closest) ? t.closest('a[href]') : null;
        if (a) prefetch(a.getAttribute('href'));
      } catch (e2) {}
    }
    document.addEventListener('mouseover', onIntent, { passive: true });
    document.addEventListener('touchstart', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent, { passive: true });

    // On idle, warm the internal links already in the viewport (the most likely
    // first destinations) up to the cap, so the very first navigation is warm too.
    function warmVisible() {
      try {
        var vh = window.innerHeight || 800;
        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length && count < MAX; i++) {
          var r = links[i].getBoundingClientRect();
          if (r.bottom > 0 && r.top < vh) prefetch(links[i].getAttribute('href'));
        }
      } catch (e) {}
    }
    if ('requestIdleCallback' in window) requestIdleCallback(warmVisible, { timeout: 2500 });
    else setTimeout(warmVisible, 1200);
  } catch (e) {
    // Prefetch is purely additive. Any failure here must never affect the page.
  }
})();
