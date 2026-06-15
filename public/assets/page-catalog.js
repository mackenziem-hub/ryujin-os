// ═══════════════════════════════════════════════════════════════
// /assets/page-catalog.js — BROWSER port of lib/pageCatalog.js.
//
// Client-side defense-in-depth: window.RyujinPages.validateUrl(u) returns true
// only for a real, same-origin Ryujin page. Consumers (cockpit, the agent +
// interactive shells) gate every window.location.href on it, so even a buggy /
// compromised server response can never push the operator off-catalog or
// off-origin. The server (lib/pageCatalog.js) is still the primary fail-closed
// gate; this is the second layer.
//
// ⚠️ KEEP THE PATH LIST IN SYNC with lib/pageCatalog.js PAGES. When you add a
// page there, add its pathname here. validateUrl only needs the pathname set
// (query + hash are allowed), so titles/keywords are intentionally omitted.
// ═══════════════════════════════════════════════════════════════
(function () {
  // Pathnames of every catalog page (navigate + advanced). Mirror of
  // lib/pageCatalog.js PAGES[].url, hash/query stripped.
  var PATHS = [
    '/cockpit.html', '/command-center.html', '/shell.html', '/dashboard-v2.html', '/admin.html',
    '/calendar.html', '/production-calendar.html', '/production-schedule.html',
    '/production-jobs.html', '/job.html', '/production-workorders.html',
    '/production-materials.html', '/production-paysheet.html', '/paysheet.html',
    '/production.html', '/customer-list.html', '/customer-profile.html',
    '/sales-customers.html', '/admin-quests.html', '/admin-overview.html',
    '/sales.html', '/sales-pipeline.html', '/sales-proposals.html',
    '/marketing.html', '/marketing-leads.html', '/ad-activity.html', '/seo-scoreboard.html', '/finance.html',
    '/finance-receivables.html', '/finance-payments.html', '/service.html',
    '/service-tickets.html', '/inbox.html', '/messages.html', '/approvals.html',
    '/admin-pipeline.html', '/admin-cron-health.html', '/agent-ops.html', '/admin-team.html',
    '/admin-pricing.html', '/generator.html', '/decks.html', '/instant-estimator.html',
    '/admin-advanced.html', '/sales-advanced.html', '/marketing-advanced.html',
    '/finance-advanced.html', '/production-advanced.html', '/service-advanced.html',
    '/customer-advanced.html', '/crm.html'
  ];
  var PATH_SET = {};
  for (var i = 0; i < PATHS.length; i++) PATH_SET[PATHS[i]] = true;
  // Catalogued path#hash routes — the only valid hashes. Mirrors the entries in
  // lib/pageCatalog.js PAGES whose url carries a #fragment. A guessed hash on a
  // real page (e.g. /admin.html#calendar) is rejected, matching the server.
  var HASH_ROUTES = { '/admin.html#estimates': true };

  // True only for a same-origin, root-relative (or same-origin absolute) URL
  // whose pathname is a real catalog page. Rejects off-origin, protocol-relative
  // (//host), javascript:, unknown paths, and guessed #hashes on real pages.
  // Query is allowed. Mirrors the server's safeNavUrl.
  function validateUrl(u) {
    try {
      var s = String(u == null ? '' : u).trim();
      if (!s) return false;
      var path, hash = '';
      if (/^https?:\/\//i.test(s)) {
        var parsed = new URL(s);
        if (parsed.origin !== window.location.origin) return false; // off-site
        path = parsed.pathname; hash = parsed.hash;
      } else if (s.charAt(0) === '/') {
        if (s.charAt(1) === '/') return false;                      // protocol-relative //host
        var hi = s.indexOf('#');
        hash = hi >= 0 ? s.slice(hi) : '';
        path = (hi >= 0 ? s.slice(0, hi) : s).split('?')[0];
      } else {
        return false; // not root-relative, not same-origin absolute -> reject
      }
      if (PATH_SET[path] !== true) return false;
      if (hash && HASH_ROUTES[path + hash] !== true) return false;  // guessed hash on a real page
      return true;
    } catch (e) {
      return false;
    }
  }

  window.RyujinPages = { validateUrl: validateUrl, paths: PATHS };
})();
