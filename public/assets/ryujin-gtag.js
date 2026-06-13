// Ryujin OS - Google tag loader + conversion helper (Google Ads readiness).
//
// HARD NO-OP until /api/gtag-config returns IDs (set via Vercel env when the
// Google Ads account exists). Unconfigured = this file fetches one small JSON,
// defines window.ryConversion as a no-op, and touches nothing else. That is
// the deploy-safe state.
//
// Configured behavior:
//   - injects gtag.js once with the Ads ID (and GA4 ID when present)
//   - window.ryConversion('lead_ie', {value, currency}) fires the matching
//     Google Ads conversion (send_to from config) + a GA4 event of the same
//     name when GA4 is configured.
//
// Pages call ryConversion defensively right next to their existing Meta
// pixel Lead calls:  try { window.ryConversion && ryConversion('lead_ie'); } catch(e){}
(function () {
  'use strict';
  window.ryConversion = function () {}; // no-op until configured

  fetch('/api/gtag-config', { cache: 'default' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || (!cfg.adsId && !cfg.ga4)) return; // unconfigured: stay a no-op

      var primary = cfg.adsId || cfg.ga4;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(primary);
      document.head.appendChild(s);

      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = window.gtag || gtag;
      gtag('js', new Date());
      if (cfg.adsId) gtag('config', cfg.adsId);
      if (cfg.ga4) gtag('config', cfg.ga4);

      window.ryConversion = function (eventKey, params) {
        try {
          var sendTo = cfg.sendTo && cfg.sendTo[eventKey];
          if (sendTo) {
            gtag('event', 'conversion', Object.assign({ send_to: sendTo }, params || {}));
          }
          if (cfg.ga4) {
            gtag('event', eventKey, params || {});
          }
        } catch (e) { /* tracking must never break the page */ }
      };
    })
    .catch(function () { /* config unreachable: stay a no-op */ });
})();
