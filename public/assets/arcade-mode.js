// ═══════════════════════════════════════════════════════════════
// Ryujin OS - "arcade mode" bootstrap (drop-in for any tool page).
//
// Add ONE line to a tool page's <head>, after mode-switcher.js:
//   <script src="/assets/arcade-mode.js" defer></script>
//
// It does nothing on a normal visit. When the page is opened INSIDE the
// game (the game appends ?arcade=1 to the iframe src), it:
//   - flags <html class="arcade-mode"> + injects arcade-skin.css (8-bit),
//   - forces advanced mode so the existing interactive-shell gamepad
//     poller stays dormant (no double-binding the pad),
//   - loads the shared controller.js and turns the page into a
//     pad-navigable surface via RyujinPad.domFocusNav (D-pad moves a
//     focus ring, A clicks, B posts a "close" message to the game),
//   - persists arcade for in-iframe navigations (sessionStorage).
//
// Net: same page, Grok palette + mouse normally; 8-bit + controller when
// launched from the game.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var active = qs.get('arcade') === '1';
  try { if (!active && sessionStorage.getItem('ry_arcade') === '1') active = true; } catch (e) {}
  if (!active) return;
  try { sessionStorage.setItem('ry_arcade', '1'); } catch (e) {}

  var root = document.documentElement;
  root.classList.add('arcade-mode');

  function injectCss() {
    if (document.getElementById('ry-arcade-skin')) return;
    var l = document.createElement('link');
    l.id = 'ry-arcade-skin'; l.rel = 'stylesheet'; l.href = '/assets/arcade-skin.css';
    document.head.appendChild(l);
  }
  injectCss();

  // Keep the full page visible: force advanced mode so interactive-mode-
  // shell.js (which has its own gamepad poller, gated on data-mode ===
  // "interactive") stays hidden and inert. We set the attribute directly
  // and re-assert if anything flips it, WITHOUT touching the persisted
  // ry_ui_mode so normal use keeps the user's saved mode.
  function forceAdvanced() {
    if (root.dataset.mode === 'interactive') root.dataset.mode = 'advanced';
  }
  forceAdvanced();
  document.addEventListener('ryujin:mode-change', forceAdvanced);

  function backToGame() {
    try { if (window.parent && window.parent !== window) { window.parent.postMessage({ type: 'ryujin:arcade-back' }, '*'); return; } } catch (e) {}
    if (history.length > 1) history.back();
  }

  function deco() {
    if (!document.getElementById('ry-arcade-badge')) {
      var b = document.createElement('div');
      b.id = 'ry-arcade-badge'; b.textContent = 'ARCADE';
      document.body.appendChild(b);
    }
    if (!document.querySelector('.gp-hints-arcade')) {
      var h = document.createElement('div');
      h.className = 'gp-hints-arcade';
      h.innerHTML = '<span><b>+</b> MOVE</span><span><b>A</b> SELECT</span><span><b>B</b> BACK TO GAME</span>';
      document.body.appendChild(h);
    }
  }

  function wirePad() {
    if (!window.RyujinPad) return;
    window.RyujinPad.domFocusNav({ onBack: backToGame });
    // Also let the keyboard B/Escape exit when the page (not an input) is focused.
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape' || e.key === 'b' || e.key === 'B') { e.preventDefault(); backToGame(); }
    });
    // Focus the first interactive control so the ring is visible immediately.
    try {
      var first = document.querySelector('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),.menu-item');
      if (first) first.focus();
    } catch (e) {}
  }

  function loadController() {
    if (window.RyujinPad) { wirePad(); return; }
    var s = document.createElement('script');
    s.src = '/assets/controller.js';
    s.onload = wirePad;
    document.head.appendChild(s);
  }

  function init() { deco(); loadController(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
