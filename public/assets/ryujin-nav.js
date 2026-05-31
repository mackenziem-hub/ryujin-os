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

  function applyBackLabels() {
    var s = readStack();
    var top = s[s.length - 1];
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

  function ready() { applyBackLabels(); runRestore(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  window.RyujinNav = { go: go, back: back, saveState: saveState, push: pushCurrent };
})();
