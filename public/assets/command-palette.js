/* Ryujin Command Palette - a keyboard-first Cmd-K bar for the cockpit and every internal page.
 *
 * Open with Cmd-K (mac) or Ctrl-K. Type to filter actions and pages, or just type a
 * question and press Enter to ask Ryujin. Routes into the cockpit's live assistant when
 * present (window.RyujinCockpit.summon), otherwise navigates to the cockpit with the query.
 *
 * Self-contained, no dependencies, navy + teal-mint. Include with:
 *   <script src="/assets/command-palette.js" defer></script>
 * Pages can add their own entries via window.RYUJIN_PALETTE_EXTRA = [{label, hint, href|run}].
 */
(function () {
  'use strict';
  if (window.__ryujinPalette) return;
  window.__ryujinPalette = true;

  function go(href) { window.location.href = href; }
  function hasCockpit() { return !!(window.RyujinCockpit && typeof window.RyujinCockpit.summon === 'function'); }
  function ask(text) {
    text = (text || '').trim();
    if (!text) return;
    if (hasCockpit()) { close(); window.RyujinCockpit.summon(text); }
    else { go('/cockpit.html?q=' + encodeURIComponent(text)); }
  }

  var ACTIONS = [
    { label: 'Speak my briefing', hint: 'voice', run: function () {
        if (window.RyujinCockpit && window.RyujinCockpit.speakBriefing) { close(); window.RyujinCockpit.speakBriefing(); }
        else go('/cockpit.html'); } },
    { label: 'New conversation', hint: 'reset', run: function () {
        if (window.RyujinCockpit && window.RyujinCockpit.newConversation) { close(); window.RyujinCockpit.newConversation(); }
        else go('/cockpit.html'); } }
  ];
  var NAV = [
    { label: 'Ryujin', hint: 'AI shell', href: '/shell.html' },
    { label: 'Cockpit', hint: 'agent home', href: '/cockpit.html' },
    { label: 'Command Center', hint: '3D', href: '/command-center.html' },
    { label: 'Classic dashboard', hint: 'lite', href: '/classic.html' },
    { label: 'Calendar', href: '/calendar.html' },
    { label: 'Sales', href: '/sales.html' },
    { label: 'Production', href: '/production.html' },
    { label: 'Marketing', href: '/marketing.html' },
    { label: 'Decks', href: '/decks.html' }
  ];

  var root, input, list, sel = 0, items = [], open = false;

  function injectCss() {
    var s = document.createElement('style');
    // Palette-neutral: every color reads a theme CSS variable and falls back to
    // the original navy + teal-mint, so the palette inherits whichever internal
    // skin a page sets (Telltale, teal-mint glass, etc.) with zero hard-coding.
    s.textContent = [
      '#rcp-ov{' +
        '--cp-accent:var(--accent,#2dd4bf);' +
        '--cp-accent2:var(--accent-bright,var(--accent,#5eead4));' +
        '--cp-accent-soft:var(--accent-glow,rgba(45,212,191,0.14));' +
        '--cp-line:var(--line,rgba(45,212,191,0.22));' +
        '--cp-surface:var(--glass,var(--surface-1,rgba(6,16,31,0.96)));' +
        '--cp-ink:var(--ink,#e6f1f4);' +
        '--cp-ink-dim:var(--ink-dim,rgba(190,214,222,0.5));' +
        '--cp-scrim:var(--scrim,rgba(3,6,17,0.62));' +
        'position:fixed;inset:0;z-index:99999;display:none;align-items:flex-start;justify-content:center;background:var(--cp-scrim);backdrop-filter:blur(6px);padding-top:14vh;font-family:var(--font-sans,Inter,system-ui,-apple-system,sans-serif)}',
      '#rcp-ov.on{display:flex}',
      '#rcp{width:min(620px,calc(100vw - 32px));background:var(--cp-surface);border:1px solid var(--cp-line);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,0.6),0 0 40px var(--cp-accent-soft);overflow:hidden;animation:rcpin .16s cubic-bezier(.2,.8,.3,1)}',
      '@keyframes rcpin{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}',
      '#rcp-in{width:100%;box-sizing:border-box;background:transparent;border:none;outline:none;color:var(--cp-ink);font:inherit;font-size:1.12em;padding:18px 20px;border-bottom:1px solid var(--cp-line)}',
      '#rcp-in::placeholder{color:var(--cp-ink-dim)}',
      '#rcp-list{max-height:46vh;overflow-y:auto;padding:6px}',
      '.rcp-item{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:10px;cursor:pointer;color:var(--cp-ink)}',
      '.rcp-item .ic{width:22px;height:22px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;color:var(--cp-accent)}',
      '.rcp-item .lb{flex:1;font-size:0.98em}',
      '.rcp-item .ht{font-size:0.72em;color:var(--cp-ink-dim);text-transform:uppercase;letter-spacing:1px}',
      '.rcp-item.sel{background:var(--cp-accent-soft);color:var(--cp-ink)}',
      '.rcp-item.sel .ht{color:var(--cp-accent2)}',
      '#rcp-foot{padding:8px 16px;border-top:1px solid var(--cp-line);font-size:0.72em;color:var(--cp-ink-dim);display:flex;gap:16px}',
      '#rcp-foot b{color:var(--cp-accent2);font-weight:700}'
    ].join('');
    document.head.appendChild(s);
  }

  function build() {
    injectCss();
    root = document.createElement('div');
    root.id = 'rcp-ov';
    root.innerHTML =
      '<div id="rcp" role="dialog" aria-label="Command palette">' +
      '<input id="rcp-in" type="text" autocomplete="off" spellcheck="false" placeholder="Ask Ryujin, or jump to anything..." aria-label="Command" />' +
      '<div id="rcp-list" role="listbox"></div>' +
      '<div id="rcp-foot"><span><b>Enter</b> run</span><span><b>up/down</b> move</span><span><b>Esc</b> close</span></div>' +
      '</div>';
    document.body.appendChild(root);
    input = document.getElementById('rcp-in');
    list = document.getElementById('rcp-list');
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    input.addEventListener('input', render);
    input.addEventListener('keydown', onKey);
  }

  function pool() {
    var extra = Array.isArray(window.RYUJIN_PALETTE_EXTRA) ? window.RYUJIN_PALETTE_EXTRA : [];
    return ACTIONS.concat(extra).concat(NAV.map(function (n) {
      return { label: n.label, hint: n.hint || 'page', run: function () { go(n.href); } };
    }));
  }

  function render() {
    var q = (input.value || '').trim().toLowerCase();
    var base = pool().filter(function (it) { return !q || it.label.toLowerCase().indexOf(q) !== -1; });
    items = [];
    if (q) items.push({ label: 'Ask Ryujin: "' + input.value.trim() + '"', hint: 'ask', run: function () { ask(input.value); } });
    items = items.concat(base);
    sel = 0;
    list.innerHTML = '';
    items.forEach(function (it, i) {
      var el = document.createElement('div');
      el.className = 'rcp-item' + (i === sel ? ' sel' : '');
      el.setAttribute('role', 'option');
      el.innerHTML = '<span class="ic">' + (it.hint === 'ask' ? sparkSvg() : dotSvg()) + '</span>' +
        '<span class="lb"></span>' + (it.hint ? '<span class="ht"></span>' : '');
      el.querySelector('.lb').textContent = it.label;
      if (it.hint) el.querySelector('.ht').textContent = it.hint;
      el.addEventListener('mouseenter', function () { sel = i; paint(); });
      el.addEventListener('click', function () { activate(i); });
      list.appendChild(el);
    });
  }

  function paint() {
    var nodes = list.children;
    for (var i = 0; i < nodes.length; i++) nodes[i].className = 'rcp-item' + (i === sel ? ' sel' : '');
    if (nodes[sel]) nodes[sel].scrollIntoView({ block: 'nearest' });
  }

  function activate(i) {
    var it = items[i];
    if (it && typeof it.run === 'function') it.run();
  }

  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function show() {
    if (!root) build();
    open = true; root.classList.add('on');
    input.value = ''; render();
    setTimeout(function () { input.focus(); }, 0);
  }
  function close() {
    if (!root) return;
    open = false; root.classList.remove('on');
  }

  function dotSvg() { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>'; }
  function sparkSvg() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>'; }

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (open) close(); else show();
    }
  });

  window.RyujinPalette = { open: show, close: close };
})();
