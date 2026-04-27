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

  /* Suggestions header — collapse toggle + label. Persisted in localStorage. */
  .ry-sugg-head{display:flex;align-items:center;justify-content:space-between;
    padding:6px 14px 4px;font-family:'Share Tech Mono',monospace;font-size:0.6em;
    letter-spacing:1.5px;color:rgba(160,190,230,0.55);text-transform:uppercase;
    flex-shrink:0;cursor:pointer;user-select:none;transition:color 0.18s}
  .ry-sugg-head:hover{color:#22d3ee}
  .ry-sugg-head .ry-sugg-label{display:flex;align-items:center;gap:6px}
  .ry-sugg-head .ry-sugg-chev{display:inline-block;width:10px;height:10px;
    transition:transform 0.25s;color:rgba(34,211,238,0.55)}
  .ry-sugg-head .ry-sugg-chev svg{width:100%;height:100%;stroke:currentColor;
    fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
  .ry-sugg-wrap.collapsed .ry-sugg-chev{transform:rotate(-90deg)}
  .ry-sugg-wrap.collapsed .ry-choices{display:none}

  .ry-choices{display:flex;flex-direction:column;gap:5px;padding:0 14px 10px;flex-shrink:0;
    max-height:120px;overflow-y:auto}
  .ry-choices::-webkit-scrollbar{width:4px}
  .ry-choices::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.2);border-radius:2px}
  .ry-choices:empty{display:none}
  .ry-choice{text-align:left;padding:7px 10px;background:rgba(6,10,20,0.6);border:1px solid rgba(34,211,238,0.18);
    border-radius:9px;color:#e0e6f0;font-family:'Inter',sans-serif;font-size:0.74em;cursor:pointer;transition:all 0.18s;
    display:flex;align-items:center;gap:8px;flex-shrink:0}
  .ry-choice:hover{background:rgba(34,211,238,0.1);border-color:rgba(34,211,238,0.4);transform:translateX(3px);
    box-shadow:0 0 12px rgba(34,211,238,0.15)}
  .ry-choice .key{width:20px;height:20px;border-radius:5px;background:rgba(34,211,238,0.12);border:1px solid rgba(34,211,238,0.3);
    display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;font-size:0.65em;font-weight:800;color:#22d3ee;flex-shrink:0}
  .ry-choice.dismiss .key{color:#a0b6d6}
  .ry-choice.ry-priority-high{border-color:rgba(248,113,113,0.4);background:rgba(248,113,113,0.05)}
  .ry-choice.ry-priority-high:hover{background:rgba(248,113,113,0.12);border-color:rgba(248,113,113,0.6)}
  .ry-choice.ry-priority-high .key{color:#f87171;background:rgba(248,113,113,0.12);border-color:rgba(248,113,113,0.35)}

  /* Sidebar — slide-in from left, ChatGPT-style chat history */
  .ry-side-toggle{width:28px;height:28px;border-radius:6px;background:none;border:none;
    color:rgba(160,190,230,0.55);cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:all 0.18s;flex-shrink:0}
  .ry-side-toggle:hover{color:#22d3ee;background:rgba(34,211,238,0.08)}
  .ry-side-toggle svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}
  #ry-side{position:absolute;top:0;left:0;width:240px;height:100%;
    background:rgba(4,8,16,0.98);border-right:1px solid rgba(34,211,238,0.18);
    backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
    transform:translateX(-105%);transition:transform 0.3s cubic-bezier(.2,.8,.3,1);
    display:flex;flex-direction:column;overflow:hidden;z-index:5}
  #ry-side.on{transform:translateX(0)}
  #ry-side .ry-side-head{display:flex;align-items:center;justify-content:space-between;
    padding:10px 12px;border-bottom:1px solid rgba(34,211,238,0.1);flex-shrink:0}
  #ry-side .ry-side-head .lbl{font-family:'Orbitron',sans-serif;font-size:0.6em;font-weight:700;
    letter-spacing:2px;color:#e0e6f0;text-transform:uppercase}
  .ry-new-conv{display:flex;align-items:center;gap:6px;margin:8px 10px;padding:7px 10px;
    background:linear-gradient(135deg,rgba(34,211,238,0.18),rgba(124,58,237,0.1));
    border:1px solid rgba(34,211,238,0.3);border-radius:8px;color:#22d3ee;cursor:pointer;
    font-family:'Share Tech Mono',monospace;font-size:0.7em;letter-spacing:1px;
    text-transform:uppercase;transition:all 0.18s;flex-shrink:0}
  .ry-new-conv:hover{background:linear-gradient(135deg,rgba(34,211,238,0.28),rgba(124,58,237,0.15));
    border-color:rgba(34,211,238,0.5);box-shadow:0 0 14px rgba(34,211,238,0.18)}
  .ry-new-conv svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.5;stroke-linecap:round}
  #ry-side-list{flex:1;overflow-y:auto;padding:4px 6px 8px}
  #ry-side-list::-webkit-scrollbar{width:4px}
  #ry-side-list::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.18);border-radius:2px}
  #ry-side-list .empty{padding:10px 14px;font-family:'Share Tech Mono',monospace;font-size:0.65em;
    color:rgba(160,190,230,0.4);letter-spacing:0.5px}
  .ry-conv{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:8px;
    cursor:pointer;color:#d0daf0;transition:background 0.15s;position:relative}
  .ry-conv:hover{background:rgba(34,211,238,0.06)}
  .ry-conv.active{background:rgba(34,211,238,0.12);box-shadow:inset 2px 0 0 #22d3ee}
  .ry-conv .ry-conv-body{flex:1;min-width:0}
  .ry-conv .ry-conv-title{font-size:0.78em;color:#e0e6f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ry-conv .ry-conv-time{font-size:0.6em;color:rgba(160,190,230,0.4);font-family:'Share Tech Mono',monospace;margin-top:2px}
  .ry-conv-del{width:22px;height:22px;border-radius:5px;background:none;border:none;
    color:rgba(160,190,230,0.4);cursor:pointer;display:none;align-items:center;justify-content:center;
    flex-shrink:0;transition:all 0.15s}
  .ry-conv:hover .ry-conv-del{display:flex}
  .ry-conv-del:hover{color:#f87171;background:rgba(248,113,113,0.1)}
  .ry-conv-del svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round}
  /* Mobile: full-width drawer */
  @media (max-width:480px){#ry-side{width:88%}}

  /* Hide the chat fab while the tutor popup is open so SKIP/NEXT
     aren't overlapped on small screens. */
  body:has(#rt-backdrop.on) #ry-root{display:none}

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
        <div id="ry-side">
          <div class="ry-side-head">
            <div class="lbl">History</div>
            <button class="ry-close" id="ry-side-close" title="Close history">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
          <button class="ry-new-conv" id="ry-new-conv" title="Start a new conversation">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            New conversation
          </button>
          <div id="ry-side-list"><div class="empty">Loading history...</div></div>
        </div>
        <div class="ry-head">
          <button class="ry-side-toggle" id="ry-side-toggle" title="Show history">
            <svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
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
        <div class="ry-sugg-wrap" id="ry-sugg-wrap">
          <div class="ry-sugg-head" id="ry-sugg-head" title="Toggle suggestions">
            <span class="ry-sugg-label">Suggestions</span>
            <span class="ry-sugg-chev"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
          </div>
          <div class="ry-choices" id="ry-choices"></div>
        </div>
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
      <div class="ry-sugg-wrap" id="ry-sugg-wrap">
        <div class="ry-sugg-head" id="ry-sugg-head" title="Toggle suggestions">
          <span class="ry-sugg-label">Suggestions</span>
          <span class="ry-sugg-chev"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="ry-choices" id="ry-choices"></div>
      </div>
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
    if (show && !historyStack.length) {
      renderState('root');
      // First-open priorities pulse — fire-and-forget; don't block the panel.
      refreshPriorities({ withGreeting: true });
    }
  }

  // Replaces the priority chips in #ry-choices with a fresh fetch from
  // /api/chat-priorities. Called on first panel-open AND after every assistant
  // turn so the suggestions reflect the current conversation state — no more
  // stale chips from the first message. Silent on failure.
  let lastPrioritiesGreeting = null;
  async function refreshPriorities({ withGreeting } = {}){
    try {
      const r = await fetch('/api/chat-priorities');
      if (!r.ok) return;
      const data = await r.json();

      const msgsEl = document.getElementById('ry-msgs');
      const choicesEl = document.getElementById('ry-choices');
      const wrapEl = document.getElementById('ry-sugg-wrap');
      if (!choicesEl) return;

      // Wipe priority-chips ONLY (state-driven choices live in the same
      // container, but we tag priority chips with .ry-pri so we can scrub them).
      choicesEl.querySelectorAll('.ry-pri').forEach(el => el.remove());

      if (!data.items?.length) {
        // No priorities right now — collapse-the-empty-section logic kicks in
        // via :empty CSS rule on .ry-choices
        return;
      }

      // Surface greeting once on first open (or when it changes)
      if (withGreeting && msgsEl && data.greeting && data.greeting !== lastPrioritiesGreeting) {
        lastPrioritiesGreeting = data.greeting;
        await wait(700);
        const sys = document.createElement('div');
        sys.className = 'ry-bubble sys';
        sys.textContent = '\u25CA Priority pulse \u00B7 ' + data.greeting;
        msgsEl.appendChild(sys);
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }

      // Inject priorities as additional choices. Tapping fills the input
      // with the suggested prompt and submits — same pathway as typed input.
      data.items.forEach((item) => {
        const btn = document.createElement('button');
        btn.className = 'ry-choice ry-pri' + (item.priority === 'high' ? ' ry-priority-high' : '');
        btn.innerHTML = '<span class="key">\u2192</span><span>' + escapeHtml(item.label) + '</span>';
        btn.addEventListener('click', () => {
          const input = document.getElementById('ry-input');
          if (input) { input.value = item.prompt; sendTyped(); }
        });
        choicesEl.appendChild(btn);
      });

      // Respect the persisted collapsed state
      if (wrapEl) wrapEl.classList.toggle('collapsed', getSuggCollapsed());
    } catch (e) {
      // silent — priorities are an enhancement, not a hard requirement
    }
  }

  // Persisted collapse state for the suggestions panel
  function getSuggCollapsed(){
    try { return localStorage.getItem('ry_suggestions_collapsed') === '1'; } catch { return false; }
  }
  function setSuggCollapsed(v){
    try { localStorage.setItem('ry_suggestions_collapsed', v ? '1' : '0'); } catch {}
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

  // Conversation history for free-text chat with the brain.
  // Declared early so persistConversationTurn / loadConversationById /
  // startNewConversation can mutate it without TDZ risk.
  let chatHistory = [];

  // ── Conversation persistence (ChatGPT-style sidebar) ──
  // The widget calls /api/chat-conversations to save/load history. Until
  // migration_021 is applied the endpoint 500s — we fail silent so the chat
  // still works without the sidebar.
  let currentConversationId = null;
  try { currentConversationId = localStorage.getItem('ry_conv_id') || null; } catch {}

  function setCurrentConvId(id){
    currentConversationId = id || null;
    try {
      if (id) localStorage.setItem('ry_conv_id', id);
      else localStorage.removeItem('ry_conv_id');
    } catch {}
  }

  // Build a 4-6 word title from the first user message — no Haiku call,
  // just truncate. Saves a token call per new conversation.
  function deriveTitle(firstUserMessage){
    const text = String(firstUserMessage || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'New conversation';
    const words = text.split(' ').slice(0, 6).join(' ');
    return words.length > 60 ? words.slice(0, 60) + '...' : words;
  }

  function relativeTime(iso){
    if (!iso) return '';
    const t = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - t);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d === 1) return 'Yesterday';
    if (d < 7) return d + 'd ago';
    const date = new Date(iso);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function persistConversationTurn(){
    // chatHistory holds the full turn list (user + assistant alternating)
    // Skip persistence if we don't have at least 1 user + 1 assistant turn
    if (chatHistory.length < 2) return;
    try {
      const body = {
        id: currentConversationId || undefined,
        title: currentConversationId ? undefined : deriveTitle(chatHistory.find(m => m.role === 'user')?.content),
        messages: chatHistory,
      };
      const r = await fetch('/api/chat-conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) return; // Silent — migration may not be applied yet
      const saved = await r.json();
      if (saved && saved.id) setCurrentConvId(saved.id);
    } catch {}
  }

  async function loadConversationsList(){
    const list = document.getElementById('ry-side-list');
    if (!list) return;
    list.innerHTML = '<div class="empty">Loading...</div>';
    try {
      const r = await fetch('/api/chat-conversations');
      if (!r.ok) {
        // Migration not applied or auth failure — show graceful fallback
        list.innerHTML = '<div class="empty">History will appear here once enabled.</div>';
        return;
      }
      const data = await r.json();
      const convs = (data && Array.isArray(data.conversations)) ? data.conversations : [];
      if (!convs.length) {
        list.innerHTML = '<div class="empty">No conversations yet.</div>';
        return;
      }
      list.innerHTML = '';
      convs.forEach(c => list.appendChild(renderConvRow(c)));
    } catch {
      list.innerHTML = '<div class="empty">History unavailable.</div>';
    }
  }

  function renderConvRow(c){
    const row = document.createElement('div');
    row.className = 'ry-conv';
    if (c.id === currentConversationId) row.classList.add('active');
    row.innerHTML =
      '<div class="ry-conv-body">' +
        '<div class="ry-conv-title">' + escapeHtml(c.title || 'Untitled') + '</div>' +
        '<div class="ry-conv-time">' + escapeHtml(relativeTime(c.updated_at || c.created_at)) + '</div>' +
      '</div>' +
      '<button class="ry-conv-del" title="Delete">' +
        '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>' +
      '</button>';
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ry-conv-del')) return;
      loadConversationById(c.id);
    });
    const del = row.querySelector('.ry-conv-del');
    if (del) del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      deleteConversation(c.id);
    });
    return row;
  }

  async function loadConversationById(id){
    try {
      const r = await fetch('/api/chat-conversations?id=' + encodeURIComponent(id));
      if (!r.ok) return;
      const conv = await r.json();
      if (!conv || !Array.isArray(conv.messages)) return;
      // Hydrate chat
      chatHistory = conv.messages.slice();
      setCurrentConvId(conv.id);
      const msgsEl = document.getElementById('ry-msgs');
      const choicesEl = document.getElementById('ry-choices');
      if (msgsEl) msgsEl.innerHTML = '';
      if (choicesEl) choicesEl.innerHTML = '';
      lastPrioritiesGreeting = null;
      conv.messages.forEach(m => {
        if (!m || !m.content) return;
        const bubble = document.createElement('div');
        bubble.className = 'ry-bubble ' + (m.role === 'user' ? 'user' : 'dragon');
        bubble.textContent = m.content;
        msgsEl.appendChild(bubble);
      });
      if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
      // Refresh sidebar active highlight + priorities
      const side = document.getElementById('ry-side');
      if (side) side.classList.remove('on');
      refreshPriorities({ withGreeting: false });
    } catch {}
  }

  async function deleteConversation(id){
    try {
      const r = await fetch('/api/chat-conversations?id=' + encodeURIComponent(id), { method: 'DELETE' });
      if (!r.ok) return;
      if (id === currentConversationId) startNewConversation();
      loadConversationsList();
    } catch {}
  }

  function startNewConversation(){
    chatHistory = [];
    setCurrentConvId(null);
    const msgsEl = document.getElementById('ry-msgs');
    const choicesEl = document.getElementById('ry-choices');
    if (msgsEl) msgsEl.innerHTML = '';
    if (choicesEl) choicesEl.innerHTML = '';
    historyStack = [];
    lastPrioritiesGreeting = null;
    renderState('root');
    refreshPriorities({ withGreeting: true });
    const side = document.getElementById('ry-side');
    if (side) side.classList.remove('on');
  }

  function wireEvents(){
    const fab = document.getElementById('ry-fab');
    if (fab) fab.addEventListener('click', () => togglePanel());
    const closeBtn = document.getElementById('ry-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => togglePanel(false));
    const send = document.getElementById('ry-send');
    if (send) send.addEventListener('click', sendTyped);
    const input = document.getElementById('ry-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });

    // Suggestions collapse toggle — persists across sessions
    const sugHead = document.getElementById('ry-sugg-head');
    const sugWrap = document.getElementById('ry-sugg-wrap');
    if (sugHead && sugWrap) {
      // Apply persisted state on load
      sugWrap.classList.toggle('collapsed', getSuggCollapsed());
      sugHead.addEventListener('click', () => {
        const next = !sugWrap.classList.contains('collapsed');
        sugWrap.classList.toggle('collapsed', next);
        setSuggCollapsed(next);
      });
    }

    // Sidebar (history) — only present on the FAB panel, not in embedded mode
    const sideToggle = document.getElementById('ry-side-toggle');
    const sideClose = document.getElementById('ry-side-close');
    const sidePanel = document.getElementById('ry-side');
    const newConv = document.getElementById('ry-new-conv');
    if (sideToggle && sidePanel) {
      sideToggle.addEventListener('click', () => {
        const next = !sidePanel.classList.contains('on');
        sidePanel.classList.toggle('on', next);
        if (next) loadConversationsList();
      });
    }
    if (sideClose && sidePanel) {
      sideClose.addEventListener('click', () => sidePanel.classList.remove('on'));
    }
    if (newConv) {
      newConv.addEventListener('click', () => startNewConversation());
    }
  }

  async function sendTyped(){
    const input = document.getElementById('ry-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const msgsEl = document.getElementById('ry-msgs');

    // User bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'ry-bubble user';
    userBubble.textContent = text;
    msgsEl.appendChild(userBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Capture PRIOR history (don't include current message — it goes in `message`)
    const historyToSend = chatHistory.slice(-10);
    chatHistory.push({ role: 'user', content: text });

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'ry-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgsEl.appendChild(typing);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyToSend, conversation_id: currentConversationId || undefined })
      });
      typing.remove();

      if (!resp.ok || !resp.body) {
        const err = document.createElement('div');
        err.className = 'ry-bubble dragon';
        err.textContent = `Signal lost (HTTP ${resp.status}). Try again.`;
        msgsEl.appendChild(err);
        return;
      }

      const bubble = document.createElement('div');
      bubble.className = 'ry-bubble dragon';
      msgsEl.appendChild(bubble);
      let assembled = '';
      let toolBubble = null;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let data;
          try { data = JSON.parse(raw); } catch { continue; }

          if (data.text) {
            assembled += data.text;
            bubble.textContent = assembled;
          } else if (data.tool_start) {
            toolBubble = document.createElement('div');
            toolBubble.className = 'ry-bubble sys';
            toolBubble.textContent = '◊ ' + (data.tool_start.label || 'Running tool...');
            msgsEl.insertBefore(toolBubble, bubble);
          } else if (data.tool_end) {
            if (toolBubble) {
              if (data.tool_end.status === 'error') {
                toolBubble.textContent = '⚠ ' + toolBubble.textContent.replace(/^◊ /, '') + ' (failed)';
              } else {
                toolBubble.remove();
                toolBubble = null;
              }
            }
          }
          msgsEl.scrollTop = msgsEl.scrollHeight;
        }
      }

      if (assembled) {
        chatHistory.push({ role: 'assistant', content: assembled });
        // Persist conversation + refresh priorities for the next turn — fire and forget
        persistConversationTurn();
        refreshPriorities({ withGreeting: false });
      } else {
        bubble.textContent = 'No response.';
      }
    } catch (e) {
      typing.remove();
      const err = document.createElement('div');
      err.className = 'ry-bubble dragon';
      err.textContent = 'Connection interrupted. Standing by.';
      msgsEl.appendChild(err);
    }
  }

  function togglePanelSafe(show){
    // Embedded mode has no FAB panel to toggle; always-on
    if (!document.getElementById('ry-panel')) {
      if (show !== false && !historyStack.length) renderState('root');
      return;
    }
    togglePanel(show);
  }

  // Default greeting for pages that don't define a sector menu — the brain
  // takes over once the user starts typing.
  const DEFAULT_ROOT = {
    msg: "I'm Ryujin. Ask me anything — quotes, tickets, leads, ads, today's priorities.",
    choices: []
  };

  // Global opt-out: localStorage 'ry_chat_off' = '1' suppresses the fab on
  // every page. Mac can re-enable from the command center HUD or by clearing
  // the flag in browser storage.
  function chatDisabled(){
    try { return localStorage.getItem('ry_chat_off') === '1'; } catch { return false; }
  }
  RY.disable = function(){
    try { localStorage.setItem('ry_chat_off', '1'); } catch {}
    const root = document.getElementById('ry-root');
    if (root) root.remove();
    config = null;
  };
  RY.enable = function(){
    try { localStorage.removeItem('ry_chat_off'); } catch {}
    if (!config) RY.init({ sector: document.body.dataset.rySector || 'HUB', autoOpen: false });
  };
  RY.isDisabled = chatDisabled;

  RY.init = function(cfg){
    if (chatDisabled()) return;

    cfg = cfg || {};
    if (!cfg.root) cfg.root = DEFAULT_ROOT;
    if (!cfg.states) cfg.states = {};
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

  // Auto-init fallback: if a page includes this script but never calls
  // Ryujin.init() (e.g. mounted globally on operational pages), bootstrap
  // a minimal chat fab so the brain is one tap away from anywhere.
  // Waits for the command-center entry cutscene (#entry-mark) to finish so
  // the fab doesn't pop in over the wordmark animation.
  document.addEventListener('DOMContentLoaded', () => {
    const cutscene = document.getElementById('entry-mark');
    const delay = cutscene ? 3200 : 200;
    setTimeout(() => {
      if (!config && !chatDisabled()) RY.init({ sector: document.body.dataset.rySector || 'HUB', autoOpen: false });
    }, delay);
  });

  RY.open = () => togglePanelSafe(true);
  RY.close = () => togglePanelSafe(false);
})();
