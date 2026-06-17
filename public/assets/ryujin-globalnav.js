// /assets/ryujin-globalnav.js
//
// Fleet-wide "one product" navigation. The interconnectivity audit found the gap:
// Cmd-K already jumps anywhere but is hidden, and no page shows a persistent
// "where am I / where can I go" affordance, so the OS feels like a deck of
// separate pages. This adds ONE small, non-colliding floating launcher on every
// operator page (mounted by auth-guard) that answers all three nav questions:
//   where am I   -> the collapsed pill shows current pillar + page
//   where can I go -> click to open a pillar grid, one tap to any hub
//   how do I get back -> a Back row (uses RyujinNav.back when present)
// Search stays Cmd-K (this does not duplicate the palette, it points to it).
//
// Collapsed by default (a small corner pill) so it can never disrupt a page's
// layout. Fully try/catch-wrapped, self-guards double-load, swallows all errors.
// No em dashes.
(function () {
  'use strict';
  if (window.__ryujinGlobalNav) return;
  window.__ryujinGlobalNav = true;

  try {
    var HUBS = [
      { k: 'Command',   label: 'Cockpit',       url: '/cockpit.html' },
      { k: 'Sales',     label: 'Sales',         url: '/sales.html' },
      { k: 'Production', label: 'Production',    url: '/production.html' },
      { k: 'Finance',   label: 'Finance',       url: '/finance.html' },
      { k: 'Service',   label: 'Service',       url: '/service.html' },
      { k: 'Marketing', label: 'Marketing',     url: '/marketing.html' },
      { k: 'Customer',  label: 'Customers',     url: '/customer-list.html' },
      { k: 'Inventory', label: 'Inventory',     url: '/inventory.html' },
      { k: 'Builders',  label: 'Builders Hall', url: '/builders-hall.html' },
      { k: 'Admin',     label: 'Admin',         url: '/admin.html' }
    ];

    function pillarOf(path) {
      if (/^\/(sales|proposal|proposals|crm|lefurgey|commercial-)/.test(path)) return 'Sales';
      if (/^\/(production|job|paysheet|materials|workorder|change-order)/.test(path)) return 'Production';
      if (/^\/finance/.test(path)) return 'Finance';
      if (/^\/(service|warrant|post-production)/.test(path)) return 'Service';
      if (/^\/(marketing|ad-activity|seo|campaign|summer-campaign|nanoseal)/.test(path)) return 'Marketing';
      if (/^\/(customer|portal)/.test(path)) return 'Customer';
      if (/^\/inventory/.test(path)) return 'Inventory';
      if (/^\/(builders-hall|bridge|cockpit|command-center|blockers|progress-rooms|agent-ops|builder-room|dashboard)/.test(path)) return 'Command';
      if (/^\/(admin|administration|settings|roles|approvals|calendar|inbox|messages|media|decks|deck-)/.test(path)) return 'Admin';
      return '';
    }
    function pageLabel() {
      try {
        var t = (document.title || '').replace(/^\s*Ryujin( OS)?\s*[·|:\-]\s*/i, '').trim();
        return t || 'Ryujin';
      } catch (e) { return 'Ryujin'; }
    }

    var path = location.pathname;
    var here = pillarOf(path);

    var css = ''
      + '#rgn{position:fixed;left:14px;bottom:14px;z-index:9000;font-family:Inter,system-ui,sans-serif;}'
      + '#rgn *{box-sizing:border-box;}'
      + '#rgn-pill{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:999px;'
        + 'background:rgba(12,17,25,0.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);'
        + 'border:1px solid rgba(122,162,222,0.22);color:#e9eefa;cursor:pointer;'
        + 'box-shadow:0 6px 22px rgba(0,0,0,0.45);transition:border-color .16s,transform .16s;font-size:12.5px;}'
      + '#rgn-pill:hover{border-color:#4a9eff;transform:translateY(-1px);}'
      + '#rgn-pill .dot{width:7px;height:7px;border-radius:50%;background:#4a9eff;box-shadow:0 0 8px rgba(74,158,255,0.7);flex:0 0 auto;}'
      + '#rgn-pill .here{font-weight:600;letter-spacing:0.2px;max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '#rgn-pill .pil{color:rgba(165,190,226,0.7);font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:0.8px;}'
      + '#rgn-pop{position:absolute;left:0;bottom:42px;width:268px;padding:10px;border-radius:14px;'
        + 'background:rgba(12,17,25,0.94);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);'
        + 'border:1px solid rgba(122,162,222,0.22);box-shadow:0 18px 48px rgba(0,0,0,0.55);display:none;}'
      + '#rgn.open #rgn-pop{display:block;}'
      + '#rgn-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}'
      + '#rgn-pop a{display:block;padding:9px 11px;border-radius:9px;color:#cad8f2;text-decoration:none;font-size:12.5px;'
        + 'border:1px solid rgba(122,162,222,0.14);background:rgba(255,255,255,0.02);transition:border-color .14s,background .14s;}'
      + '#rgn-pop a:hover{border-color:#4a9eff;background:rgba(74,158,255,0.1);color:#fff;}'
      + '#rgn-pop a.cur{border-color:#4a9eff;background:rgba(74,158,255,0.14);color:#fff;}'
      + '#rgn-foot{display:flex;align-items:center;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(122,162,222,0.14);}'
      + '#rgn-back{flex:1;text-align:center;}'
      + '#rgn-foot .kbd{color:rgba(165,190,226,0.7);font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;}'
      + '@media (prefers-reduced-motion: reduce){#rgn-pill{transition:none;}}'
      + 'html:has(.rjd-root.rjd-active) #rgn{display:none;}'   /* yield the corner during a Drive takeover */
      + '@media print{#rgn{display:none;}}';

    var style = document.createElement('style');
    style.id = 'rgn-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    var tiles = HUBS.map(function (h) {
      var cur = (h.k === here) || (h.k === 'Builders' && here === 'Command' && /builders-hall/.test(path));
      return '<a href="' + h.url + '"' + (cur ? ' class="cur"' : '') + '>' + esc(h.label) + '</a>';
    }).join('');

    var wrap = document.createElement('div');
    wrap.id = 'rgn';
    wrap.innerHTML = ''
      + '<div id="rgn-pop" role="menu" aria-label="Go to">'
        + '<div id="rgn-grid">' + tiles + '</div>'
        + '<div id="rgn-foot">'
          + '<a href="#" id="rgn-back" role="menuitem">&#8592; Back</a>'
          + '<span class="kbd">&#8984;K to search</span>'
        + '</div>'
      + '</div>'
      + '<button id="rgn-pill" type="button" aria-haspopup="true" aria-expanded="false" title="Navigate">'
        + '<span class="dot"></span>'
        + (here ? '<span class="pil">' + esc(here) + '</span>' : '')
        + '<span class="here">' + esc(pageLabel()) + '</span>'
      + '</button>';
    (document.body || document.documentElement).appendChild(wrap);

    var pill = wrap.querySelector('#rgn-pill');
    function setOpen(o) { wrap.classList.toggle('open', o); pill.setAttribute('aria-expanded', o ? 'true' : 'false'); }
    pill.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!wrap.classList.contains('open')); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

    var back = wrap.querySelector('#rgn-back');
    back.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        if (window.RyujinNav && typeof window.RyujinNav.back === 'function') { window.RyujinNav.back('/cockpit.html'); return; }
      } catch (e2) {}
      if (history.length > 1) history.back(); else location.href = '/cockpit.html';
    });
  } catch (e) {
    // Global nav is non-critical chrome: never break a page.
  }
})();
