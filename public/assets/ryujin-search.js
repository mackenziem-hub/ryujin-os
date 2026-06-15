// Global "/" search shim.
//
// The legacy implementation here carried a hardcoded business INDEX (demo deals
// like "Robert Partridge $44.4K" baked in) and rendered its own overlay. That
// index went stale and showed fake "live" deals. It is retired. "/" now opens the
// live Cmd-K command palette (assets/command-palette.js, window.RyujinPalette),
// which is backed by the real page catalog, so "/" and Cmd-K are one surface.
//
// Kept as a thin shim (not deleted) so the "/" muscle-memory keeps working on the
// ~9 pages that still load this script, with no per-page edits.
(function () {
  'use strict';
  function openPalette() {
    if (window.RyujinPalette && typeof window.RyujinPalette.open === 'function') {
      window.RyujinPalette.open();
      return true;
    }
    return false;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/') return;
    var t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    if (openPalette()) e.preventDefault();
  });
  // Back-compat for any caller of the old API.
  window.RyujinSearch = {
    open: function () { openPalette(); },
    close: function () { if (window.RyujinPalette && window.RyujinPalette.close) window.RyujinPalette.close(); }
  };
})();
