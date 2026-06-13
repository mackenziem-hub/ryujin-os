/* ═══════════════════════════════════════════════════════════════
   Ryujin shared navigation helper — back/forward to the EXACT page
   + state the operator left, plus consistent cross-links.

   Replaces the deprecated nav-buttons.js. Load with `defer` on every
   operational page. Zero dependencies, no framework.

   What it gives you:
   • A referrer stack in sessionStorage (ry_nav_stack) so BACK returns to
     the exact page+query+scroll you came from, not a hardcoded parent.
   • A smart "<- Back" control: mark any element data-ry-back. It pops the
     stack; if empty it falls back to data-ry-back-default (or its href).
     If the element contains a [data-ry-back-text] slot, the label is set
     to "Back to <where you came from>".
   • Scroll restore on return (history.scrollRestoration disabled so we own it).
   • Per-page state restore: a page calls RyujinNav.saveState({...}) when its
     filter/tab/selected-record changes; on return the page receives a
     `ry-nav-restore` CustomEvent (detail = the saved state) to re-hydrate.

   API (window.RyujinNav):
     go(url)              navigate, recording the current page on the stack
     back(defaultUrl?)    smart back (pop stack -> exact prior page+scroll+state)
     saveState(obj)       merge into this page's restorable state
     push()               force-record the current page (rarely needed)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var STACK = 'ry_nav_stack';
  var RESTORE = 'ry_nav_restore';
  var MAX = 20;

  if ('scrollRestoration' in history) { try { history.scrollRestoration = 'manual'; } catch (e) {} }

  function now() { try { return Date.now(); } catch (e) { return 0; } }
  function readStack() { try { return JSON.parse(sessionStorage.getItem(STACK) || '[]'); } catch (e) { return []; } }
  function writeStack(s) { try { sessionStorage.setItem(STACK, JSON.stringify(s.slice(-MAX))); } catch (e) {} }
  function here() { return location.pathname + location.search + location.hash; }
  function samePath(url) {
    try { return String(url).split('#')[0].split('?')[0] === location.pathname; } catch (e) { return false; }
  }
  function pageLabel() {
    var m = document.querySelector('[data-nav-label]');
    if (m && m.getAttribute('data-nav-label')) return m.getAttribute('data-nav-label');
    // Title up to the first separator: "Job — 51 Lawnsdale | Ryujin" -> "Job"
    var t = (document.title || '').replace(/\s*[|–—>].*$/, '').trim();
    return t || 'previous';
  }

  var pageState = {};
  function saveState(obj) { if (obj) pageState = Object.assign({}, pageState, obj); }

  function pushCurrent() {
    var s = readStack();
    var top = s[s.length - 1];
    var entry = { url: here(), label: pageLabel(), scroll: window.scrollY || 0, state: pageState, ts: now() };
    if (top && top.url === entry.url) s[s.length - 1] = entry; // refresh in place
    else s.push(entry);
    writeStack(s);
  }

  function go(url) { if (!url) return; pushCurrent(); location.href = url; }

  function back(def) {
    // Discard any leading entries that point at the page we're already on
    // (e.g. the user followed a recorded link then used the browser Back
    // button to land here). Otherwise the first in-page BACK would just
    // reload the current page instead of going to the real previous one.
    var cur = here();
    var s = readStack();
    var entry = s.pop();
    while (entry && entry.url === cur) entry = s.pop();
    writeStack(s);
    if (entry && entry.url) {
      try { sessionStorage.setItem(RESTORE, JSON.stringify({ url: entry.url, scroll: entry.scroll || 0, state: entry.state || {} })); } catch (e) {}
      location.href = entry.url;
    } else if (def) {
      location.href = def;
    } else {
      history.back();
    }
  }

  // Should a click on this <a> be recorded as a referrer hop?
  function isInApp(a) {
    if (!a) return false;
    if (a.target === '_blank') return false;
    if (a.hasAttribute('data-ry-back')) return false; // handled separately
    if (a.hasAttribute('data-no-nav')) return false;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) return false;
    if (/^https?:/i.test(href)) { try { return new URL(href).host === location.host; } catch (e) { return false; } }
    return true; // relative in-app link
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var backEl = t.closest('[data-ry-back]');
    if (backEl) {
      e.preventDefault();
      if (backEl.blur) backEl.blur();
      back(backEl.getAttribute('data-ry-back-default') || backEl.getAttribute('href') || null);
      return;
    }
    var a = t.closest('a');
    if (a && isInApp(a)) pushCurrent();
  }, true);

  // First stack entry (from the top) that isn't the page we're already on.
  // back() navigates here, so the label must read the same entry.
  function topTarget() {
    var cur = here();
    var s = readStack();
    for (var i = s.length - 1; i >= 0; i--) { if (s[i] && s[i].url !== cur) return s[i]; }
    return null;
  }

  function applyBackLabels() {
    var top = topTarget();
    var els = document.querySelectorAll('[data-ry-back]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var slot = el.querySelector('[data-ry-back-text]');
      if (!slot) continue;
      var lbl = top && top.label ? top.label : (el.getAttribute('data-ry-back-label') || '');
      slot.textContent = lbl ? ('Back to ' + lbl) : 'Back';
    }
  }

  function runRestore() {
    var r = null;
    try { r = JSON.parse(sessionStorage.getItem(RESTORE) || 'null'); } catch (e) { r = null; }
    if (!r || !r.url || !samePath(r.url)) return;
    sessionStorage.removeItem(RESTORE);
    try { window.dispatchEvent(new CustomEvent('ry-nav-restore', { detail: r.state || {} })); } catch (e) {}
    var y = r.scroll || 0;
    if (y > 0) requestAnimationFrame(function () { setTimeout(function () { window.scrollTo(0, y); }, 0); });
  }

  /* ── Shared chrome (greenlight wave 1) ──────────────────────────
     Visual layer ONLY. Injected from here so all 44 internal pages
     get it with zero per-page edits. Routes, the referrer stack and
     every smart-back behavior above are untouched. Customer-facing
     pages (proposal-client, estimators, photos-share, /p/) do NOT
     load this file, so the internal teal register cannot leak.
     Sheet is inserted as head's FIRST child: page styles win ties;
     intentional overrides below carry their own specificity. */
  var CHROME_ID = 'ry-nav-chrome';
  var EASE = 'cubic-bezier(0.23,1,0.32,1)';
  var CHROME_CSS = '' +
    /* Fleet focus ring: zero-specificity so any page-level focus style
       outranks it. Today no internal page defines one (audited 2026-06-13:
       0 focus-visible hits fleet-wide), so this is THE keyboard ring. */
    ':where(a,button,[role="button"],input,select,textarea,summary,[tabindex]):focus-visible{' +
      'outline:2px solid #2dd4bf;outline-offset:2px;border-radius:6px}' +
    ':where(.btn-back,[data-ry-back]):focus-visible{outline-offset:3px}' +
    /* Back-control promotion: icon-only back chevrons (the 32px dim
       squares) become the locked white-pill convention: big, white,
       labeled, prominent. Doubled class beats .tb-icon regardless of
       cascade order. Markup, handler and routes stay identical. */
    '.ry-back-promoted.ry-back-promoted[data-ry-back]{' +
      'width:auto;height:auto;min-height:40px;padding:8px 14px 8px 10px;' +
      'display:inline-flex;align-items:center;gap:7px;' +
      'background:#fff;border:1px solid #fff;border-radius:10px;color:#030611;' +
      "font-family:'Orbitron',sans-serif;font-size:0.7em;font-weight:800;letter-spacing:1.2px;" +
      'cursor:pointer;text-decoration:none;' +
      'transition:transform 0.18s ' + EASE + ',box-shadow 0.18s ' + EASE + ',background 0.18s ' + EASE + '}' +
    '.ry-back-promoted.ry-back-promoted[data-ry-back] svg{' +
      'width:13px;height:13px;stroke:#030611;fill:none;stroke-width:2.5;flex:none}' +
    '.ry-back-promoted[data-ry-back]:hover{' +
      'background:rgba(255,255,255,0.92);transform:translateY(-1px);' +
      'box-shadow:0 0 14px rgba(255,255,255,0.35)}' +
    '.ry-back-lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}' +
    /* Tactile press on every back control, old family and new. */
    ':where(.btn-back,.ry-back-promoted)[data-ry-back]:active{transform:translateY(0) scale(0.97)}' +
    /* Current-page marker: calm teal underline, set by markCurrentLinks(). */
    'a[data-ry-current][data-ry-current]{color:#5eead4;' +
      'box-shadow:inset 0 -2px 0 rgba(45,212,191,0.7)}' +
    '@media (max-width:480px){' +
      '.ry-back-lbl{max-width:96px}' +
      '.ry-back-promoted.ry-back-promoted[data-ry-back]{min-height:38px;padding:7px 11px 7px 8px}}' +
    /* Reduced-motion, fleet-wide. Mirrors the perf-lite trick from
       ryujin-perf.css: iteration-count 1 (not duration-only) so
       infinite status pulses snap instead of flickering at 100k cps. */
    '@media (prefers-reduced-motion: reduce){' +
      '*,*::before,*::after{animation-duration:0.01ms !important;' +
      'animation-delay:0ms !important;animation-iteration-count:1 !important;' +
      'transition-duration:0.05s !important;scroll-behavior:auto !important}}';

  function injectChrome() {
    if (document.getElementById(CHROME_ID) || !document.head) return;
    var st = document.createElement('style');
    st.id = CHROME_ID;
    st.textContent = CHROME_CSS;
    document.head.insertBefore(st, document.head.firstChild);
  }

  /* Icon-only back controls (chevron, no text) get a label slot so
     applyBackLabels() fills "Back to <where>". Existing labeled backs
     and pages with their own slots are untouched. */
  function upgradeBackControls() {
    var els = document.querySelectorAll('[data-ry-back]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.querySelector('[data-ry-back-text]')) continue;
      if ((el.textContent || '').trim() !== '') continue;
      el.classList.add('ry-back-promoted');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Back');
      var slot = document.createElement('span');
      slot.setAttribute('data-ry-back-text', '');
      slot.className = 'ry-back-lbl';
      el.appendChild(slot);
    }
  }

  /* Mark in-app links that point at the page we are on, so navs show
     where you are. Attribute + CSS only; no behavior change. */
  function markCurrentLinks() {
    try {
      var path = location.pathname.replace(/\/+$/, '');
      var as = document.querySelectorAll('a[href]');
      for (var i = 0; i < as.length; i++) {
        var a = as[i];
        if (a.hasAttribute('data-ry-back') || a.hasAttribute('data-no-nav')) continue;
        var href = a.getAttribute('href') || '';
        if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
        var u;
        try { u = new URL(href, location.href); } catch (e) { continue; }
        if (u.host !== location.host) continue;
        if (u.pathname.replace(/\/+$/, '') === path) a.setAttribute('data-ry-current', '');
      }
    } catch (e) {}
  }

  function ready() { injectChrome(); upgradeBackControls(); applyBackLabels(); runRestore(); markCurrentLinks(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  window.RyujinNav = { go: go, back: back, saveState: saveState, push: pushCurrent };
})();
