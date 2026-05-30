// ────────────────────────────────────────────────────────────────────
// Ryujin Cockpit Launcher — replaces the legacy floating chat bot.
//
// One brain, not two. The old in-page widget (assets/ryujin-chat.js) was a
// second chat UX hitting the same /api/chat brain. This script retires it on
// every portal page and replaces it with:
//   1. A no-op `window.Ryujin` compatibility shim, so the ~17 pages that call
//      `Ryujin.init({...})` (plus a few enable/disable/getAnalytics* calls)
//      keep working with zero console errors after the bot is unwired.
//   2. A slim floating orb button (same bottom-right slot as the old FAB) that
//      opens the full cockpit (/cockpit.html) — the one true agent home.
//
// Drop-in: swap `<script src="assets/ryujin-chat.js">` for
//          `<script src="assets/cockpit-launcher.js">` on a page.
// ────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var COCKPIT_URL = '/cockpit.html';

  // ── 1. Compatibility shim ──────────────────────────────────────────
  // The legacy widget exposed window.Ryujin with init/enable/disable/etc.
  // Those calls live inline on many pages and are NOT all guarded, so a bare
  // removal would throw "Ryujin is not defined". Provide harmless no-ops.
  // `open()` is the one method we make real — it routes to the cockpit.
  var noop = function () {};
  function openCockpit() { window.location.href = COCKPIT_URL; }
  if (!window.Ryujin || typeof window.Ryujin.init !== 'function') {
    window.Ryujin = {
      init: noop,
      enable: noop,
      disable: noop,
      open: openCockpit,
      getAnalyticsCounts: function () { return {}; },
      getAnalyticsLog: function () { return []; }
    };
  }

  // ── 2. Launcher orb ────────────────────────────────────────────────
  // Don't mount on the cockpit itself, and never mount twice.
  function onCockpit() {
    return /\/cockpit\.html$/.test(window.location.pathname);
  }

  function mount() {
    if (onCockpit()) return;
    if (document.getElementById('ry-cockpit-launcher')) return;
    if (!document.body) return;

    var style = document.createElement('style');
    style.textContent = [
      '#ry-cockpit-launcher{position:fixed;bottom:16px;right:16px;z-index:9000;',
      '  display:flex;align-items:center;gap:10px;font-family:Inter,system-ui,sans-serif}',
      '#ry-cockpit-launcher .ry-cl-label{opacity:0;transform:translateX(6px);transition:all .2s;',
      '  background:rgba(6,16,31,0.92);color:#5eead4;border:1px solid rgba(45,212,191,0.32);',
      '  border-radius:999px;padding:8px 14px;font-size:0.8em;font-weight:700;letter-spacing:0.3px;',
      '  white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none}',
      '#ry-cockpit-launcher:hover .ry-cl-label{opacity:1;transform:translateX(0)}',
      '#ry-cl-orb{width:60px;height:60px;border-radius:50%;cursor:pointer;position:relative;',
      '  background:#040d22 url(\'/assets/branding/orb.jpg\') center/cover;',
      '  border:2px solid rgba(45,212,191,0.5);',
      '  box-shadow:0 6px 24px rgba(0,0,0,0.5),0 0 26px rgba(45,212,191,0.4);',
      '  transition:transform .2s,box-shadow .2s;padding:0;outline:none}',
      '#ry-cl-orb:hover{transform:translateY(-2px) scale(1.05);',
      '  box-shadow:0 8px 30px rgba(0,0,0,0.5),0 0 40px rgba(45,212,191,0.6)}',
      '#ry-cl-orb:focus-visible{box-shadow:0 0 0 3px rgba(94,234,212,0.6),0 6px 24px rgba(0,0,0,0.5)}',
      '#ry-cl-orb::after{content:\'\';position:absolute;top:3px;right:3px;width:11px;height:11px;',
      '  border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80;border:2px solid #030611;',
      '  animation:ry-cl-pulse 2.4s infinite}',
      '@keyframes ry-cl-pulse{0%,100%{opacity:1}50%{opacity:0.45}}',
      '@media (prefers-reduced-motion: reduce){#ry-cl-orb::after{animation:none}}'
    ].join('');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'ry-cockpit-launcher';

    var label = document.createElement('span');
    label.className = 'ry-cl-label';
    label.textContent = 'Ask Ryujin';

    var orb = document.createElement('button');
    orb.id = 'ry-cl-orb';
    orb.type = 'button';
    orb.setAttribute('aria-label', 'Open the Ryujin cockpit');
    orb.title = 'Ask Ryujin';
    orb.addEventListener('click', openCockpit);

    // label sits left of the orb
    wrap.appendChild(label);
    wrap.appendChild(orb);
    document.body.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
