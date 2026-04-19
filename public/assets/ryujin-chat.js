// ────────────────────────────────────────────────────────────────────
// Ryujin Dragon Chatbot — shared widget
// Each sector page calls Ryujin.init({ sector, states }) with its content.
// ────────────────────────────────────────────────────────────────────
(function(){
  const RY = window.Ryujin = window.Ryujin || {};
  let config = null;
  let historyStack = [];

  const STYLES = `
  #ry-root{position:fixed;bottom:14px;right:14px;z-index:9000;font-family:'Inter',system-ui,sans-serif}
  #ry-fab{width:58px;height:58px;border-radius:50%;
    background:radial-gradient(circle at 35% 30%,rgba(220,240,255,0.3),rgba(34,211,238,0.3) 35%,rgba(10,25,50,0.9) 75%);
    border:1px solid rgba(34,211,238,0.5);
    box-shadow:0 6px 24px rgba(0,0,0,0.5),0 0 24px rgba(34,211,238,0.35);
    cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;
    transition:all 0.25s;backdrop-filter:blur(10px)}
  #ry-fab:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 8px 30px rgba(0,0,0,0.5),0 0 40px rgba(34,211,238,0.55)}
  #ry-fab::after{content:'';position:absolute;top:4px;right:4px;width:10px;height:10px;border-radius:50%;
    background:#4ade80;box-shadow:0 0 10px #4ade80;border:2px solid #030611;animation:ry-pulse 2s infinite}
  #ry-fab .ry-fab-eye{width:24px;height:24px;border-radius:50%;
    background:radial-gradient(circle at 40% 40%,rgba(255,255,255,0.9),rgba(34,211,238,1) 30%,rgba(10,30,70,0.9) 80%);
    box-shadow:inset 0 -2px 4px rgba(0,0,0,0.4),inset 0 1px 3px rgba(255,255,255,0.25),0 0 14px rgba(34,211,238,0.6)}
  @keyframes ry-pulse{0%,100%{opacity:1}50%{opacity:0.45}}

  #ry-panel{position:fixed;bottom:84px;right:14px;width:360px;max-width:calc(100vw - 28px);height:520px;max-height:calc(100vh - 110px);
    background:rgba(6,12,24,0.96);border:1px solid rgba(34,211,238,0.3);border-radius:14px;
    backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
    box-shadow:0 18px 50px rgba(0,0,0,0.6),0 0 40px rgba(34,211,238,0.15);
    display:none;flex-direction:column;overflow:hidden;z-index:9001;
    transform:translateY(10px) scale(0.96);opacity:0;transition:all 0.3s cubic-bezier(.2,.8,.3,1)}
  #ry-panel.on{display:flex;transform:translateY(0) scale(1);opacity:1}
  #ry-panel::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
    background:linear-gradient(90deg,transparent,#22d3ee,#7c3aed,transparent);opacity:0.7}
  .ry-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(34,211,238,0.12);flex-shrink:0}
  .ry-avatar{width:36px;height:36px;border-radius:50%;flex-shrink:0;
    background:radial-gradient(circle at 35% 30%,rgba(220,240,255,0.35),rgba(34,211,238,0.3) 35%,rgba(10,25,50,0.9) 80%);
    box-shadow:0 0 16px rgba(34,211,238,0.3),inset 0 -3px 6px rgba(0,0,0,0.3),inset 0 2px 5px rgba(200,230,255,0.15);
    position:relative}
  .ry-avatar::after{content:'';position:absolute;top:7px;left:11px;width:9px;height:4px;background:rgba(255,255,255,0.3);border-radius:50%;transform:rotate(-20deg);filter:blur(1px)}
  .ry-who{flex:1;min-width:0}
  .ry-who .n{font-family:'Orbitron',sans-serif;font-size:0.72em;font-weight:700;letter-spacing:2px;color:#e0e6f0}
  .ry-who .s{font-family:'Share Tech Mono',monospace;font-size:0.6em;color:#22d3ee;letter-spacing:1px}
  .ry-who .s .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;margin-right:5px;animation:ry-pulse 2s infinite;vertical-align:middle}
  .ry-close{width:24px;height:24px;border-radius:6px;background:none;border:none;color:rgba(160,190,230,0.5);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.2s}
  .ry-close:hover{color:#22d3ee;background:rgba(34,211,238,0.08)}
  .ry-close svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}

  .ry-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
  .ry-msgs::-webkit-scrollbar{width:4px}
  .ry-msgs::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.2);border-radius:2px}

  .ry-bubble{padding:10px 12px;border-radius:12px;font-size:0.8em;line-height:1.45;max-width:88%;
    animation:ry-slide 0.35s cubic-bezier(.2,.8,.3,1)}
  @keyframes ry-slide{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .ry-bubble.dragon{background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.2);color:#e0e6f0;border-bottom-left-radius:3px;align-self:flex-start}
  .ry-bubble.dragon b{color:#22d3ee;font-weight:600}
  .ry-bubble.user{background:linear-gradient(135deg,rgba(124,58,237,0.25),rgba(34,211,238,0.15));border:1px solid rgba(124,58,237,0.3);color:#f0f4ff;border-bottom-right-radius:3px;align-self:flex-end}
  .ry-bubble.sys{background:rgba(74,222,128,0.06);border:1px solid rgba(74,222,128,0.15);color:#86efac;font-size:0.72em;font-family:'Share Tech Mono',monospace;letter-spacing:0.3px}

  .ry-typing{display:flex;gap:3px;padding:10px 14px;align-self:flex-start}
  .ry-typing span{width:6px;height:6px;border-radius:50%;background:#22d3ee;animation:ry-bob 1.1s infinite}
  .ry-typing span:nth-child(2){animation-delay:0.15s}
  .ry-typing span:nth-child(3){animation-delay:0.3s}
  @keyframes ry-bob{0%,80%,100%{transform:translateY(0);opacity:0.3}40%{transform:translateY(-4px);opacity:1}}

  .ry-choices{display:flex;flex-direction:column;gap:5px;padding:0 14px 12px;flex-shrink:0}
  .ry-choice{text-align:left;padding:9px 12px;background:rgba(6,10,20,0.6);border:1px solid rgba(34,211,238,0.18);
    border-radius:9px;color:#e0e6f0;font-family:'Inter',sans-serif;font-size:0.78em;cursor:pointer;transition:all 0.18s;
    display:flex;align-items:center;gap:8px}
  .ry-choice:hover{background:rgba(34,211,238,0.1);border-color:rgba(34,211,238,0.4);transform:translateX(3px);
    box-shadow:0 0 12px rgba(34,211,238,0.15)}
  .ry-choice .key{width:22px;height:22px;border-radius:5px;background:rgba(34,211,238,0.12);border:1px solid rgba(34,211,238,0.3);
    display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;font-size:0.68em;font-weight:800;color:#22d3ee;flex-shrink:0}
  .ry-choice.dismiss .key{color:#a0b6d6}

  .ry-footer{display:flex;gap:6px;padding:10px 12px;border-top:1px solid rgba(34,211,238,0.1);flex-shrink:0;background:rgba(6,10,20,0.4)}
  .ry-input{flex:1;padding:8px 12px;background:rgba(6,10,20,0.6);border:1px solid rgba(34,211,238,0.18);
    border-radius:8px;color:#e0e6f0;font-family:inherit;font-size:0.78em;outline:none}
  .ry-input:focus{border-color:rgba(34,211,238,0.45);box-shadow:0 0 10px rgba(34,211,238,0.15)}
  .ry-input::placeholder{color:rgba(160,190,230,0.35)}
  .ry-send{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,rgba(34,211,238,0.25),rgba(124,58,237,0.15));
    border:1px solid rgba(34,211,238,0.35);color:#22d3ee;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .ry-send svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5}

  /* Embedded mode — renders the chat inline, fills its container */
  .ry-embedded{display:flex;flex-direction:column;height:100%;position:relative;z-index:3}
  .ry-embedded .ry-head{padding:14px 18px;border-bottom:1px solid rgba(34,211,238,0.15);background:rgba(6,12,24,0.55);backdrop-filter:blur(8px)}
  .ry-embedded .ry-head .n{font-size:0.78em}
  .ry-embedded .ry-head .s{font-size:0.65em;margin-top:3px}
  .ry-embedded .ry-avatar{width:42px;height:42px}
  .ry-embedded .ry-msgs{padding:16px 20px;gap:12px;background:transparent}
  .ry-embedded .ry-bubble{font-size:0.88em;line-height:1.5;max-width:82%;padding:12px 15px}
  .ry-embedded .ry-choices{padding:0 18px 12px;gap:7px}
  .ry-embedded .ry-choice{padding:11px 14px;font-size:0.85em;background:rgba(6,10,20,0.55);border-color:rgba(34,211,238,0.22)}
  .ry-embedded .ry-choice .key{width:24px;height:24px;font-size:0.72em}
  .ry-embedded .ry-footer{padding:12px 14px;background:rgba(6,10,20,0.55);border-top:1px solid rgba(34,211,238,0.12)}
  `;

  function injectStyles(){
    if (document.getElementById('ry-styles')) return;
    const s = document.createElement('style');
    s.id = 'ry-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function createDom(){
    const root = document.createElement('div');
    root.id = 'ry-root';
    root.innerHTML = `
      <button id="ry-fab" title="Wake Ryujin"><div class="ry-fab-eye"></div></button>
      <div id="ry-panel">
        <div class="ry-head">
          <div class="ry-avatar"></div>
          <div class="ry-who">
            <div class="n">RYUJIN</div>
            <div class="s"><span class="dot"></span>ACTIVE · <span id="ry-sector-label"></span></div>
          </div>
          <button class="ry-close" id="ry-close-btn" title="Dismiss">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="ry-msgs" id="ry-msgs"></div>
        <div class="ry-choices" id="ry-choices"></div>
        <div class="ry-footer">
          <input class="ry-input" id="ry-input" placeholder="or type a command..."/>
          <button class="ry-send" id="ry-send" title="Send">
            <svg viewBox="0 0 24 24"><polyline points="5 12 12 5 19 12" transform="rotate(90 12 12)"/><line x1="12" y1="19" x2="12" y2="5"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  function createEmbeddedDom(targetSelector){
    const target = document.querySelector(targetSelector);
    if (!target) { console.warn('Ryujin embedTarget not found', targetSelector); createDom(); return; }
    target.classList.add('ry-embedded');
    target.innerHTML = `
      <div class="ry-head">
        <div class="ry-avatar"></div>
        <div class="ry-who">
          <div class="n">RYUJIN <span style="opacity:0.5;font-size:0.8em">\u00B7 SENTINEL</span></div>
          <div class="s"><span class="dot"></span>ACTIVE \u00B7 <span id="ry-sector-label"></span></div>
        </div>
      </div>
      <div class="ry-msgs" id="ry-msgs"></div>
      <div class="ry-choices" id="ry-choices"></div>
      <div class="ry-footer">
        <input class="ry-input" id="ry-input" placeholder="ask Ryujin to handle something..."/>
        <button class="ry-send" id="ry-send" title="Send">
          <svg viewBox="0 0 24 24"><polyline points="5 12 12 5 19 12" transform="rotate(90 12 12)"/><line x1="12" y1="19" x2="12" y2="5"/></svg>
        </button>
      </div>
    `;
  }

  function togglePanel(show){
    const p = document.getElementById('ry-panel');
    if (!p) return;
    if (show === undefined) show = !p.classList.contains('on');
    p.classList.toggle('on', show);
    if (show && !historyStack.length) renderState('root');
  }

  async function renderState(stateKey){
    const state = stateKey === 'root' ? config.root : config.states[stateKey];
    if (!state) return;
    historyStack.push(stateKey);
    const msgsEl = document.getElementById('ry-msgs');
    const choicesEl = document.getElementById('ry-choices');

    // Show typing, then reveal message
    const typing = document.createElement('div');
    typing.className = 'ry-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgsEl.appendChild(typing);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    await wait(state.delay || 500);
    typing.remove();

    if (state.msg) {
      const bubble = document.createElement('div');
      bubble.className = 'ry-bubble dragon';
      bubble.innerHTML = state.msg;
      msgsEl.appendChild(bubble);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    // Execute any side effect (highlight UI, scroll, etc.)
    if (typeof state.effect === 'function') {
      try { state.effect(); } catch (e) { console.warn('ry effect err', e); }
    }
    if (state.sys) {
      const sys = document.createElement('div');
      sys.className = 'ry-bubble sys';
      sys.textContent = '◊ ' + state.sys;
      msgsEl.appendChild(sys);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    // Render choices
    choicesEl.innerHTML = '';
    const choices = state.choices || [];
    choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'ry-choice' + (c.dismiss ? ' dismiss' : '');
      btn.innerHTML = `<span class="key">${i+1}</span><span>${c.text}</span>`;
      btn.addEventListener('click', () => pickChoice(c));
      choicesEl.appendChild(btn);
    });
  }

  // ── Dogfood instrumentation ──
  // Logs every choice the user picks to localStorage + optional endpoint.
  // Reset via Admin → Reset All Tutorials (clears rt_done_ + ry_analytics_).
  function logChoice(choice){
    try {
      const key = 'ry_analytics_log';
      const now = new Date().toISOString();
      const sector = (config && config.sector) || 'UNKNOWN';
      const entry = { ts: now, sector, text: choice.text, next: choice.next || null, dismiss: !!choice.dismiss };
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(entry);
      // Cap at 500 entries
      if (arr.length > 500) arr.shift();
      localStorage.setItem(key, JSON.stringify(arr));
      // Also bump a per-sector counter
      const ckey = 'ry_analytics_counts';
      const craw = localStorage.getItem(ckey);
      const counts = craw ? JSON.parse(craw) : {};
      counts[sector] = (counts[sector] || 0) + 1;
      localStorage.setItem(ckey, JSON.stringify(counts));
    } catch(e){}
  }
  // Public for a future analytics viewer to scrape
  RY.getAnalyticsLog = () => { try { return JSON.parse(localStorage.getItem('ry_analytics_log') || '[]'); } catch(e){ return []; } };
  RY.getAnalyticsCounts = () => { try { return JSON.parse(localStorage.getItem('ry_analytics_counts') || '{}'); } catch(e){ return {}; } };

  function pickChoice(choice){
    logChoice(choice);
    // Log user bubble
    const msgsEl = document.getElementById('ry-msgs');
    const userBubble = document.createElement('div');
    userBubble.className = 'ry-bubble user';
    userBubble.textContent = choice.text;
    msgsEl.appendChild(userBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    if (choice.dismiss) { togglePanel(false); return; }
    if (choice.next === 'back') {
      historyStack.pop(); historyStack.pop();
      renderState(historyStack.pop() || 'root');
      return;
    }
    if (choice.next === 'root') {
      historyStack = [];
      renderState('root');
      return;
    }
    renderState(choice.next);
  }

  function wait(ms){ return new Promise(r => setTimeout(r, ms)); }

  function wireEvents(){
    const fab = document.getElementById('ry-fab');
    if (fab) fab.addEventListener('click', () => togglePanel());
    const closeBtn = document.getElementById('ry-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => togglePanel(false));
    const send = document.getElementById('ry-send');
    if (send) send.addEventListener('click', sendTyped);
    const input = document.getElementById('ry-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });
  }

  function sendTyped(){
    const input = document.getElementById('ry-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const msgsEl = document.getElementById('ry-msgs');
    const userBubble = document.createElement('div');
    userBubble.className = 'ry-bubble user';
    userBubble.textContent = text;
    msgsEl.appendChild(userBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    // Stub response — real LLM later
    setTimeout(() => {
      const bubble = document.createElement('div');
      bubble.className = 'ry-bubble dragon';
      bubble.innerHTML = `Heard you. Free-text commands are coming — for now, pick one of the options below or ask me to navigate somewhere specific.`;
      msgsEl.appendChild(bubble);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }, 600);
  }

  function togglePanelSafe(show){
    // Embedded mode has no FAB panel to toggle; always-on
    if (!document.getElementById('ry-panel')) {
      if (show !== false && !historyStack.length) renderState('root');
      return;
    }
    togglePanel(show);
  }

  RY.init = function(cfg){
    config = cfg;
    historyStack = [];
    injectStyles();
    if (cfg.embedTarget) createEmbeddedDom(cfg.embedTarget);
    else createDom();
    wireEvents();
    const lbl = document.getElementById('ry-sector-label');
    if (lbl) lbl.textContent = (cfg.sector || 'HUB').toUpperCase();
    // Embedded mode is always "open" — render root immediately
    if (cfg.embedTarget) {
      setTimeout(() => renderState('root'), 400);
    } else if (cfg.autoOpen !== false) {
      setTimeout(() => togglePanel(true), 900);
    }
  };

  RY.open = () => togglePanelSafe(true);
  RY.close = () => togglePanelSafe(false);
})();
