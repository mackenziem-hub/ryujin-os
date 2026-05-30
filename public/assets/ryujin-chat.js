// ────────────────────────────────────────────────────────────────────
// Ryujin Dragon Chatbot — shared widget
// Each sector page calls Ryujin.init({ sector, states }) with its content.
// ────────────────────────────────────────────────────────────────────
(function(){
  const RY = window.Ryujin = window.Ryujin || {};
  let config = null;
  let historyStack = [];
  // Tracks the archetype locked for the current Agent Mode session (sticky route).
  let lockedAgentArchetype = null;

  // Voice-mode is OPT-IN ONLY (May 7 2026). The auto-load + auto-speak combo
  // was hijacking sessions: every chat reply auto-spoke, full-screen overlay
  // covered the page, hitting "stop" felt like context loss. Now:
  //   - voice-mode.js is loaded lazily, only when the user explicitly clicks
  //     the speaker icon
  //   - auto-speak is forced OFF on every page load (legacy localStorage flag
  //     reset) — user must opt in per session via the speaker toggle
  try { localStorage.setItem('ryujin_auto_speak', '0'); } catch(e){}
  function ensureVoiceModeLoaded(){
    return new Promise((resolve) => {
      if (window.RyujinVoiceMode) return resolve(true);
      const existing = document.querySelector('script[data-ry-voice]');
      if (existing) {
        existing.addEventListener('load', () => resolve(!!window.RyujinVoiceMode));
        return;
      }
      const s = document.createElement('script');
      s.src = '/assets/voice-mode.js';
      s.async = true;
      s.dataset.ryVoice = '1';
      s.addEventListener('load', () => resolve(!!window.RyujinVoiceMode));
      s.addEventListener('error', () => resolve(false));
      document.head.appendChild(s);
    });
  }

  const STYLES = `
  #ry-root{position:fixed;bottom:14px;right:14px;z-index:9000;font-family:'Inter',system-ui,sans-serif}
  #ry-fab{width:62px;height:62px;border-radius:50%;
    background:#040d22 url('/assets/branding/orb.jpg') center/cover;
    border:2px solid rgba(34,211,238,0.5);
    box-shadow:0 6px 24px rgba(0,0,0,0.5),0 0 28px rgba(34,211,238,0.4);
    cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;
    transition:all 0.25s}
  #ry-fab .ry-fab-eye{display:none}
  #ry-fab:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 8px 30px rgba(0,0,0,0.5),0 0 40px rgba(34,211,238,0.55)}
  #ry-fab.pressing::before{content:'';position:absolute;inset:-4px;border-radius:50%;
    border:2px solid rgba(34,211,238,0.8);border-top-color:transparent;
    animation:ry-ring 0.6s linear forwards;pointer-events:none;z-index:1}
  @keyframes ry-ring{from{transform:rotate(0);opacity:0.9}to{transform:rotate(360deg);opacity:0.4}}
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
  /* Phase 12: full-screen chat takeover */
  #ry-panel.fullscreen{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:100vw!important;max-height:100vh!important;border-radius:0!important;z-index:9100}
  #ry-panel.fullscreen .ry-msgs{padding:24px 28px;gap:14px}
  #ry-panel.fullscreen .ry-bubble{max-width:780px;font-size:0.95em;line-height:1.55;padding:14px 18px}
  #ry-panel.fullscreen .ry-footer{padding:14px 20px}
  #ry-panel.fullscreen .ry-input{padding:12px 16px;font-size:0.95em}
  #ry-panel.fullscreen .ry-msgs > *{align-self:flex-start;width:100%;max-width:780px;margin-left:auto;margin-right:auto}
  #ry-panel.fullscreen .ry-bubble.user{align-self:flex-end!important}
  .ry-fullscreen-btn{background:none;border:none;color:rgba(160,200,240,0.5);cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center}
  .ry-fullscreen-btn:hover{color:#22d3ee}
  .ry-fullscreen-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}
  /* Phase 6: voice + persona controls */
  .ry-icon-btn{width:32px;height:32px;border-radius:8px;border:1px solid rgba(34,211,238,0.18);background:rgba(6,10,20,0.6);color:rgba(160,200,240,0.7);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s}
  .ry-icon-btn:hover{border-color:rgba(34,211,238,0.45);color:#22d3ee}
  .ry-icon-btn.active{border-color:rgba(74,222,128,0.6);color:#4ade80;background:rgba(74,222,128,0.08)}
  .ry-icon-btn.listening{border-color:rgba(248,113,113,0.6);color:#f87171;animation:ry-mic-pulse 1.2s infinite}
  .ry-icon-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}
  @keyframes ry-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.5)}50%{box-shadow:0 0 0 6px rgba(248,113,113,0)}}
  .ry-persona-modal{position:absolute;inset:0;background:rgba(6,12,24,0.97);z-index:10;padding:14px;display:none;flex-direction:column;gap:10px;overflow-y:auto;backdrop-filter:blur(8px)}
  .ry-persona-modal.on{display:flex}
  .ry-persona-modal h3{margin:0;color:#22d3ee;font-size:0.9em;letter-spacing:0.5px;text-transform:uppercase}
  .ry-persona-modal label{font-size:0.7em;color:rgba(160,200,240,0.6);letter-spacing:0.4px;text-transform:uppercase;margin-top:6px}
  .ry-persona-modal input,.ry-persona-modal textarea{width:100%;background:rgba(6,10,20,0.8);border:1px solid rgba(34,211,238,0.2);color:#e0e6f0;border-radius:6px;padding:8px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box}
  .ry-persona-modal textarea{min-height:80px;resize:vertical}
  .ry-persona-modal-actions{display:flex;gap:8px;margin-top:8px}
  .ry-persona-modal-actions button{flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(34,211,238,0.3);background:linear-gradient(135deg,rgba(34,211,238,0.18),rgba(124,58,237,0.1));color:#e0e6f0;cursor:pointer;font-size:0.8em;font-family:inherit}
  .ry-persona-modal-actions button.cancel{background:rgba(6,10,20,0.6);border-color:rgba(160,200,240,0.2)}
  .ry-persona-modal-note{font-size:0.7em;color:rgba(160,200,240,0.5);font-style:italic;margin-top:4px}
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

  /* Mode + Effort picker */
  #ry-picker{position:fixed;inset:0;z-index:9100;display:none;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at center,rgba(8,16,38,0.85),rgba(2,4,12,0.92));
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);cursor:pointer}
  #ry-picker .ry-pick-card{cursor:default}
  #ry-picker.on{display:flex;animation:ry-pick-fade 0.25s ease}
  @keyframes ry-pick-fade{from{opacity:0}to{opacity:1}}
  .ry-pick-card{width:340px;max-width:calc(100vw - 28px);
    background:linear-gradient(160deg,rgba(10,20,40,0.96),rgba(6,12,24,0.96));
    border:1px solid rgba(34,211,238,0.28);border-radius:18px;padding:18px 16px 16px;
    box-shadow:0 20px 60px rgba(0,0,0,0.65),0 0 50px rgba(34,211,238,0.18);
    animation:ry-pick-pop 0.35s cubic-bezier(0.16,1,0.3,1)}
  @keyframes ry-pick-pop{from{opacity:0;transform:translateY(12px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  .ry-pick-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .ry-pick-head .ry-pick-icon{width:36px;height:36px;border-radius:50%;
    background:#040d22 url('/assets/branding/orb.jpg') center/cover;
    border:1px solid rgba(34,211,238,0.5);box-shadow:0 0 14px rgba(34,211,238,0.4)}
  .ry-pick-head .ry-pick-title{flex:1;font-family:'Orbitron',sans-serif;font-size:0.78em;letter-spacing:1.6px;color:#e0e6f0;font-weight:700}
  .ry-pick-head .ry-pick-sub{font-family:'Share Tech Mono',monospace;font-size:0.6em;color:#22d3ee;letter-spacing:1px}
  .ry-pick-close{width:26px;height:26px;border-radius:7px;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.18);
    color:#a0b6d6;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:0.95em}
  .ry-pick-close:hover{color:#22d3ee;background:rgba(34,211,238,0.14)}
  .ry-pick-tiles{display:flex;flex-direction:column;gap:8px}
  .ry-pick-tile{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:13px;cursor:pointer;
    background:rgba(8,16,32,0.7);border:1px solid rgba(34,211,238,0.18);text-align:left;
    transition:all 0.2s;font-family:inherit;color:#e0e6f0}
  .ry-pick-tile:hover{background:rgba(34,211,238,0.08);border-color:rgba(34,211,238,0.45);transform:translateX(2px)}
  .ry-pick-tile.last{border-color:rgba(34,211,238,0.6);box-shadow:0 0 18px rgba(34,211,238,0.25);background:rgba(34,211,238,0.07)}
  .ry-pick-tile .ico{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,rgba(34,211,238,0.18),rgba(124,58,237,0.12));border:1px solid rgba(34,211,238,0.25);
    color:#22d3ee;flex-shrink:0}
  .ry-pick-tile .ico svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .ry-pick-tile .txt{flex:1;min-width:0}
  .ry-pick-tile .t{font-family:'Orbitron',sans-serif;font-size:0.78em;font-weight:700;letter-spacing:0.8px;color:#e0e6f0}
  .ry-pick-tile .s{font-size:0.7em;color:rgba(160,190,230,0.65);margin-top:2px;font-family:'Inter',sans-serif}
  .ry-pick-back{margin-top:10px;padding:7px 10px;border-radius:8px;background:none;border:none;
    color:rgba(160,190,230,0.55);font-family:'Share Tech Mono',monospace;font-size:0.65em;letter-spacing:1px;cursor:pointer}
  .ry-pick-back:hover{color:#22d3ee}

  /* Mode chip in panel head */
  .ry-mode-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:10px;
    background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.25);
    font-family:'Share Tech Mono',monospace;font-size:0.55em;letter-spacing:0.8px;color:#22d3ee;
    cursor:pointer;text-transform:uppercase}
  .ry-mode-chip:hover{background:rgba(34,211,238,0.2)}
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
      <div id="ry-picker">
        <div class="ry-pick-card" id="ry-pick-card"></div>
      </div>
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
          <button class="ry-fullscreen-btn" id="ry-fullscreen-btn" title="Expand to full screen">
            <svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
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
          <button class="ry-icon-btn" id="ry-mic" title="Voice input (talk to chat)">
            <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <button class="ry-icon-btn" id="ry-speak-toggle" title="Auto-speak AI responses">
            <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
          <button class="ry-icon-btn" id="ry-attach" title="Attach files (photos, EagleView PDF, competitor quote)">
            <svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          </button>
          <input type="file" id="ry-file-input" multiple accept="image/*,application/pdf,.pdf,.txt,.csv,.md,.docx,.xlsx" style="display:none">
          <input class="ry-input" id="ry-input" placeholder="or type a command..."/>
          <button class="ry-send" id="ry-send" title="Send">
            <svg viewBox="0 0 24 24"><polyline points="5 12 12 5 19 12" transform="rotate(90 12 12)"/><line x1="12" y1="19" x2="12" y2="5"/></svg>
          </button>
        </div>
        <div class="ry-persona-modal" id="ry-persona-modal">
          <h3>AI Persona &amp; Archetype</h3>
          <div class="ry-persona-modal-note">Pick your default archetype lens (the AI's voice/style for your role). You can shift mid-conversation by typing /zeus or /hermes etc. before any message.</div>
          <label for="ry-archetype">Default archetype</label>
          <select id="ry-archetype" style="width:100%;background:rgba(6,10,20,0.8);border:1px solid rgba(34,211,238,0.2);color:#e0e6f0;border-radius:6px;padding:8px 10px;font-size:0.85em;font-family:inherit">
            <option value="ruler">Zeus, Ruler (strategy + governance)</option>
            <option value="caregiver">Hestia, Caregiver (ops + customer care)</option>
            <option value="hero">Hermes, Hero (sales + closing)</option>
            <option value="creator">Hephaestus, Creator (production + build)</option>
            <option value="sage">Athena, Sage (knowledge + analysis)</option>
            <option value="magician">Hecate, Magician (tech + transformation)</option>
            <option value="explorer">Artemis, Explorer (marketing + frontier)</option>
            <option value="jester">Apollo, Jester (creative + light)</option>
            <option value="lover">Aphrodite, Lover (relationships + brand)</option>
            <option value="innocent">Persephone, Innocent (onboarding + fresh start)</option>
            <option value="everyman">Hercules, Everyman (relatable + grounded)</option>
            <option value="outlaw">Prometheus, Outlaw (disruption + challenger)</option>
          </select>
          <label for="ry-persona-name">Custom name (optional)</label>
          <input type="text" id="ry-persona-name" placeholder="leave blank to use the archetype default"/>
          <label for="ry-persona-style">Custom personality (optional)</label>
          <textarea id="ry-persona-style" placeholder="leave blank for archetype default voice. Add notes here only if you want to layer on top."></textarea>
          <div class="ry-persona-modal-actions">
            <button class="cancel" id="ry-persona-cancel">Cancel</button>
            <button id="ry-persona-save">Save</button>
          </div>
          <div class="ry-persona-modal-note" id="ry-persona-status"></div>
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
        <button class="ry-icon-btn" id="ry-mic" title="Voice input">
          <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <button class="ry-icon-btn" id="ry-speak-toggle" title="Auto-speak AI responses">
          <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        </button>
        <button class="ry-icon-btn" id="ry-attach" title="Attach files (photos, EagleView PDF, competitor quote)">
          <svg viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        </button>
        <input type="file" id="ry-file-input" multiple accept="image/*,application/pdf,.pdf,.txt,.csv,.md,.docx,.xlsx" style="display:none">
        <input class="ry-input" id="ry-input" placeholder="ask Ryujin to handle something..."/>
        <button class="ry-send" id="ry-send" title="Send">
          <svg viewBox="0 0 24 24"><polyline points="5 12 12 5 19 12" transform="rotate(90 12 12)"/><line x1="12" y1="19" x2="12" y2="5"/></svg>
        </button>
      </div>
    `;
  }

  // ── Mode + Effort picker ───────────────────────────────────────────
  const MODE_TILES = [
    { slug: 'quick',  title: 'Quick Reply',  sub: 'Instant text answers',
      svg: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
    { slug: 'speech', title: 'Speech Mode',  sub: 'Voice conversation',
      svg: '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>' },
    { slug: 'agent',  title: 'Agent Mode',   sub: 'Full AI agent with tools',
      svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' }
  ];
  const EFFORT_TILES = [
    { slug: 'low',    title: 'Low',    sub: 'Quick lookup · cheapest' },
    { slug: 'medium', title: 'Medium', sub: 'Standard answer · default' },
    { slug: 'high',   title: 'High',   sub: 'Educated opinion · deep reasoning' }
  ];
  function getLastMode(){ try { return localStorage.getItem('ryujin_last_mode') || 'quick'; } catch { return 'quick'; } }
  function getLastEffort(){
    try {
      const arch = localStorage.getItem('ryujin_archetype');
      if (arch) {
        const map = JSON.parse(localStorage.getItem('ryujin_archetype_effort') || '{}');
        if (map[arch]) return map[arch];
      }
      return localStorage.getItem('ryujin_last_effort') || 'medium';
    } catch { return 'medium'; }
  }
  function setLastMode(m){ try { localStorage.setItem('ryujin_last_mode', m); } catch {} }
  function setLastEffort(e){ try { localStorage.setItem('ryujin_last_effort', e); } catch {} }

  function renderModeCard(){
    const last = getLastMode();
    const card = document.getElementById('ry-pick-card');
    if (!card) return;
    card.innerHTML = `
      <div class="ry-pick-head">
        <div class="ry-pick-icon"></div>
        <div style="flex:1">
          <div class="ry-pick-title">RYUJIN AI</div>
          <div class="ry-pick-sub">choose mode</div>
        </div>
        <button class="ry-pick-close" id="ry-pick-x">&times;</button>
      </div>
      <div class="ry-pick-tiles" id="ry-mode-tiles">
        ${MODE_TILES.map(t => `
          <button class="ry-pick-tile ${t.slug===last?'last':''}" data-mode="${t.slug}">
            <div class="ico">${t.svg}</div>
            <div class="txt"><div class="t">${t.title}</div><div class="s">${t.sub}</div></div>
          </button>`).join('')}
      </div>`;
    card.querySelector('#ry-pick-x').onclick = closePicker;
    card.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => renderEffortCard(btn.dataset.mode);
    });
  }
  function renderEffortCard(mode){
    const last = getLastEffort();
    const card = document.getElementById('ry-pick-card');
    if (!card) return;
    const modeMeta = MODE_TILES.find(t => t.slug === mode);
    card.innerHTML = `
      <div class="ry-pick-head">
        <div class="ry-pick-icon"></div>
        <div style="flex:1">
          <div class="ry-pick-title">${modeMeta.title.toUpperCase()}</div>
          <div class="ry-pick-sub">choose effort</div>
        </div>
        <button class="ry-pick-close" id="ry-pick-x">&times;</button>
      </div>
      <div class="ry-pick-tiles" id="ry-effort-tiles">
        ${EFFORT_TILES.map(t => `
          <button class="ry-pick-tile ${t.slug===last?'last':''}" data-effort="${t.slug}">
            <div class="ico"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
            <div class="txt"><div class="t">${t.title}</div><div class="s">${t.sub}</div></div>
          </button>`).join('')}
      </div>
      <button class="ry-pick-back" id="ry-pick-back">← back to mode</button>`;
    card.querySelector('#ry-pick-x').onclick = closePicker;
    card.querySelector('#ry-pick-back').onclick = renderModeCard;
    card.querySelectorAll('[data-effort]').forEach(btn => {
      btn.onclick = () => {
        setLastMode(mode);
        setLastEffort(btn.dataset.effort);
        closePicker();
        dispatchMode(mode, btn.dataset.effort);
      };
    });
  }
  function openPicker(){
    const p = document.getElementById('ry-picker');
    if (!p) return;
    renderModeCard();
    p.classList.add('on');
    if (!p._wired) {
      p._wired = true;
      // Click outside the card closes the picker
      p.addEventListener('click', (e) => { if (e.target === p) closePicker(); });
      // Escape key closes the picker
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && p.classList.contains('on')) closePicker();
      });
    }
  }
  function closePicker(){
    const p = document.getElementById('ry-picker');
    if (p) p.classList.remove('on');
  }
  function updateModeChip(){
    const head = document.querySelector('#ry-panel .ry-head');
    if (!head) return;
    let chip = document.getElementById('ry-mode-chip');
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'ry-mode-chip';
      chip.className = 'ry-mode-chip';
      chip.title = 'Change mode + effort';
      chip.onclick = openPicker;
      const closeBtn = head.querySelector('#ry-close-btn') || head.querySelector('.ry-close');
      head.insertBefore(chip, closeBtn);
    }
    const m = MODE_TILES.find(t => t.slug === getLastMode());
    const label = `${(m?.title || 'Quick').replace(' Mode','').replace(' Reply','')} · ${getLastEffort()}`;
    chip.innerHTML = `<span style="display:inline-flex;align-items:center;width:11px;height:11px;margin-right:5px;color:#22d3ee">${m?.svg || ''}</span>${label}`;
    chip.querySelectorAll('svg').forEach(s => s.setAttribute('style', 'width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round'));
  }
  function dispatchMode(mode, effort){
    if (mode === 'speech') {
      if (window.RyujinVoiceMode && window.RyujinVoiceMode.enter) {
        const archetype = (function(){ try { return JSON.parse(localStorage.getItem('ryujin_persona')||'{}').archetype || null; } catch { return null; } })();
        window.RyujinVoiceMode.enter(
          archetype,
          () => { try { window.RyujinVoiceMode.hide(); } catch {} },
          (transcript) => {
            const input = document.getElementById('ry-input');
            if (input && transcript) { input.value = transcript; sendTyped(); }
          }
        );
        togglePanel(true);
        updateModeChip();
        return;
      }
    }
    if (mode === 'agent') {
      if (window.RyujinVoiceMode && window.RyujinVoiceMode.enterAgentMode) {
        lockedAgentArchetype = null; // fresh agent session
        window.RyujinVoiceMode.enterAgentMode(
          () => { lockedAgentArchetype = null; try { window.RyujinVoiceMode.hide(); } catch {} },
          (transcript) => {
            const input = document.getElementById('ry-input');
            if (input && transcript) { input.value = transcript; sendTyped(); }
          }
        );
        togglePanel(true);
        updateModeChip();
        return;
      }
    }
    togglePanel(true);
    updateModeChip();
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
    if (show) updateModeChip();
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

  // Auth headers for the now session-gated /api/chat-conversations.
  function convHeaders(json){
    var t = (typeof localStorage !== 'undefined' && localStorage.getItem('ryujin_token')) || '';
    var h = {}; if (json) h['Content-Type'] = 'application/json'; if (t) h.Authorization = 'Bearer ' + t; return h;
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
        headers: convHeaders(true),
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
      const r = await fetch('/api/chat-conversations', { headers: convHeaders() });
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
      const r = await fetch('/api/chat-conversations?id=' + encodeURIComponent(id), { headers: convHeaders() });
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
      const r = await fetch('/api/chat-conversations?id=' + encodeURIComponent(id), { method: 'DELETE', headers: convHeaders() });
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
    if (fab) {
      let pressTimer = null;
      let longPressed = false;
      const startPress = (e) => {
        longPressed = false;
        fab.classList.add('pressing');
        pressTimer = setTimeout(() => {
          longPressed = true;
          fab.classList.remove('pressing');
          dispatchMode(getLastMode(), getLastEffort());
        }, 600);
      };
      const endPress = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; fab.classList.remove('pressing'); };
      fab.addEventListener('mousedown', startPress);
      fab.addEventListener('touchstart', startPress, { passive: true });
      fab.addEventListener('mouseup', endPress);
      fab.addEventListener('mouseleave', endPress);
      fab.addEventListener('touchend', endPress);
      fab.addEventListener('click', () => {
        if (longPressed) { longPressed = false; return; }
        const panel = document.getElementById('ry-panel');
        if (panel && panel.classList.contains('on')) { togglePanel(false); return; }
        openPicker();
      });
    }
    const closeBtn = document.getElementById('ry-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => togglePanel(false));
    // Phase 12: full-screen toggle
    const fsBtn = document.getElementById('ry-fullscreen-btn');
    if (fsBtn) fsBtn.addEventListener('click', () => {
      const panel = document.getElementById('ry-panel');
      if (!panel) return;
      panel.classList.toggle('fullscreen');
      const isFs = panel.classList.contains('fullscreen');
      fsBtn.title = isFs ? 'Restore corner view' : 'Expand to full screen';
      // Swap icon for collapse when in fullscreen
      fsBtn.innerHTML = isFs
        ? '<svg viewBox="0 0 24 24"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
        : '<svg viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
    });
    const send = document.getElementById('ry-send');
    if (send) send.addEventListener('click', sendTyped);

    // Paperclip → file picker
    const attachBtn = document.getElementById('ry-attach');
    const fileInput = document.getElementById('ry-file-input');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', e => {
        if (e.target.files?.length) uploadFiles(e.target.files);
        e.target.value = '';
      });
    }
    // Paste image into input
    const inputEl = document.getElementById('ry-input');
    if (inputEl) {
      inputEl.addEventListener('paste', e => {
        const items = e.clipboardData?.items || [];
        const files = [];
        for (const it of items) {
          if (it.kind === 'file') {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length) { e.preventDefault(); uploadFiles(files); }
      });
    }
    // Drag-drop on chat panel
    const panel = document.getElementById('ry-panel') || document.querySelector('.ry-embedded') || document.body;
    let dragDepth = 0;
    let dropOverlay = null;
    const showOverlay = () => {
      if (dropOverlay) return;
      dropOverlay = document.createElement('div');
      dropOverlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,12,24,0.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;color:#9be7ff;font-family:Orbitron,monospace;font-size:1.3em;font-weight:700;letter-spacing:2px;pointer-events:none;border:3px dashed rgba(34,211,238,0.6)';
      dropOverlay.textContent = '↓ DROP FILES TO ATTACH ↓';
      document.body.appendChild(dropOverlay);
    };
    const hideOverlay = () => { if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; } };
    window.addEventListener('dragenter', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragDepth++; showOverlay();
    });
    window.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    window.addEventListener('dragleave', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    });
    window.addEventListener('drop', e => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepth = 0; hideOverlay();
      if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
    });
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

    // ── Phase 6: voice + persona ──
    wireVoiceAndPersona();
  }

  // Phase 6B (TTS) + 6C (STT) + 6A (persona modal) — browser-native APIs, no server keys needed
  let speechRecognition = null;
  let speechRecognizing = false;

  let isSpeaking = false;
  let currentAudio = null;
  function updateSpeakBtnState(speaking){
    const btn = document.getElementById('ry-speak-toggle');
    if (!btn) return;
    if (speaking) {
      btn.classList.add('listening'); // reuse the red pulse style
      btn.title = 'Stop speaking';
    } else {
      btn.classList.remove('listening');
      const autoOn = getAutoSpeak();
      btn.classList.toggle('active', autoOn);
      btn.title = 'Auto-speak AI responses';
    }
  }
  function cleanForSpeech(text){
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[\*_`#>~|]/g, '')
      .replace(/\\([\w])/g, '$1')
      .replace(/\s[—–]\s/g, ', ')
      .replace(/[—–]/g, ', ')
      .replace(/\s-\s/g, ', ')
      .replace(/[(){}\[\]]/g, ' ')
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\b(\w+)\/(\w+)\b/g, '$1 or $2')
      .replace(/^[\s]*[•\u2022\u25CF\-\d]+[.)]?[\s]+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.\s*\./g, '.')
      .replace(/,\s*,/g, ',')
      .trim();
  }
  // Phase 12: try ElevenLabs first, fall back to browser TTS on 503/error.
  // Phase 14: show full-screen voice mode overlay during playback.
  // Phase 14.2: request word-level timestamps when voice mode session is active for exact subtitle sync.
  function base64ToBlob(b64, mimeType){
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }
  // In-memory TTS cache for short repeated phrases (≤80 chars) — saves credits on
  // recurring lines like "Anything else?" / "Finding agent…" / common acks.
  const TTS_CACHE = new Map(); // key: `${archetype}|${clean}` → { blob, alignment }
  const TTS_CACHE_MAX = 24;

  async function speakText(text){
    if (!text) return;
    stopSpeaking();
    const clean = cleanForSpeech(text);
    if (!clean) return;

    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('ryujin_token')) || '';
    const archetype = (typeof localStorage !== 'undefined' && localStorage.getItem('ryujin_archetype')) || null;
    const inVoice = !!(window.RyujinVoiceMode && window.RyujinVoiceMode.isActive && window.RyujinVoiceMode.isActive());
    // Drop timestamps on Low effort to save credits — fall back to time-proportional reveal
    let lastEffort = 'medium';
    try { lastEffort = localStorage.getItem('ryujin_last_effort') || 'medium'; } catch {}
    const wantTimestamps = inVoice && lastEffort !== 'low';

    // Cache hit fast-path for short phrases
    const cacheKey = `${archetype || 'default'}|${clean}`;
    if (clean.length <= 80 && TTS_CACHE.has(cacheKey)) {
      const hit = TTS_CACHE.get(cacheKey);
      const url = URL.createObjectURL(hit.blob);
      const audio = new Audio(url);
      currentAudio = audio;
      isSpeaking = true; updateSpeakBtnState(true);
      const closeVm = () => { try { window.RyujinVoiceMode && window.RyujinVoiceMode.hide(); } catch {} };
      audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) { currentAudio = null; isSpeaking = false; updateSpeakBtnState(false); } closeVm(); };
      audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) { currentAudio = null; isSpeaking = false; updateSpeakBtnState(false); } closeVm(); };
      await audio.play().catch(() => {});
      if (window.RyujinVoiceMode) window.RyujinVoiceMode.show(text, archetype, audio, () => stopSpeaking(), hit.alignment);
      return;
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const r = await fetch('/api/tts', {
        method: 'POST', headers,
        body: JSON.stringify({ text: clean, archetype, timestamps: wantTimestamps })
      });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        let audioBlob, alignment = null;
        if (ct.includes('application/json')) {
          const data = await r.json();
          audioBlob = base64ToBlob(data.audio_base64, 'audio/mpeg');
          alignment = data.alignment || null;
        } else {
          audioBlob = await r.blob();
        }
        // Cache short phrases (LRU-ish: prune oldest when full)
        if (clean.length <= 80) {
          if (TTS_CACHE.size >= TTS_CACHE_MAX) {
            const firstKey = TTS_CACHE.keys().next().value;
            TTS_CACHE.delete(firstKey);
          }
          TTS_CACHE.set(cacheKey, { blob: audioBlob, alignment });
        }
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        currentAudio = audio;
        isSpeaking = true; updateSpeakBtnState(true);
        const closeVoiceMode = () => { try { window.RyujinVoiceMode && window.RyujinVoiceMode.hide(); } catch {} };
        audio.onended = () => { URL.revokeObjectURL(url); if (currentAudio === audio) { currentAudio = null; isSpeaking = false; updateSpeakBtnState(false); } closeVoiceMode(); };
        audio.onerror = () => { URL.revokeObjectURL(url); if (currentAudio === audio) { currentAudio = null; isSpeaking = false; updateSpeakBtnState(false); } closeVoiceMode(); };
        await audio.play().catch(() => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          closeVoiceMode();
          speakBrowserTTS(clean, text, archetype);
        });
        if (window.RyujinVoiceMode) {
          window.RyujinVoiceMode.show(text, archetype, audio, () => stopSpeaking(), alignment);
        }
        return;
      }
    } catch (e) { /* fall through */ }
    speakBrowserTTS(clean, text, archetype);
  }
  function speakBrowserTTS(clean, originalText, archetype){
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = 1.0; utter.pitch = 1.0; utter.volume = 1.0;
      const closeVm = () => { try { window.RyujinVoiceMode && window.RyujinVoiceMode.hide(); } catch {} };
      utter.onstart = () => { isSpeaking = true; updateSpeakBtnState(true); };
      utter.onend = () => { isSpeaking = false; updateSpeakBtnState(false); closeVm(); };
      utter.onerror = () => { isSpeaking = false; updateSpeakBtnState(false); closeVm(); };
      window.speechSynthesis.speak(utter);
      // Phase 14: voice mode without audio element (waveform falls back to simulated)
      if (window.RyujinVoiceMode && originalText) {
        window.RyujinVoiceMode.show(originalText, archetype || null, null, () => stopSpeaking());
      }
    } catch {}
  }
  function stopSpeaking(){
    try {
      if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
      window.speechSynthesis && window.speechSynthesis.cancel();
      window.RyujinVoiceMode && window.RyujinVoiceMode.hide();
    } catch {}
    isSpeaking = false;
    updateSpeakBtnState(false);
  }

  function getAutoSpeak(){ return localStorage.getItem('ryujin_auto_speak') === '1'; }
  function setAutoSpeak(v){ localStorage.setItem('ryujin_auto_speak', v ? '1' : '0'); }

  // Public hook called after AI response finishes streaming
  RY.maybeSpeak = function(text){
    if (getAutoSpeak()) speakText(text);
  };

  function wireVoiceAndPersona(){
    // Speaker icon → simple TTS toggle (auto-speak responses on/off). It does
    // NOT auto-launch full-screen voice mode anymore. To enter immersive voice
    // mode, long-press the speaker icon. Default state: OFF every session.
    const speakBtn = document.getElementById('ry-speak-toggle');
    if (speakBtn) {
      let pressTimer = null;
      let longPressed = false;

      const enterVoiceMode = async () => {
        longPressed = true;
        if (isSpeaking) stopSpeaking();
        const ok = await ensureVoiceModeLoaded();
        if (!ok || !window.RyujinVoiceMode) {
          // Couldn't load voice mode — fall through to plain auto-speak toggle.
          const next = !getAutoSpeak();
          setAutoSpeak(next);
          speakBtn.classList.toggle('active', next);
          return;
        }
        const archetype = (localStorage.getItem('ryujin_archetype')) || 'ruler';
        window.RyujinVoiceMode.enter(
          archetype,
          () => stopSpeaking(),
          (transcript) => {
            const wasAutoSpeak = getAutoSpeak();
            setAutoSpeak(true);
            const input = document.getElementById('ry-input');
            if (input) {
              input.value = transcript;
              sendTyped();
            }
            setTimeout(() => { if (!wasAutoSpeak) setAutoSpeak(false); }, 1000);
          }
        );
      };

      speakBtn.addEventListener('mousedown', () => {
        longPressed = false;
        pressTimer = setTimeout(enterVoiceMode, 600);
      });
      speakBtn.addEventListener('touchstart', () => {
        longPressed = false;
        pressTimer = setTimeout(enterVoiceMode, 600);
      }, { passive: true });
      const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      speakBtn.addEventListener('mouseup', cancelPress);
      speakBtn.addEventListener('mouseleave', cancelPress);
      speakBtn.addEventListener('touchend', cancelPress);
      speakBtn.addEventListener('touchcancel', cancelPress);

      speakBtn.addEventListener('click', (e) => {
        // If a long-press just fired (voice mode entered), swallow the click.
        if (longPressed) { longPressed = false; e.preventDefault(); return; }
        // If voice mode is currently visible (entered via long-press), tap to exit.
        if (window.RyujinVoiceMode && window.RyujinVoiceMode.isActive && window.RyujinVoiceMode.isActive()) {
          window.RyujinVoiceMode.exit();
          return;
        }
        // Plain TTS toggle — auto-speak this session's responses or stop.
        if (isSpeaking) stopSpeaking();
        const next = !getAutoSpeak();
        setAutoSpeak(next);
        speakBtn.classList.toggle('active', next);
        speakBtn.title = next ? 'Auto-speak on (tap to mute · long-press for voice mode)' : 'Auto-speak off (tap to enable · long-press for voice mode)';
      });
      speakBtn.title = 'Auto-speak off (tap to enable · long-press for voice mode)';
    }

    // Mic / STT
    const micBtn = document.getElementById('ry-mic');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (micBtn) {
      if (!SR) {
        micBtn.title = 'Voice input not supported in this browser (try Chrome or Edge)';
        micBtn.style.opacity = '0.4';
        micBtn.style.cursor = 'not-allowed';
      } else {
        micBtn.addEventListener('click', () => {
          if (speechRecognizing) {
            try { speechRecognition && speechRecognition.stop(); } catch {}
            return;
          }
          speechRecognition = new SR();
          speechRecognition.lang = 'en-US';
          speechRecognition.interimResults = true;
          speechRecognition.continuous = false;
          speechRecognition.maxAlternatives = 1;
          speechRecognizing = true;
          micBtn.classList.add('listening');
          const input = document.getElementById('ry-input');
          let finalTranscript = input ? input.value : '';
          speechRecognition.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const r = e.results[i];
              if (r.isFinal) finalTranscript += r[0].transcript;
              else interim += r[0].transcript;
            }
            if (input) input.value = (finalTranscript + interim).trim();
          };
          speechRecognition.onerror = () => {};
          speechRecognition.onend = () => {
            speechRecognizing = false;
            micBtn.classList.remove('listening');
            speechRecognition = null;
            // Auto-send if we got something
            if (input && input.value.trim()) sendTyped();
          };
          try { speechRecognition.start(); } catch (err) {
            speechRecognizing = false;
            micBtn.classList.remove('listening');
          }
        });
      }
    }

    // Persona modal (long-press speak toggle to open, since header is busy)
    if (speakBtn) {
      let pressTimer = null;
      const openPersona = (e) => {
        e.preventDefault();
        const modal = document.getElementById('ry-persona-modal');
        if (!modal) return;
        loadPersona();
        modal.classList.add('on');
      };
      speakBtn.addEventListener('contextmenu', openPersona);
      speakBtn.addEventListener('mousedown', () => { pressTimer = setTimeout(() => openPersona({ preventDefault(){} }), 700); });
      speakBtn.addEventListener('mouseup', () => { if (pressTimer) clearTimeout(pressTimer); });
      speakBtn.addEventListener('mouseleave', () => { if (pressTimer) clearTimeout(pressTimer); });
      speakBtn.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openPersona({ preventDefault(){} }), 700); });
      speakBtn.addEventListener('touchend', () => { if (pressTimer) clearTimeout(pressTimer); });
    }

    const personaCancel = document.getElementById('ry-persona-cancel');
    const personaSave = document.getElementById('ry-persona-save');
    if (personaCancel) personaCancel.addEventListener('click', () => {
      const m = document.getElementById('ry-persona-modal');
      if (m) m.classList.remove('on');
    });
    if (personaSave) personaSave.addEventListener('click', savePersona);
  }

  async function loadPersona(){
    const status = document.getElementById('ry-persona-status');
    const nameInput = document.getElementById('ry-persona-name');
    const styleInput = document.getElementById('ry-persona-style');
    const archInput = document.getElementById('ry-archetype');
    if (!nameInput || !styleInput) return;
    const token = localStorage.getItem('ryujin_token') || '';
    if (!token) {
      if (status) status.textContent = 'Log in to save a persona. Until then, your AI uses the role default.';
      nameInput.value = '';
      styleInput.value = '';
      return;
    }
    try {
      const r = await fetch('/api/persona', { headers: { Authorization: 'Bearer ' + token } });
      const data = await r.json();
      const p = data.persona || {};
      nameInput.value = p.name || '';
      styleInput.value = p.style || '';
      if (archInput && data.primaryArchetype) archInput.value = data.primaryArchetype;
      if (status) status.textContent = data.note || (data.tenantDefault && Object.keys(data.tenantDefault).length ? `Tenant default: ${data.tenantDefault.name || '(unnamed)'}` : '');
    } catch (e) {
      if (status) status.textContent = 'Could not load persona. Try again.';
    }
  }

  async function savePersona(){
    const status = document.getElementById('ry-persona-status');
    const nameInput = document.getElementById('ry-persona-name');
    const styleInput = document.getElementById('ry-persona-style');
    const archInput = document.getElementById('ry-archetype');
    const token = localStorage.getItem('ryujin_token') || '';
    if (!token) { if (status) status.textContent = 'Log in to save.'; return; }
    if (status) status.textContent = 'Saving...';
    try {
      const r = await fetch('/api/persona', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          style: styleInput.value.trim(),
          primary_archetype: archInput ? archInput.value : undefined
        })
      });
      const data = await r.json();
      if (!r.ok) {
        if (status) status.textContent = data.error || 'Save failed. ' + (data.hint || '');
        return;
      }
      if (status) status.textContent = data.note ? `Saved (${data.note})` : 'Saved. Applies on next message.';
      // Persist current archetype in localStorage for any UI elements that show it
      if (archInput) localStorage.setItem('ryujin_archetype', archInput.value);
      setTimeout(() => {
        const m = document.getElementById('ry-persona-modal');
        if (m) m.classList.remove('on');
      }, 1200);
    } catch (e) {
      if (status) status.textContent = 'Save failed: ' + e.message;
    }
  }

  // ── File attachments (paperclip / drag-drop / paste-image) ────────
  const pendingAttachments = [];

  function renderAttachmentChips(){
    let host = document.getElementById('ry-attach-chips');
    if (!host) {
      const composer = document.querySelector('.ry-input')?.parentElement;
      if (!composer) return;
      host = document.createElement('div');
      host.id = 'ry-attach-chips';
      host.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 6px;font-size:0.72em';
      composer.parentElement?.insertBefore(host, composer);
    }
    if (!pendingAttachments.length) { host.innerHTML = ''; return; }
    host.innerHTML = pendingAttachments.map((a, i) => `
      <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,211,238,0.12);border:1px solid rgba(34,211,238,0.35);color:#9be7ff;padding:3px 8px 3px 10px;border-radius:12px;font-weight:600">
        <span>📎 ${a.fileName.length > 28 ? a.fileName.slice(0,25)+'…' : a.fileName}</span>
        <button data-idx="${i}" class="ry-att-x" style="background:none;border:none;color:#9be7ff;cursor:pointer;font-size:1.2em;line-height:1;padding:0;margin-left:2px">×</button>
      </span>
    `).join('');
    host.querySelectorAll('.ry-att-x').forEach(b => b.addEventListener('click', () => {
      pendingAttachments.splice(Number(b.dataset.idx), 1);
      renderAttachmentChips();
    }));
  }

  async function uploadFiles(fileList){
    const files = Array.from(fileList || []).slice(0, 5 - pendingAttachments.length);
    if (!files.length) return;
    const placeholder = document.createElement('div');
    placeholder.id = 'ry-att-uploading';
    placeholder.style.cssText = 'padding:0 14px 6px;font-size:0.72em;color:#9be7ff;font-style:italic';
    placeholder.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    const composer = document.querySelector('.ry-input')?.parentElement;
    composer?.parentElement?.insertBefore(placeholder, composer);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f, f.name);
      const ryujinToken = (typeof localStorage !== 'undefined' && localStorage.getItem('ryujin_token')) || '';
      const headers = {};
      if (ryujinToken) headers.Authorization = `Bearer ${ryujinToken}`;
      const r = await fetch('/api/chat-upload?tenant=plus-ultra', { method: 'POST', headers, body: fd });
      const j = await r.json();
      if (j.files) {
        for (const f of j.files) {
          if (f.url) pendingAttachments.push(f);
        }
      }
    } catch (e) {
      console.warn('[ryujin-chat] upload failed', e);
    } finally {
      placeholder.remove();
      renderAttachmentChips();
    }
  }

  async function sendTyped(){
    const input = document.getElementById('ry-input');
    const text = input.value.trim();
    const hasAttach = pendingAttachments.length > 0;
    if (!text && !hasAttach) return;
    input.value = '';
    const msgsEl = document.getElementById('ry-msgs');

    // User bubble (with attachment chips if any)
    const userBubble = document.createElement('div');
    userBubble.className = 'ry-bubble user';
    if (hasAttach) {
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px';
      for (const a of pendingAttachments) {
        const chip = document.createElement('span');
        chip.style.cssText = 'background:rgba(34,211,238,0.14);border:1px solid rgba(34,211,238,0.35);color:#9be7ff;padding:2px 8px;border-radius:10px;font-size:0.7em;font-weight:600';
        chip.textContent = '📎 ' + a.fileName;
        head.appendChild(chip);
      }
      userBubble.appendChild(head);
    }
    if (text) {
      const txtNode = document.createElement('div');
      txtNode.textContent = text;
      userBubble.appendChild(txtNode);
    } else {
      const txtNode = document.createElement('div');
      txtNode.style.cssText = 'opacity:0.7;font-style:italic';
      txtNode.textContent = '(analyze the attached files)';
      userBubble.appendChild(txtNode);
    }
    msgsEl.appendChild(userBubble);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Capture PRIOR history (don't include current message — it goes in `message`)
    const historyToSend = chatHistory.slice(-10);
    chatHistory.push({ role: 'user', content: text || '(attachments only)' });

    // Clear pending attachments — they're committed to this turn now
    const attachmentsForThisTurn = pendingAttachments.slice();
    pendingAttachments.length = 0;
    renderAttachmentChips();

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'ry-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    msgsEl.appendChild(typing);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    try {
      const ryujinToken = (typeof localStorage !== 'undefined' && localStorage.getItem('ryujin_token')) || '';
      const headers = { 'Content-Type': 'application/json' };
      if (ryujinToken) headers.Authorization = `Bearer ${ryujinToken}`;
      const inVoiceMode = !!(window.RyujinVoiceMode && window.RyujinVoiceMode.isActive && window.RyujinVoiceMode.isActive());
      let viewAs = null;
      try { viewAs = JSON.parse(localStorage.getItem('ryujin_view_as') || 'null'); } catch {}
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text || '', history: historyToSend, attachments: attachmentsForThisTurn, conversation_id: currentConversationId || undefined, voiceMode: inVoiceMode, viewAs: viewAs || undefined, mode: getLastMode(), effort: getLastEffort(), archetype: (getLastMode() === 'agent' && lockedAgentArchetype) ? lockedAgentArchetype : undefined })
      });
      typing.remove();

      if (resp.status === 401) {
        const err = document.createElement('div');
        err.className = 'ry-bubble dragon';
        err.textContent = 'Session expired. Redirecting to sign in...';
        msgsEl.appendChild(err);
        if (window.RyujinAuth && window.RyujinAuth.clearAndRedirect) window.RyujinAuth.clearAndRedirect();
        else window.location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
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
      let serverError = null;
      let stopReasonSeen = null;
      let toolsAttempted = 0;
      let toolsFailed = 0;

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

          if (data.matched_archetype) {
            lockedAgentArchetype = data.matched_archetype;
            try { window.RyujinVoiceMode && window.RyujinVoiceMode.setMatchedArchetype && window.RyujinVoiceMode.setMatchedArchetype(data.matched_archetype); } catch {}
          }
          if (data.routing_suggestion) {
            const swap = { ruler:'Zeus', caregiver:'Hestia', hero:'Hermes', creator:'Hephaestus', sage:'Athena', magician:'Hecate', explorer:'Artemis', jester:'Apollo', lover:'Aphrodite', innocent:'Persephone', everyman:'Hercules', outlaw:'Prometheus' }[data.routing_suggestion];
            if (swap) {
              const tip = document.createElement('div');
              tip.className = 'ry-bubble sys';
              tip.textContent = `\u25CA Tip: say "switch to ${swap}" to bring ${swap} in.`;
              msgsEl.appendChild(tip);
            }
          }
          if (data.text) {
            assembled += data.text;
            bubble.textContent = assembled;
          } else if (data.error) {
            serverError = data.error;
            console.error('[ryujin-chat] server error:', data.error);
          } else if (data.done && data.stop_reason) {
            stopReasonSeen = data.stop_reason;
          } else if (data.tool_start) {
            toolBubble = document.createElement('div');
            toolBubble.className = 'ry-bubble sys';
            toolBubble.textContent = '◊ ' + (data.tool_start.label || 'Running tool...');
            msgsEl.insertBefore(toolBubble, bubble);
            toolsAttempted += 1;
          } else if (data.tool_end) {
            if (toolBubble) {
              if (data.tool_end.status === 'error') {
                toolBubble.textContent = '⚠ ' + toolBubble.textContent.replace(/^◊ /, '') + ' (failed: ' + (data.tool_end.error || 'unknown') + ')';
                toolsFailed += 1;
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
        // Phase 6B: TTS auto-speak if toggle on
        if (RY.maybeSpeak) RY.maybeSpeak(assembled);
        // Persist conversation + refresh priorities for the next turn — fire and forget
        persistConversationTurn();
        refreshPriorities({ withGreeting: false });
      } else if (serverError) {
        bubble.textContent = 'Server error: ' + serverError;
      } else {
        // Empty stream — surface every clue we have so the next debug isn't blind
        const clues = [];
        if (toolsAttempted) clues.push(toolsAttempted + ' tool call' + (toolsAttempted > 1 ? 's' : '') + (toolsFailed ? ' (' + toolsFailed + ' failed)' : ''));
        if (stopReasonSeen) clues.push('stop: ' + stopReasonSeen);
        if (attachmentsForThisTurn.length) clues.push(attachmentsForThisTurn.length + ' attachment' + (attachmentsForThisTurn.length > 1 ? 's' : ''));
        bubble.textContent = clues.length
          ? 'No reply text. (' + clues.join(' · ') + '). Check browser console + Vercel logs.'
          : 'No response. Check browser console + Vercel logs.';
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
    cfg = cfg || {};
    // The opt-out flag is scoped to the floating dragon-orb FAB. Pages that
    // embed the chat directly into a host element (e.g. dashboard-v2's
    // #dragonChatMount) are the *only* AI surface on those pages — suppressing
    // them leaves the panel blank, which is not what the toggle is for.
    if (chatDisabled() && !cfg.embedTarget) return;

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
