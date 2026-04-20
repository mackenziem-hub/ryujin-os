// ────────────────────────────────────────────────────────────────────
// Ryujin Mode Badge — floating corner pill showing current mode.
// Click to toggle. In SANDBOX: shows XP bar + level + reset.
// ────────────────────────────────────────────────────────────────────
(function(){
  if (!window.RyujinMode) return;

  // Don't render on full-screen cinematic pages, command-center (overlaps 3D panels),
  // or the crew field app (badge collides with bottom nav).
  const SKIP = ['login.html','onboarding.html','boot.html','landing.html','index.html','proposal-client.html','command-center.html','app.html'];
  const path = location.pathname.split('/').pop() || 'index.html';
  if (SKIP.includes(path)) return;

  const style = document.createElement('style');
  style.textContent = `
  :root[data-ry-mode="sandbox"]{
    /* Subtle amber tint everywhere */
  }
  :root[data-ry-mode="sandbox"] body::before{
    content:'';position:fixed;inset:0;pointer-events:none;z-index:5;
    box-shadow:inset 0 0 0 2px rgba(250,204,21,0.35), inset 0 0 60px rgba(250,204,21,0.1);
    border-radius:4px;
  }
  #ry-mode-badge{
    position:fixed;top:14px;right:16px;z-index:9500;
    display:flex;align-items:stretch;gap:0;
    background:rgba(6,12,24,0.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    border:1px solid rgba(34,211,238,0.35);border-radius:10px;overflow:hidden;
    font-family:'Orbitron',sans-serif;
    box-shadow:0 8px 28px rgba(0,0,0,0.5),0 0 20px rgba(34,211,238,0.15);
    transition:all 0.3s cubic-bezier(.2,.8,.3,1);
    user-select:none;
  }
  #ry-mode-badge:hover{transform:translateY(-1px);box-shadow:0 10px 36px rgba(0,0,0,0.6),0 0 30px rgba(34,211,238,0.3)}
  #ry-mode-badge.sandbox{border-color:rgba(250,204,21,0.55);box-shadow:0 8px 28px rgba(0,0,0,0.55),0 0 30px rgba(250,204,21,0.3)}

  .rymb-pill{
    display:flex;align-items:center;gap:7px;
    padding:8px 13px;
    font-size:0.64em;font-weight:800;letter-spacing:2px;
    color:#22d3ee;cursor:pointer;
    transition:background 0.2s;
  }
  .rymb-pill:hover{background:rgba(34,211,238,0.08)}
  #ry-mode-badge.sandbox .rymb-pill{color:#facc15}
  #ry-mode-badge.sandbox .rymb-pill:hover{background:rgba(250,204,21,0.08)}
  .rymb-dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 8px #4ade80;animation:rymbPulse 2s infinite}
  #ry-mode-badge.sandbox .rymb-dot{background:#facc15;box-shadow:0 0 8px #facc15}
  @keyframes rymbPulse{0%,100%{opacity:1}50%{opacity:0.4}}

  .rymb-xp{
    display:flex;flex-direction:column;align-items:flex-start;
    padding:7px 13px;border-left:1px solid rgba(250,204,21,0.25);
    min-width:120px;
  }
  #ry-mode-badge:not(.sandbox) .rymb-xp{display:none}
  .rymb-level{font-family:'Orbitron',sans-serif;font-size:0.6em;font-weight:900;letter-spacing:1.5px;color:#facc15;margin-bottom:3px;display:flex;justify-content:space-between;width:100%;gap:8px}
  .rymb-level .xp{color:rgba(200,220,255,0.6);font-family:'Share Tech Mono',monospace;letter-spacing:0.5px}
  .rymb-bar{position:relative;width:100%;height:5px;background:rgba(250,204,21,0.15);border-radius:3px;overflow:hidden}
  .rymb-fill{position:absolute;top:0;left:0;bottom:0;background:linear-gradient(90deg,#facc15,#22d3ee);transition:width 0.5s cubic-bezier(.2,.8,.3,1);box-shadow:0 0 10px rgba(250,204,21,0.55)}

  .rymb-reset,.rymb-play{padding:8px 11px;background:transparent;border:none;border-left:1px solid rgba(250,204,21,0.25);color:rgba(200,220,255,0.55);font-family:'Share Tech Mono',monospace;font-size:0.62em;letter-spacing:1.5px;cursor:pointer;transition:all 0.2s}
  .rymb-reset:hover,.rymb-play:hover{color:#facc15;background:rgba(250,204,21,0.08)}
  .rymb-play{color:#facc15;font-family:'Orbitron',sans-serif;font-weight:800;letter-spacing:2px;display:flex;align-items:center;gap:6px}
  .rymb-play svg{width:12px;height:12px;stroke:currentColor;fill:currentColor;stroke-width:0}
  #ry-mode-badge:not(.sandbox) .rymb-reset,#ry-mode-badge:not(.sandbox) .rymb-play{display:none}

  /* Tooltip */
  .rymb-tip{
    position:absolute;top:calc(100% + 8px);right:0;
    background:rgba(6,12,24,0.98);border:1px solid rgba(34,211,238,0.4);
    padding:10px 14px;border-radius:9px;
    font-family:'Share Tech Mono',monospace;font-size:0.68em;color:rgba(220,235,255,0.85);
    letter-spacing:1px;white-space:nowrap;
    opacity:0;pointer-events:none;transition:opacity 0.25s;
    box-shadow:0 8px 24px rgba(0,0,0,0.5);
  }
  #ry-mode-badge:hover .rymb-tip{opacity:1}
  #ry-mode-badge.sandbox .rymb-tip{border-color:rgba(250,204,21,0.45)}
  .rymb-tip b{color:#22d3ee}
  #ry-mode-badge.sandbox .rymb-tip b{color:#facc15}

  @media (max-width: 700px){
    #ry-mode-badge{top:auto;bottom:12px;right:12px}
    .rymb-xp{min-width:90px}
  }
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.id = 'ry-mode-badge';
  wrap.innerHTML = `
    <div class="rymb-pill" id="rymb-pill">
      <span class="rymb-dot"></span>
      <span id="rymb-label">LIVE</span>
    </div>
    <div class="rymb-xp" id="rymb-xp">
      <div class="rymb-level"><span id="rymb-level-txt">L1</span><span class="xp" id="rymb-xp-txt">0 XP</span></div>
      <div class="rymb-bar"><div class="rymb-fill" id="rymb-fill" style="width:0%"></div></div>
    </div>
    <button class="rymb-play" id="rymb-play" title="Open Business Manager Simulator"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>PLAY</button>
    <button class="rymb-play" id="rymb-arcade" title="Arcade — Proposal Sprint + training games" style="border-left:1px solid rgba(250,204,21,0.25)"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l4-3 4 3M10 14h4"/></svg>ARCADE</button>
    <button class="rymb-reset" id="rymb-reset" title="Reset sandbox scenario + XP">RESET</button>
    <div class="rymb-tip" id="rymb-tip"></div>
  `;
  document.body.appendChild(wrap);

  function render(){
    const mode = window.RyujinMode.get();
    const sandbox = mode === 'sandbox';
    wrap.classList.toggle('sandbox', sandbox);
    document.getElementById('rymb-label').textContent = sandbox ? 'SANDBOX' : 'LIVE';
    const tip = document.getElementById('rymb-tip');
    if (sandbox && window.RyujinXP) {
      const p = window.RyujinXP.progress();
      document.getElementById('rymb-level-txt').textContent = 'L' + p.level;
      document.getElementById('rymb-xp-txt').textContent = p.xp + ' XP';
      document.getElementById('rymb-fill').style.width = Math.max(0, Math.min(100, p.pct)) + '%';
      tip.innerHTML = '🎮 <b>Business Manager Sim</b> · click to switch back to live · actions earn XP';
    } else {
      tip.innerHTML = 'Click to enter <b>SANDBOX</b> — safe practice mode with XP + levels';
    }
  }

  document.getElementById('rymb-pill').addEventListener('click', () => {
    const now = window.RyujinMode.toggle();
    if (now === 'sandbox' && window.RyujinScenario) window.RyujinScenario.load();
    // Soft refresh: reload so pages that hydrate at boot pick up sandbox data
    setTimeout(() => location.reload(), 280);
  });

  document.getElementById('rymb-play').addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = 'simulator.html';
  });

  document.getElementById('rymb-arcade').addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = 'arcade.html';
  });

  document.getElementById('rymb-reset').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Reset sandbox? This wipes XP, scenario data, and simulator history.')) return;
    if (window.RyujinScenario) window.RyujinScenario.reset();
    if (window.RyujinXP) window.RyujinXP.reset();
    render();
    if (window.RyujinToast) window.RyujinToast('Sandbox reset — fresh start', 'rgba(250,204,21,0.85)');
    setTimeout(() => location.reload(), 500);
  });

  document.addEventListener('ryujin-mode-change', render);
  document.addEventListener('ryujin-xp-gain', render);
  document.addEventListener('ryujin-level-up', render);
  document.addEventListener('ryujin-xp-reset', render);
  render();
})();
