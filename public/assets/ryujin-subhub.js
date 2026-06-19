// ────────────────────────────────────────────────────────────────────
// Ryujin Sub-Hub - the codex card grid.
// Renders the shared codex shell components (ryujin-skin.css) into a hub's
// #subhub-stage from a flat panel config. Used by marketing / post-production /
// sales (administration runs its own tabbed codex shell inline).
//
// Usage (unchanged contract): RyujinSubHub.init({ sector, subtitle, accent, panels:[{title,sub,meta,url,icon}] })
//   - accent is accepted for back-compat but IGNORED: the OS uses one blue
//     accent (var(--rj-accent)) per the de-gamify standard.
//
// SCOPING: the codex class goes on the #subhub-stage MOUNT, not <body>, so the
// shared skin styles the card grid + finder only and never touches each page's
// own topbar. The token (telltale) + component (skin) layers are injected here
// because these pages do not link them; both are guarded and safe (telltale is
// token-only, skin is namespaced under .rj-codex).
// ────────────────────────────────────────────────────────────────────
(function(){
  const SH = window.RyujinSubHub = window.RyujinSubHub || {};
  let cfg = null, focusIdx = -1, finderOpen = false, closeFinder = function(){};

  // Ensure the codex token + component layers are present (these pages do not link them).
  (function ensureAssets(){
    if (!document.getElementById('rj-telltale-css') && !document.querySelector('link[href="/assets/ryujin-telltale.css"]')) {
      var t = document.createElement('link'); t.id = 'rj-telltale-css'; t.rel = 'stylesheet'; t.href = '/assets/ryujin-telltale.css';
      (document.head || document.documentElement).appendChild(t);
    }
    // Skin shares auth-guard's window flag so the two injectors never add a duplicate <link>.
    if (!window.__ryujinSkinInjected && !document.querySelector('link[href="/assets/ryujin-skin.css"]')) {
      window.__ryujinSkinInjected = true;
      var s = document.createElement('link'); s.rel = 'stylesheet'; s.href = '/assets/ryujin-skin.css';
      (document.head || document.documentElement).appendChild(s);
    }
  })();

  function hostStyle(){
    if (document.getElementById('sh-codex-host')) return;
    var s = document.createElement('style'); s.id = 'sh-codex-host';
    // #subhub-stage keeps its page-set position:absolute;inset:0; we only add scroll + codex rhythm.
    s.textContent =
      '#subhub-stage{overflow-y:auto;overflow-x:hidden;padding:88px 28px 44px;scrollbar-width:thin;scrollbar-color:var(--rj-line-strong) transparent}' +
      '#subhub-stage::-webkit-scrollbar{width:9px}' +
      '#subhub-stage::-webkit-scrollbar-thumb{background:var(--rj-line-strong);border-radius:8px}' +
      '#subhub-stage .stage-inner{max-width:1180px;margin:0 auto}' +
      '@media(max-width:760px){#subhub-stage{padding:80px 14px 30px}}';
    document.head.appendChild(s);
  }

  function defaultIcon(){ return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'; }
  var SEARCH_SVG = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>';

  function nav(url){ if (!url) return; try { (window.top || window).location.href = url; } catch(e){ window.location.href = url; } }

  function lit(i){ var g = document.getElementById('shGrid'); if (!g) return; g.classList.add('bloom'); Array.prototype.forEach.call(g.querySelectorAll('.card'), function(c, idx){ c.classList.toggle('lit', idx === i); }); focusIdx = i; }
  function clearBloom(){ var g = document.getElementById('shGrid'); if (!g) return; g.classList.remove('bloom'); Array.prototype.forEach.call(g.querySelectorAll('.card'), function(c){ c.classList.remove('lit'); }); }

  // Clear the lowest fixed bar above the stage. Pages vary: most have only the
  // topbar (~62px), but marketing stacks a .pillar-tabs row under it (~110px).
  // Measuring beats a hardcoded padding that crowds the title on the tabbed page.
  function setStageTop(mount){
    var top = 62;
    ['.topbar', '.pillar-tabs'].forEach(function(sel){
      var el = document.querySelector(sel);
      if (el) { var r = el.getBoundingClientRect(); if (r.height) top = Math.max(top, r.bottom); }
    });
    mount.style.paddingTop = Math.round(top + 18) + 'px';
  }

  function build(){
    var mount = document.getElementById('subhub-stage');
    if (!mount) { console.warn('RyujinSubHub: #subhub-stage not found'); return; }
    mount.classList.add('rj-codex');   // scope the shared skin to the stage only
    hostStyle();
    var n = cfg.panels.length;
    mount.innerHTML =
      '<div class="stage-inner">' +
        '<div class="stage-head">' +
          '<div class="sh-title-wrap">' +
            '<div class="sh-title">' + (cfg.sector || '') + '</div>' +
            '<div class="sh-sub">' + (cfg.subtitle ? cfg.subtitle + ' · ' : '') + n + ' surfaces</div>' +
            '<div class="sh-sweep" style="width:100%"></div>' +
          '</div>' +
          '<button class="sh-search" id="shFind" title="Find a panel">' + SEARCH_SVG + '<span class="txt">find a panel</span><span class="kbd">click</span></button>' +
        '</div>' +
        '<div class="sh-grid" id="shGrid"></div>' +
      '</div>' +
      '<div class="palette-scrim" id="shPal"><div class="palette" role="dialog" aria-label="Find a panel">' +
        '<div class="pal-search">' + SEARCH_SVG + '<input id="shPalInput" type="text" placeholder="find a panel" autocomplete="off" spellcheck="false"><span class="pal-esc">ESC</span></div>' +
        '<div class="pal-list" id="shPalList"></div>' +
        '<div class="pal-foot"><span>up / down move</span><span>enter open</span><span>esc close</span></div>' +
      '</div></div>';

    var grid = document.getElementById('shGrid');
    cfg.panels.forEach(function(p, i){
      var a = document.createElement('a');
      a.className = 'card';
      a.href = p.url || '#';
      a.setAttribute('target', '_top');
      a.setAttribute('tabindex', '0');
      a.setAttribute('aria-label', p.title || '');
      a.style.textDecoration = 'none';
      a.innerHTML =
        '<span class="bracket tl"></span><span class="bracket br"></span>' +
        '<div class="card-top"><div class="card-icon">' + (p.icon || defaultIcon()) + '</div></div>' +
        '<div class="card-title">' + (p.title || '') + '</div>' +
        '<div class="card-sub">' + (p.sub || '') + '</div>' +
        (p.meta ? '<div class="card-meta">' + p.meta + '</div>' : '');
      a.addEventListener('mouseenter', function(){ lit(i); });
      a.addEventListener('mouseleave', clearBloom);
      a.addEventListener('focus', function(){ lit(i); });
      a.addEventListener('blur', function(){ if (document.activeElement && !grid.contains(document.activeElement)) clearBloom(); });
      grid.appendChild(a);
    });

    wireFinder();
    setStageTop(mount);
    window.addEventListener('resize', function(){ setStageTop(mount); });
  }

  function wireFinder(){
    var scrim = document.getElementById('shPal'), input = document.getElementById('shPalInput'), list = document.getElementById('shPalList');
    var sel = 0, flat = [];
    function render(q){
      list.innerHTML = ''; flat = []; q = (q || '').trim().toLowerCase();
      cfg.panels.filter(function(p){ return !q || (p.title || '').toLowerCase().indexOf(q) >= 0; }).forEach(function(p){
        var idx = flat.length; flat.push(p);
        var row = document.createElement('div');
        row.className = 'pal-row' + (idx === 0 ? ' sel' : '');
        row.setAttribute('data-idx', idx);
        row.innerHTML = '<span class="pal-ic">' + (p.icon || defaultIcon()) + '</span><span class="pal-name">' + (p.title || '') + '</span>';
        row.addEventListener('click', function(){ nav(p.url); });
        row.addEventListener('mousemove', function(){ sel = idx; mark(); });
        list.appendChild(row);
      });
      sel = 0; mark();
    }
    function mark(){ Array.prototype.forEach.call(list.querySelectorAll('.pal-row'), function(r){ r.classList.toggle('sel', parseInt(r.getAttribute('data-idx'), 10) === sel); }); }
    function open(){ finderOpen = true; scrim.classList.add('open'); input.value = ''; render(''); setTimeout(function(){ input.focus(); }, 30); }
    closeFinder = function(){ finderOpen = false; scrim.classList.remove('open'); };
    document.getElementById('shFind').addEventListener('click', open);
    scrim.addEventListener('click', function(e){ if (e.target === scrim) closeFinder(); });
    input.addEventListener('input', function(){ render(input.value); });
    input.addEventListener('keydown', function(e){
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, flat.length - 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); var p = flat[sel]; if (p) nav(p.url); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFinder(); }
    });
  }

  function goBack(){
    try { if (window.parent !== window && window.parent.exitSectionOverlay) { window.parent.exitSectionOverlay(); return; } } catch(e){}
    try { window.top.location.href = 'command-center.html'; } catch(e) { window.location.href = 'command-center.html'; }
  }

  function wireKeys(){
    document.addEventListener('keydown', function(e){
      if (finderOpen) { if (e.key === 'Escape') { e.preventDefault(); closeFinder(); } return; }
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { e.preventDefault(); goBack(); return; }
      var cards = Array.prototype.slice.call(document.querySelectorAll('#shGrid .card'));
      if (!cards.length) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusIdx = Math.min((focusIdx < 0 ? -1 : focusIdx) + 1, cards.length - 1); cards[focusIdx].focus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusIdx = Math.max((focusIdx < 0 ? 1 : focusIdx) - 1, 0); cards[focusIdx].focus(); }
    });
    document.addEventListener('contextmenu', function(e){ e.preventDefault(); goBack(); });
  }

  SH.init = function(config){
    cfg = config || { panels: [] };
    if (!cfg.panels) cfg.panels = [];
    build();
    wireKeys();
  };
})();
