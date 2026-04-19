// ────────────────────────────────────────────────────────────────────
// Ryujin Sub-Hub — flat responsive card grid.
// Rebuilt from scratch: simple, guaranteed-clickable anchors. No 3D arc.
// Usage: RyujinSubHub.init({ sector, accent, panels: [{title,sub,meta,url,icon}] })
// ────────────────────────────────────────────────────────────────────
(function(){
  const SH = window.RyujinSubHub = window.RyujinSubHub || {};
  let cfg = null;

  function hexToRgb(hex){
    const m = hex.replace('#','').match(/.{1,2}/g);
    return m ? parseInt(m[0],16)+','+parseInt(m[1],16)+','+parseInt(m[2],16) : '34,211,238';
  }

  function injectStyles(accent){
    if (document.getElementById('sh-styles')) document.getElementById('sh-styles').remove();
    const rgb = hexToRgb(accent.main);
    const s = document.createElement('style');
    s.id = 'sh-styles';
    s.textContent = `
    :root{
      --sh-accent:${accent.main};
      --sh-accent-deep:${accent.deep};
      --sh-glow:${accent.glow};
      --sh-rgb:${rgb};
    }
    .sh-stage{
      position:absolute;inset:0;
      overflow-y:auto;-webkit-overflow-scrolling:touch;
      padding:80px 32px 40px;
    }
    .sh-caption{text-align:center;margin-bottom:30px;pointer-events:none}
    .sh-caption h1{
      font-family:'Orbitron',sans-serif;font-weight:900;font-size:1.9em;letter-spacing:4px;
      background:linear-gradient(135deg,#fff 20%,var(--sh-accent) 70%,#fff);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
      filter:drop-shadow(0 0 30px var(--sh-glow));
    }
    .sh-caption .sub{
      margin-top:8px;font-family:'Share Tech Mono',monospace;
      font-size:0.78em;letter-spacing:2.5px;color:rgba(200,220,255,0.55);
    }

    .sh-grid{
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
      gap:18px;
      max-width:1200px;
      margin:0 auto 40px;
    }

    .sh-panel{
      display:block;
      position:relative;
      padding:24px 22px;
      background:linear-gradient(160deg,rgba(18,30,56,0.92),rgba(10,20,40,0.88));
      border:1px solid rgba(var(--sh-rgb),0.4);
      border-radius:16px;
      backdrop-filter:blur(12px);
      -webkit-backdrop-filter:blur(12px);
      box-shadow:0 10px 32px rgba(0,0,0,0.45),0 0 24px rgba(var(--sh-rgb),0.15);
      cursor:pointer;
      transition:transform 0.25s cubic-bezier(.2,.8,.3,1), box-shadow 0.25s, border-color 0.2s, background 0.25s;
      text-decoration:none;color:inherit;
      overflow:hidden;
      -webkit-tap-highlight-color:transparent;
    }
    .sh-panel::before{
      content:'';position:absolute;top:0;left:0;right:0;height:2px;
      background:linear-gradient(90deg,transparent 5%,var(--sh-accent) 50%,transparent 95%);
      opacity:0.9;
    }
    .sh-panel::after{
      content:'';position:absolute;bottom:-2px;right:-2px;
      width:36px;height:36px;
      border-bottom:2px solid var(--sh-accent);border-right:2px solid var(--sh-accent);
      border-radius:0 0 16px 0;
      opacity:0.55;transition:opacity 0.25s;
    }
    .sh-panel:hover, .sh-panel:focus-visible{
      transform:translateY(-8px);
      background:linear-gradient(160deg,rgba(30,48,82,0.95),rgba(18,34,66,0.92));
      border-color:var(--sh-accent);
      box-shadow:0 22px 56px rgba(0,0,0,0.6),0 0 52px rgba(var(--sh-rgb),0.45),0 0 90px rgba(var(--sh-rgb),0.25);
      outline:none;
    }
    .sh-panel:hover::after{opacity:1}
    .sh-panel:active{transform:translateY(-4px)}

    .sh-panel-icon{
      width:56px;height:56px;border-radius:14px;
      background:rgba(var(--sh-rgb),0.2);
      border:1px solid var(--sh-accent);
      display:flex;align-items:center;justify-content:center;
      color:var(--sh-accent);margin-bottom:16px;
      transition:all 0.25s;
      box-shadow:0 0 16px rgba(var(--sh-rgb),0.25);
    }
    .sh-panel-icon svg{width:28px;height:28px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .sh-panel:hover .sh-panel-icon{
      background:var(--sh-accent);color:#000;
      box-shadow:0 0 28px rgba(var(--sh-rgb),0.55);
    }

    .sh-panel-title{
      font-family:'Orbitron',sans-serif;
      font-size:1.15em;font-weight:900;letter-spacing:1.8px;
      color:#fff;margin-bottom:8px;
      transition:all 0.25s;
    }
    .sh-panel:hover .sh-panel-title{
      color:#fff;text-shadow:0 0 22px rgba(var(--sh-rgb),0.55);
    }
    .sh-panel-sub{
      font-size:0.95em;
      color:rgba(220,235,255,0.78);
      line-height:1.55;
      margin-bottom:14px;
    }
    .sh-panel-meta{
      padding-top:12px;
      border-top:1px solid rgba(var(--sh-rgb),0.15);
      font-family:'Share Tech Mono',monospace;
      font-size:0.7em;letter-spacing:1.5px;
      color:var(--sh-accent);
      text-transform:uppercase;
    }

    .sh-panel-arrow{
      position:absolute;top:24px;right:22px;
      width:28px;height:28px;
      border-radius:50%;
      background:rgba(var(--sh-rgb),0.15);
      border:1px solid rgba(var(--sh-rgb),0.4);
      display:flex;align-items:center;justify-content:center;
      color:var(--sh-accent);
      transition:all 0.25s;
    }
    .sh-panel-arrow svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round}
    .sh-panel:hover .sh-panel-arrow{
      background:var(--sh-accent);color:#000;
      transform:translateX(4px);
    }

    .sh-hint{
      text-align:center;
      font-family:'Share Tech Mono',monospace;
      font-size:0.72em;letter-spacing:2.5px;
      color:rgba(200,220,255,0.35);
      padding-bottom:20px;
      animation:shBreath 3s ease-in-out infinite;
    }
    @keyframes shBreath{0%,100%{opacity:1}50%{opacity:0.5}}

    /* Dust particles */
    .sh-particles{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:1}
    .sh-dust{position:absolute;width:2px;height:2px;background:var(--sh-accent);border-radius:50%;opacity:0;filter:drop-shadow(0 0 4px var(--sh-accent));animation:shDust 14s linear infinite}
    @keyframes shDust{
      0%{opacity:0;transform:translateY(100vh) scale(0.6)}
      10%{opacity:0.5}
      90%{opacity:0.2}
      100%{opacity:0;transform:translateY(-20px) scale(1.1)}
    }

    /* Mobile */
    @media (max-width: 700px){
      .sh-stage{padding:72px 14px 30px}
      .sh-caption h1{font-size:1.5em;letter-spacing:3px}
      .sh-caption .sub{font-size:0.7em;letter-spacing:2px}
      .sh-grid{grid-template-columns:1fr;gap:12px}
      .sh-panel{padding:20px 18px}
      .sh-panel-title{font-size:1.05em}
      .sh-panel-sub{font-size:0.9em}
    }
    `;
    document.head.appendChild(s);
  }

  function defaultIcon(){ return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>'; }

  function createDom(){
    const mount = document.getElementById('subhub-stage');
    if (!mount) { console.warn('RyujinSubHub: #subhub-stage not found'); return; }
    mount.innerHTML = `
      <div class="sh-particles" id="sh-particles"></div>
      <div class="sh-stage">
        <div class="sh-caption">
          <h1>${cfg.sector.toUpperCase()}</h1>
          <div class="sub">${cfg.subtitle || 'Pick a system to work on'}</div>
        </div>
        <div class="sh-grid" id="sh-grid"></div>
        <div class="sh-hint">TAP ANY CARD · RIGHT-CLICK OR ESC TO GO BACK · PRESS / TO SEARCH</div>
      </div>
    `;
    // Build cards
    const grid = document.getElementById('sh-grid');
    grid.innerHTML = cfg.panels.map((p, i) => `
      <a class="sh-panel" href="${p.url}" target="_top" data-idx="${i}" aria-label="${p.title}">
        <div class="sh-panel-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></div>
        <div class="sh-panel-icon">${p.icon || defaultIcon()}</div>
        <div class="sh-panel-title">${p.title}</div>
        <div class="sh-panel-sub">${p.sub || ''}</div>
        ${p.meta ? `<div class="sh-panel-meta">${p.meta}</div>` : ''}
      </a>
    `).join('');
  }

  function setupParticles(){
    const wrap = document.getElementById('sh-particles');
    if (!wrap) return;
    for (let i = 0; i < 30; i++) {
      const d = document.createElement('div');
      d.className = 'sh-dust';
      d.style.left = (Math.random() * 100) + '%';
      d.style.animationDelay = (Math.random() * 14) + 's';
      d.style.animationDuration = (10 + Math.random() * 10) + 's';
      wrap.appendChild(d);
    }
  }

  // Keyboard nav
  function wireKeys(){
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { goBack(); }
      // Arrow keys move focus between cards
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const panels = Array.from(document.querySelectorAll('.sh-panel'));
        const focused = document.activeElement;
        let idx = panels.indexOf(focused);
        if (idx < 0) idx = 0;
        else {
          const dir = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
          idx = (idx + dir + panels.length) % panels.length;
        }
        panels[idx]?.focus();
        e.preventDefault();
      }
    });
    document.addEventListener('contextmenu', e => { e.preventDefault(); goBack(); });
  }

  function goBack(){
    try {
      if (window.parent !== window && window.parent.exitSectionOverlay) { window.parent.exitSectionOverlay(); return; }
    } catch(e){}
    try { window.top.location.href = 'command-center.html'; }
    catch(e) { window.location.href = 'command-center.html'; }
  }

  SH.init = function(config){
    cfg = config;
    injectStyles(config.accent || { main:'#22d3ee', deep:'#0891b2', glow:'rgba(34,211,238,0.35)' });
    createDom();
    setupParticles();
    wireKeys();
  };
})();
