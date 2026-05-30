// ────────────────────────────────────────────────────────────────────
// Ryujin Cockpit Launcher — replaces the legacy floating chat bot.
//
// One brain, not two. The old in-page widget (assets/ryujin-chat.js) was a
// second chat UX hitting the same /api/chat brain. This script retires it on
// every portal page and replaces it with:
//   1. A `window.Ryujin` compatibility shim, so the pages that call
//      `Ryujin.init({...})` (plus enable/disable/getAnalytics*) keep working
//      with zero console errors after the bot is unwired.
//        - Floating-widget pages: init() is a no-op (the orb below covers it).
//        - Embedded-chat pages (init passes `embedTarget`, e.g. the sales
//          cockpit / dashboard brain panels): init() fills that container with
//          an "Open the Cockpit" call-to-action instead of leaving it blank.
//   2. A slim floating orb (same bottom-right slot as the old FAB) that opens
//      the full cockpit (/cockpit.html) — the one true agent home.
//
// Drop-in: swap `<script src="assets/ryujin-chat.js">` for
//          `<script src="assets/cockpit-launcher.js">` on a page.
// ────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  var COCKPIT_URL = '/cockpit.html';
  var noop = function () {};

  // Open the cockpit in the TOP window — these brain panels are often iframed
  // (e.g. dashboard-v2 inside command-center), so a plain location change would
  // only navigate the inner frame.
  function openCockpit() {
    try { (window.top || window).location.href = COCKPIT_URL; }
    catch (e) { window.location.href = COCKPIT_URL; }
  }

  function framed() {
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  // ── Shared styles (injected once) ──────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('ry-cl-styles')) return;
    var style = document.createElement('style');
    style.id = 'ry-cl-styles';
    style.textContent = [
      // Floating orb
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
      // Embedded-panel call-to-action (fills #dragonChatMount / #agentChatTarget etc.)
      '.ry-cl-embed{height:100%;min-height:160px;display:flex;flex-direction:column;',
      '  align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;',
      '  font-family:Inter,system-ui,sans-serif;color:#e6f1f4}',
      '.ry-cl-embed-orb{width:64px;height:64px;border-radius:50%;',
      '  background:#040d22 url(\'/assets/branding/orb.jpg\') center/cover;',
      '  border:2px solid rgba(45,212,191,0.5);box-shadow:0 0 26px rgba(45,212,191,0.4)}',
      '.ry-cl-embed-title{font-weight:800;font-size:1.02em;letter-spacing:0.3px}',
      '.ry-cl-embed-sub{font-size:0.84em;color:rgba(190,214,222,0.62);max-width:260px}',
      '.ry-cl-embed-btn{margin-top:4px;font:inherit;font-size:0.86em;font-weight:700;color:#04121a;',
      '  background:linear-gradient(160deg,#2dd4bf,#0ea5e9);border:none;border-radius:11px;',
      '  padding:11px 20px;cursor:pointer;transition:filter .12s,transform .1s}',
      '.ry-cl-embed-btn:hover{filter:brightness(1.08)}.ry-cl-embed-btn:active{transform:scale(0.97)}',
      '@media (prefers-reduced-motion: reduce){#ry-cl-orb::after{animation:none}}'
    ].join('');
    document.head.appendChild(style);
  }

  // ── Embedded-chat fill: turn a brain panel into a cockpit entry point ──
  function fillEmbed(el) {
    if (!el || el.querySelector('.ry-cl-embed')) return;
    ensureStyles();
    var box = document.createElement('div');
    box.className = 'ry-cl-embed';
    box.innerHTML =
      '<div class="ry-cl-embed-orb" aria-hidden="true"></div>' +
      '<div class="ry-cl-embed-title">Chat lives in the Cockpit now</div>' +
      '<div class="ry-cl-embed-sub">One brain for everything Ryujin.</div>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ry-cl-embed-btn';
    btn.textContent = 'Open the Cockpit';
    btn.addEventListener('click', openCockpit);
    box.appendChild(btn);
    el.appendChild(box);
  }

  function resolveEmbed(target) {
    var run = function () {
      var el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el) fillEmbed(el);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  // ── 1. Compatibility shim ──────────────────────────────────────────
  if (!window.Ryujin || typeof window.Ryujin.init !== 'function') {
    window.Ryujin = {
      init: function (opts) {
        try { if (opts && opts.embedTarget) resolveEmbed(opts.embedTarget); } catch (e) {}
      },
      enable: noop,
      disable: noop,
      open: openCockpit,
      getAnalyticsCounts: function () { return {}; },
      getAnalyticsLog: function () { return []; }
    };
  }

  // ── 2. Launcher orb ────────────────────────────────────────────────
  // Skip the orb on the cockpit itself, during first-run onboarding (so the
  // completion gate isn't bypassed), and inside iframes (the parent page owns
  // the orb — e.g. dashboard-v2 embedded in command-center).
  function orbSuppressed() {
    return /\/(cockpit|onboarding)\.html$/.test(window.location.pathname) || framed();
  }

  function mount() {
    if (orbSuppressed()) return;
    if (!document.body) return;
    if (document.getElementById('ry-cockpit-launcher')) return;
    ensureStyles();

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
