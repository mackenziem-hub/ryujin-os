// Ryujin OS - "Needs you now" cockpit aggregator (single pane of glass).
//
// Fail-safe drop-in. Fetches the inbox triage queue + the Generator approval
// queue and renders click-through chips so the operator sees what is waiting
// on them at a glance, instead of having to remember to open inbox.html and
// generator.html separately. It degrades to nothing on any failure (no token,
// a fetch errors, zero counts) and never throws on or blocks the host page.
//
// Include after auth-guard.js (it reuses window.RyujinAuth for the token):
//   <script src="/assets/needs-you-now.js" defer></script>
// If the page has an element with id="needs-you-now" the chips render inline
// there; otherwise a fixed top-center strip is injected over the page.
(function () {
  'use strict';
  var POLL_MS = 90000;

  function token() {
    try {
      return (window.RyujinAuth && window.RyujinAuth.token)
        || localStorage.getItem('ryujin_token')
        || sessionStorage.getItem('ryujin_token') || null;
    } catch (e) { return null; }
  }
  function tenant() {
    try { return window.RYUJIN_TENANT_SLUG || (window.RyujinTenant && window.RyujinTenant.slug) || 'plus-ultra'; }
    catch (e) { return 'plus-ultra'; }
  }
  function reqHeaders() {
    var h = { 'x-tenant-id': tenant() };
    var t = token(); if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  async function getJSON(url) {
    try {
      var r = await fetch(url, { headers: reqHeaders(), cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  function injectStyles() {
    if (document.getElementById('nyn-styles')) return;
    var css = [
      '#needs-you-now.nyn-float{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:300;pointer-events:none}',
      '#needs-you-now{display:none;align-items:center;gap:8px;font-family:"Inter",system-ui,sans-serif}',
      '#needs-you-now.nyn-show{display:flex}',
      '.nyn-lbl{font-family:"Orbitron",sans-serif;font-size:0.56em;letter-spacing:2px;color:rgba(160,190,230,0.7);text-transform:uppercase;pointer-events:none}',
      '.nyn-chip{pointer-events:auto;display:inline-flex;align-items:center;gap:7px;text-decoration:none;padding:6px 12px;border-radius:999px;font-size:0.78em;font-weight:600;letter-spacing:0.3px;background:rgba(14,22,40,0.92);border:1px solid rgba(34,211,238,0.4);color:#bfe9f4;backdrop-filter:blur(12px);box-shadow:0 4px 14px rgba(0,0,0,0.35);transition:transform 0.15s,border-color 0.15s}',
      '.nyn-chip:hover{transform:translateY(-1px);border-color:rgba(34,211,238,0.8);color:#fff}',
      '.nyn-chip .nyn-n{font-family:"Share Tech Mono",monospace;font-weight:700;font-size:1.05em;background:rgba(34,211,238,0.16);border-radius:7px;padding:1px 7px;color:#22d3ee}',
      '.nyn-chip.nyn-red{border-color:rgba(248,113,113,0.55);color:#fca5a5}',
      '.nyn-chip.nyn-red:hover{border-color:rgba(248,113,113,0.9);color:#fff}',
      '.nyn-chip.nyn-red .nyn-n{background:rgba(248,113,113,0.18);color:#f87171}'
    ].join('');
    var s = document.createElement('style'); s.id = 'nyn-styles'; s.textContent = css;
    document.head.appendChild(s);
  }

  function getMount() {
    var el = document.getElementById('needs-you-now');
    if (el) return el;                 // page provided an inline placement
    el = document.createElement('div'); el.id = 'needs-you-now'; el.className = 'nyn-float';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function chip(href, n, one, many, cls) {
    if (!n) return '';
    return '<a class="nyn-chip ' + (cls || '') + '" href="' + href + '">'
      + '<span class="nyn-n">' + n + '</span>' + (n === 1 ? one : many) + '</a>';
  }

  async function refresh() {
    if (!token()) return;              // not signed in: render nothing
    injectStyles();
    var el = getMount();
    var res = await Promise.all([getJSON('/api/inbox'), getJSON('/api/generator?view=queue')]);
    var inbox = res[0], gen = res[1];
    var notify = (inbox && inbox.counts && inbox.counts.notify) || 0;
    var queue = (inbox && inbox.counts && inbox.counts.needs_review) || 0;
    var drafts = (gen && gen.counts && gen.counts.drafts) || 0;

    var html = '';
    if (notify) html += chip('/inbox.html', notify, 'reply needs you', 'replies need you', 'nyn-red');
    else if (queue) html += chip('/inbox.html', queue, 'reply waiting', 'replies waiting', '');
    html += chip('/generator.html', drafts, 'post to approve', 'posts to approve', '');

    if (!html) { el.classList.remove('nyn-show'); el.innerHTML = ''; return; }
    el.innerHTML = '<span class="nyn-lbl">Needs you</span>' + html;
    el.classList.add('nyn-show');
  }

  function init() { refresh(); setInterval(refresh, POLL_MS); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
