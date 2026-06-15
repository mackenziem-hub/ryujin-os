/* Ryujin OS · Fleet-wide unread "!" RPG badge
 *
 * A yellow quest-marker "!" that appears on any nav item, Builders Hall tile,
 * index entry, or artifact whose content has updated since this operator last
 * opened it. Subtle pulse + glow, RPG quest-marker energy, not notification spam.
 *
 * Mounted fleet-wide by auth-guard.js (the operator-page marker, never on client-
 * facing pages), so it lights up the whole internal app with zero per-page edits.
 *
 * Data model:
 *   - Each artifact's updatedAt comes from assets/artifact-registry.js, or from a
 *     page that self-declares <html data-artifact-id data-updated-at>.
 *   - Per-user lastSeenAt lives localStorage-first (instant paint) then reconciles
 *     against /api/artifact-seen (Vercel Blob) so it follows the operator across
 *     machines. Opening an artifact writes lastSeenAt = now and clears the badge.
 *   - badge shows when updatedAt > lastSeenAt[id].
 *
 * Wiring an element to an artifact (two ways, both edit-free for real nav links):
 *   1. data-artifact-id="<id>" on any element (optional data-updated-at override).
 *   2. a real <a href="/ad-activity.html"> auto-matches the registry href.
 *   Group count bubble: data-artifact-group on a container counts unseen descendants.
 *
 * Self-contained, theme-variable driven (Telltale tokens with safe fallbacks),
 * self-guarded against double-load. Non-critical chrome: every failure is swallowed.
 */
(function () {
  'use strict';
  if (window.__ryujinUnread) return;
  window.__ryujinUnread = true;

  var TOKEN_KEY = 'ryujin_token';
  var TENANT = 'plus-ultra';
  var SEEN_LS = 'ryujin-artifact-seen';
  var API = '/api/artifact-seen';

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }
  function authHeaders() {
    var h = { 'x-tenant-id': TENANT };
    var t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }

  // ---- seen map (localStorage-first) ----
  function loadLocalSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_LS) || '{}') || {}; } catch (e) { return {}; }
  }
  function saveLocalSeen(m) {
    try { localStorage.setItem(SEEN_LS, JSON.stringify(m)); } catch (e) { /* private mode */ }
  }
  var seen = loadLocalSeen();

  function seenAt(id) { return seen[id] ? Date.parse(seen[id]) : 0; }
  function isUnseen(id, updatedAt) {
    if (!id || !updatedAt) return false;
    var u = Date.parse(updatedAt);
    return Number.isFinite(u) && u > seenAt(id);
  }

  // ---- registry (static file + DOM self-declaration) ----
  function registry() {
    var map = {};
    var list = window.RYUJIN_ARTIFACTS || [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && a.id && a.updatedAt) {
        map[a.id] = { updatedAt: a.updatedAt, href: a.href || null, label: a.label || a.id };
      }
    }
    var root = document.documentElement;
    var pid = root.getAttribute('data-artifact-id');
    var pup = root.getAttribute('data-updated-at');
    if (pid && pup) {
      map[pid] = map[pid] || { href: location.pathname, label: pid };
      map[pid].updatedAt = pup; // the live page is the freshest authority for its own id
    }
    return map;
  }

  // ---- CSS (theme-variable driven, Telltale tokens with fallbacks) ----
  function injectCss() {
    if (document.getElementById('rj-unread-css')) return;
    var s = document.createElement('style');
    s.id = 'rj-unread-css';
    s.textContent = [
      '.rj-unread{',
      '--u-mark:var(--rj-attention,var(--rj-warn,#f5b13a));',
      '--u-glow:var(--rj-attention-glow,rgba(245,177,58,0.45));',
      '--u-ink:#241700;',
      'position:absolute;top:-7px;right:-7px;z-index:40;',
      'min-width:17px;height:17px;padding:0 4px;box-sizing:border-box;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'border-radius:999px;background:var(--u-mark);color:var(--u-ink);',
      'font:800 12px/1 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;',
      'letter-spacing:0;pointer-events:none;',
      'box-shadow:0 0 0 2px var(--rj-bg,#06080f),0 0 10px var(--u-glow);',
      'animation:rjUnreadPulse 2s ease-in-out infinite}',
      '.rj-unread-grp{position:absolute;top:-7px;right:-7px;z-index:40;',
      'min-width:17px;height:17px;padding:0 5px;box-sizing:border-box;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'border-radius:999px;background:var(--rj-attention,#f5b13a);color:#241700;',
      'font:800 11px/1 Inter,system-ui,sans-serif;pointer-events:none;',
      'box-shadow:0 0 0 2px var(--rj-bg,#06080f),0 0 10px var(--rj-attention-glow,rgba(245,177,58,0.45));',
      'animation:rjUnreadPulse 2s ease-in-out infinite}',
      '@keyframes rjUnreadPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.14);opacity:0.78}}',
      '@media(prefers-reduced-motion:reduce){.rj-unread,.rj-unread-grp{animation:none}}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  function makeBadge(cls) {
    var b = document.createElement('span');
    b.className = cls;
    b.setAttribute('aria-hidden', 'false');
    b.setAttribute('role', 'status');
    b.setAttribute('aria-label', 'New since you last opened');
    b.title = 'New since you last opened';
    b.textContent = '!';
    return b;
  }

  // place/remove a single-artifact badge on an element
  function mark(el, id, updatedAt) {
    if (!el || el === document.documentElement) return;
    var existing = el.querySelector(':scope > .rj-unread');
    if (isUnseen(id, updatedAt)) {
      if (!existing) {
        try { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; } catch (e) { /* detached */ }
        el.appendChild(makeBadge('rj-unread'));
        el.setAttribute('data-rj-unread-id', id);
      }
    } else if (existing) {
      existing.remove();
      el.removeAttribute('data-rj-unread-id');
    }
  }

  function pageOf(href) {
    if (!href) return '';
    return String(href).split('?')[0].split('#')[0].replace(/^.*\//, '');
  }

  function decorate() {
    try {
      var reg = registry();

      // 1) explicit data-artifact-id elements (tiles, panels, index rows)
      var tagged = document.querySelectorAll('[data-artifact-id]');
      for (var i = 0; i < tagged.length; i++) {
        var el = tagged[i];
        if (el === document.documentElement) continue;
        var id = el.getAttribute('data-artifact-id');
        var up = el.getAttribute('data-updated-at') || (reg[id] && reg[id].updatedAt);
        mark(el, id, up);
      }

      // 2) real nav anchors whose href matches a registry artifact (no per-page edits)
      for (var id2 in reg) {
        if (!reg.hasOwnProperty(id2) || !reg[id2].href) continue;
        var page = pageOf(reg[id2].href);
        if (!page) continue;
        var anchors = document.querySelectorAll('a[href]');
        for (var j = 0; j < anchors.length; j++) {
          if (pageOf(anchors[j].getAttribute('href')) === page) {
            // do not double-badge an anchor that also carries an explicit id
            if (!anchors[j].hasAttribute('data-artifact-id')) mark(anchors[j], id2, reg[id2].updatedAt);
          }
        }
      }

      // 3) group count bubbles (optional): count unseen artifacts under a container
      var groups = document.querySelectorAll('[data-artifact-group]');
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var marks = grp.querySelectorAll('[data-rj-unread-id]');
        var ids = {};
        for (var m = 0; m < marks.length; m++) ids[marks[m].getAttribute('data-rj-unread-id')] = 1;
        var n = Object.keys(ids).length;
        var bubble = grp.querySelector(':scope > .rj-unread-grp');
        if (n > 0) {
          if (!bubble) {
            try { if (getComputedStyle(grp).position === 'static') grp.style.position = 'relative'; } catch (e) { /* */ }
            bubble = makeBadge('rj-unread-grp');
            grp.appendChild(bubble);
          }
          bubble.textContent = String(n);
        } else if (bubble) {
          bubble.remove();
        }
      }
    } catch (e) { /* decoration is non-critical */ }
  }

  // ---- mark the current artifact page as seen (opening clears it) ----
  var markedThisLoad = false;
  function markCurrentSeen() {
    if (markedThisLoad) return;
    var id = document.documentElement.getAttribute('data-artifact-id');
    if (!id) return;
    markedThisLoad = true;
    var nowIso = new Date().toISOString();
    seen[id] = nowIso;
    saveLocalSeen(seen);
    // clear any badge for this id immediately
    var lit = document.querySelectorAll('[data-rj-unread-id="' + id + '"]');
    for (var i = 0; i < lit.length; i++) {
      var b = lit[i].querySelector(':scope > .rj-unread');
      if (b) b.remove();
      lit[i].removeAttribute('data-rj-unread-id');
    }
    decorate();
    // push forward to the server (best-effort, swallowed)
    try {
      fetch(API, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ id: id, seenAt: nowIso })
      }).catch(function () {});
    } catch (e) { /* offline */ }
  }

  // ---- reconcile local seen against the server (cross-device) ----
  function reconcileFromServer() {
    try {
      fetch(API, { headers: authHeaders(), cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (!data || !data.seen) return;
          var changed = false;
          for (var id in data.seen) {
            if (!data.seen.hasOwnProperty(id)) continue;
            var srv = Date.parse(data.seen[id]);
            if (Number.isFinite(srv) && srv > seenAt(id)) { seen[id] = data.seen[id]; changed = true; }
          }
          if (changed) { saveLocalSeen(seen); decorate(); }
        })
        .catch(function () {});
    } catch (e) { /* offline */ }
  }

  // ---- boot ----
  function boot() {
    injectCss();
    decorate();
    reconcileFromServer();
    // catch async-rendered surfaces (command-center CSS3D panels, Builders Hall
    // gridstack tiles, index lists hydrate after first paint)
    var passes = [400, 1200, 2600];
    passes.forEach(function (ms) { setTimeout(decorate, ms); });
    try {
      var obs = new MutationObserver(function () {
        clearTimeout(boot._t);
        boot._t = setTimeout(decorate, 200);
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* observer optional */ }
    // opening THIS artifact clears its marker after a short dwell (not an accidental flash)
    if (document.documentElement.getAttribute('data-artifact-id')) {
      setTimeout(markCurrentSeen, 900);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // small public surface for pages that want to clear/refresh manually
  window.RyujinUnread = Object.freeze({
    refresh: decorate,
    markSeen: function (id) {
      if (!id) return;
      seen[id] = new Date().toISOString();
      saveLocalSeen(seen);
      decorate();
      try {
        fetch(API, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ id: id, seenAt: seen[id] })
        }).catch(function () {});
      } catch (e) { /* */ }
    }
  });
})();
