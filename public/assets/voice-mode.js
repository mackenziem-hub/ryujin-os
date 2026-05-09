// Phase 14: Voice Mode overlay — accessible full-screen voice experience
// Shows archetype face, live audio waveform, large-text subtitles while AI is speaking.
// Designed for ADHD / dyslexia / quick-glance use: high contrast, large fonts, single focus.
//
// Usage: window.RyujinVoiceMode.show(text, archetype, audioElement)  // audioElement optional
//        window.RyujinVoiceMode.hide()
//
// Falls back gracefully if browser doesn't support Web Audio API (waveform skipped, subtitles still show).

(function(){
  if (window.RyujinVoiceMode) return; // singleton

  const STYLES = `
    #rvm-overlay{position:fixed;inset:0;background:linear-gradient(180deg,#020616 0%,#040d22 60%,#06152d 100%);z-index:9500;display:none;flex-direction:column;align-items:center;justify-content:flex-start;padding:max(20px,env(safe-area-inset-top)) 20px max(120px,env(safe-area-inset-bottom));font-family:'Inter',system-ui,sans-serif;color:#e0e6f0;animation:rvm-fade-in 0.25s ease;gap:24px}
    #rvm-overlay.on{display:flex}
    @keyframes rvm-fade-in{from{opacity:0}to{opacity:1}}
    @keyframes rvm-pulse-glow{0%,100%{box-shadow:0 0 60px rgba(34,211,238,0.4),0 0 120px rgba(34,211,238,0.2),inset 0 0 30px rgba(34,211,238,0.15)}50%{box-shadow:0 0 90px rgba(34,211,238,0.6),0 0 180px rgba(34,211,238,0.3),inset 0 0 40px rgba(34,211,238,0.25)}}
    @keyframes rvm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
    @keyframes rvm-active-dot{0%,100%{opacity:1}50%{opacity:0.4}}

    #rvm-bg-wave{position:absolute;inset:0;pointer-events:none;overflow:hidden;opacity:0.25}
    #rvm-bg-wave svg{position:absolute;bottom:0;left:0;width:200%;height:35%;animation:rvm-bg-drift 18s linear infinite}
    @keyframes rvm-bg-drift{from{transform:translateX(0)}to{transform:translateX(-50%)}}

    #rvm-face{width:min(280px,42vh);height:min(280px,42vh);border-radius:50%;overflow:hidden;border:2px solid rgba(34,211,238,0.5);position:relative;animation:rvm-pulse-glow 3s ease-in-out infinite,rvm-float 5s ease-in-out infinite;background:#040d22;flex-shrink:0;margin-top:30px}
    #rvm-face img{width:100%;height:100%;object-fit:cover;display:block}
    #rvm-face.fallback{display:flex;align-items:center;justify-content:center;font-family:'Orbitron',sans-serif;font-size:5em;font-weight:900;color:#22d3ee;background:radial-gradient(circle at 35% 30%,rgba(220,240,255,0.3),rgba(34,211,238,0.3) 35%,rgba(10,25,50,0.95) 75%)}

    #rvm-card{width:min(640px,calc(100vw - 32px));background:rgba(10,18,38,0.7);border:1px solid rgba(34,211,238,0.18);border-radius:18px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px 18px;box-shadow:0 12px 40px rgba(0,0,0,0.5),0 0 30px rgba(34,211,238,0.12);display:flex;flex-direction:column;flex-shrink:0}

    #rvm-wave-canvas{display:block;width:100%;height:50px;margin-bottom:10px;border-radius:10px;flex-shrink:0}

    #rvm-card .label-row{display:flex;align-items:center;justify-content:space-between;font-size:0.72em;letter-spacing:0.6px;text-transform:uppercase;color:rgba(160,200,240,0.65);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(34,211,238,0.12);flex-shrink:0}
    #rvm-card .label{color:#22d3ee;font-weight:600}
    #rvm-card .archetype-tag{font-family:'Share Tech Mono',monospace;color:rgba(160,200,240,0.5);font-size:0.85em}

    /* Rolling subtitle window — fixed height, fade-top mask, auto-scroll to bottom */
    #rvm-subtitle-window{position:relative;height:140px;overflow:hidden;mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.4) 12%,#000 30%,#000 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,rgba(0,0,0,0.4) 12%,#000 30%,#000 100%)}
    #rvm-subtitle{position:absolute;left:0;right:0;bottom:0;font-size:1.08em;line-height:1.55;color:#f0f4ff;font-weight:400;letter-spacing:0.2px;font-family:'Inter',system-ui,sans-serif;padding:8px 4px 6px;word-break:break-word}

    /* Bottom input row — text field + mic + (when speaking) playback controls */
    #rvm-input-row{position:absolute;bottom:max(20px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;width:min(640px,calc(100vw - 32px));z-index:5}
    #rvm-text-input{flex:1;height:54px;padding:0 18px;background:rgba(10,18,38,0.85);border:1.5px solid rgba(34,211,238,0.25);border-radius:27px;color:#f0f4ff;font-size:1em;font-family:inherit;outline:none;backdrop-filter:blur(8px);transition:border-color 0.15s}
    #rvm-text-input::placeholder{color:rgba(160,200,240,0.4)}
    #rvm-text-input:focus{border-color:rgba(34,211,238,0.6);box-shadow:0 0 0 3px rgba(34,211,238,0.1)}
    #rvm-overlay[data-state="speaking"] #rvm-text-input,
    #rvm-overlay[data-state="paused"] #rvm-text-input{display:none}

    #rvm-status-bar{position:absolute;bottom:max(20px,env(safe-area-inset-bottom));left:24px;display:flex;align-items:center;gap:10px;font-size:0.85em;color:rgba(160,200,240,0.85);letter-spacing:0.4px}
    #rvm-status-bar .dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px #4ade80;animation:rvm-active-dot 1.6s infinite}
    #rvm-status-bar svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2}

    #rvm-mic-btn{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,rgba(34,211,238,0.9),rgba(124,58,237,0.7));border:2px solid rgba(34,211,238,0.6);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(34,211,238,0.35);transition:all 0.15s;flex-shrink:0}
    #rvm-mic-btn:hover{transform:scale(1.05);box-shadow:0 8px 28px rgba(34,211,238,0.5)}
    #rvm-mic-btn:active{transform:scale(0.96)}
    #rvm-mic-btn svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2}
    #rvm-mic-btn.listening{background:linear-gradient(135deg,#f87171,#dc2626);border-color:rgba(248,113,113,0.8);animation:rvm-mic-pulse 1.4s infinite}
    #rvm-mic-btn.disabled{opacity:0.4;cursor:not-allowed;animation:none}
    #rvm-overlay[data-state="speaking"] #rvm-mic-btn,
    #rvm-overlay[data-state="paused"] #rvm-mic-btn{display:none}
    @keyframes rvm-mic-pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.5),0 0 60px rgba(248,113,113,0.3)}50%{box-shadow:0 0 0 16px rgba(248,113,113,0),0 0 80px rgba(248,113,113,0.4)}}

    /* Playback controls — visible during 'speaking' / 'paused' state only, replace mic in input row */
    .rvm-controls{display:flex;gap:10px;align-items:center;flex-shrink:0;opacity:0;pointer-events:none;width:100%;justify-content:center;transition:opacity 0.2s}
    #rvm-overlay[data-state="speaking"] .rvm-controls,
    #rvm-overlay[data-state="paused"] .rvm-controls{opacity:1;pointer-events:auto}
    .rvm-ctrl-btn{width:50px;height:50px;border-radius:50%;background:rgba(10,18,38,0.85);border:1.5px solid rgba(34,211,238,0.3);color:#e0e6f0;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:all 0.15s;box-shadow:0 6px 20px rgba(0,0,0,0.4);flex-shrink:0}
    .rvm-ctrl-btn:hover{border-color:rgba(34,211,238,0.6);color:#22d3ee;transform:translateY(-2px)}
    .rvm-ctrl-btn:active{transform:translateY(0) scale(0.96)}
    .rvm-ctrl-btn svg{width:20px;height:20px;stroke:currentColor;fill:currentColor;stroke-width:0.5}
    .rvm-ctrl-btn.primary{width:60px;height:60px;background:linear-gradient(135deg,rgba(34,211,238,0.9),rgba(124,58,237,0.7));border-color:rgba(34,211,238,0.6);color:#fff}
    .rvm-ctrl-btn.primary svg{width:24px;height:24px}
    .rvm-ctrl-btn.primary:hover{box-shadow:0 8px 30px rgba(34,211,238,0.5)}

    #rvm-close-btn{position:absolute;top:max(20px,env(safe-area-inset-top));right:24px;width:42px;height:42px;border-radius:50%;background:rgba(10,18,38,0.7);border:1px solid rgba(34,211,238,0.25);color:#e0e6f0;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:all 0.15s}
    #rvm-close-btn:hover{border-color:rgba(248,113,113,0.6);color:#f87171}
    #rvm-close-btn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2.5}

    @media (max-width:480px){
      #rvm-card{padding:12px 14px}
      #rvm-subtitle{font-size:0.98em}
      #rvm-subtitle-window{height:118px}
      #rvm-face{width:min(220px,38vh);height:min(220px,38vh);margin-top:10px}
    }
    @media (max-height:700px){
      #rvm-face{width:min(200px,32vh);height:min(200px,32vh);margin-top:8px}
      #rvm-subtitle-window{height:100px}
    }
    @media (prefers-reduced-motion:reduce){
      #rvm-face{animation:none}
      #rvm-bg-wave svg{animation:none}
    }

    /* Agent Mode side rail */
    #rvm-rail{position:absolute;top:max(20px,env(safe-area-inset-top));right:20px;width:240px;
      background:rgba(10,18,38,0.78);border:1px solid rgba(34,211,238,0.2);border-radius:14px;
      backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:14px 16px;
      box-shadow:0 12px 40px rgba(0,0,0,0.45),0 0 26px rgba(34,211,238,0.1);
      display:flex;flex-direction:column;gap:14px;z-index:4;
      animation:rvm-fade-in 0.3s ease}
    #rvm-rail .rail-section{display:flex;flex-direction:column;gap:5px}
    #rvm-rail .rail-h{font-family:'Share Tech Mono',monospace;font-size:0.6em;letter-spacing:1.4px;
      color:rgba(160,200,240,0.5);text-transform:uppercase}
    #rvm-rail .rail-arch{font-family:'Orbitron',sans-serif;font-size:0.95em;font-weight:700;
      color:#22d3ee;letter-spacing:0.6px}
    #rvm-rail .rail-lens{font-size:0.72em;color:rgba(200,220,240,0.7)}
    #rvm-rail .rail-tools{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:5px}
    #rvm-rail .rail-tools li{font-size:0.72em;color:#e0e6f0;padding:5px 8px;border-radius:7px;
      background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.15)}
    #rvm-rail .rail-tip{font-size:0.7em;color:rgba(200,220,240,0.7);line-height:1.5}
    #rvm-rail .rail-tip em{color:#22d3ee;font-style:normal;font-weight:600}
    @media (max-width:760px){
      #rvm-rail{position:relative;right:auto;top:auto;width:min(640px,calc(100vw - 32px));margin:0 auto}
    }
  `;

  // Map archetype slug → face image path. Falls back to first letter.
  function archetypeFaceUrl(archetype){
    if (!archetype) return null;
    return `/assets/archetypes/${archetype}.jpg`;
  }

  function archetypeLabel(archetype){
    const map = {
      ruler:'Zeus, Ruler', caregiver:'Hestia, Caregiver', hero:'Hermes, Hero',
      creator:'Hephaestus, Creator', sage:'Athena, Sage', magician:'Hecate, Magician',
      explorer:'Artemis, Explorer', jester:'Apollo, Jester', lover:'Aphrodite, Lover',
      innocent:'Persephone, Innocent', everyman:'Hercules, Everyman', outlaw:'Prometheus, Outlaw'
    };
    return archetype && map[archetype] ? map[archetype] : 'Plus Ultra';
  }

  function injectStyles(){
    if (document.getElementById('rvm-styles')) return;
    const s = document.createElement('style'); s.id='rvm-styles'; s.textContent=STYLES;
    document.head.appendChild(s);
  }

  function buildOverlay(){
    if (document.getElementById('rvm-overlay')) return;
    const root = document.createElement('div');
    root.id = 'rvm-overlay';
    root.innerHTML = `
      <div id="rvm-bg-wave" aria-hidden="true">
        <svg viewBox="0 0 1200 200" preserveAspectRatio="none">
          <path d="M0,100 C150,40 300,160 450,100 C600,40 750,160 900,100 C1050,40 1200,160 1350,100 L1350,200 L0,200 Z" fill="rgba(34,211,238,0.18)"/>
          <path d="M0,120 C150,60 300,180 450,120 C600,60 750,180 900,120 C1050,60 1200,180 1350,120 L1350,200 L0,200 Z" fill="rgba(124,58,237,0.12)"/>
        </svg>
      </div>
      <button id="rvm-close-btn" title="Close voice mode" aria-label="Close voice mode">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div id="rvm-face" role="img" aria-label="AI archetype"></div>
      <aside id="rvm-rail" aria-label="Agent details" hidden>
        <div class="rail-section">
          <div class="rail-h">Agent</div>
          <div class="rail-arch" id="rvm-rail-arch">finding…</div>
          <div class="rail-lens" id="rvm-rail-lens"></div>
        </div>
        <div class="rail-section">
          <div class="rail-h">Capabilities</div>
          <ul class="rail-tools">
            <li>Cross-archetype lens</li>
            <li>Voice synthesis</li>
            <li>Live data lookup</li>
            <li>Tool use</li>
          </ul>
        </div>
        <div class="rail-section">
          <div class="rail-h">Tip</div>
          <div class="rail-tip">Say "switch to <em>Athena</em>" to bring in another archetype mid-session.</div>
        </div>
      </aside>
      <div id="rvm-card" role="region" aria-label="Voice transcript">
        <canvas id="rvm-wave-canvas" aria-hidden="true"></canvas>
        <div class="label-row">
          <div class="label">Speak &amp; Wave</div>
          <div class="archetype-tag" id="rvm-archetype-tag">#plusultra</div>
        </div>
        <div id="rvm-subtitle-window">
          <div id="rvm-subtitle" aria-live="polite"></div>
        </div>
      </div>
      <div id="rvm-status-bar">
        <span class="dot"></span>
        <span>Voice Active</span>
        <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </div>
      <div id="rvm-input-row">
        <input type="text" id="rvm-text-input" placeholder="Type a message and press Enter, or tap the mic" autocomplete="off" autocapitalize="sentences" />
        <button id="rvm-mic-btn" title="Tap to speak" aria-label="Tap to speak">
          <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </button>
        <div class="rvm-controls" id="rvm-controls">
          <button class="rvm-ctrl-btn" id="rvm-restart-btn" title="Restart from beginning" aria-label="Restart">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button class="rvm-ctrl-btn primary" id="rvm-pause-btn" title="Pause" aria-label="Pause">
            <svg id="rvm-pause-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          </button>
          <button class="rvm-ctrl-btn" id="rvm-stop-btn" title="Stop" aria-label="Stop">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    document.getElementById('rvm-close-btn').addEventListener('click', () => RyujinVoiceMode.hide(true));
    // Click on background (not face/card) also closes
    root.addEventListener('click', (e) => {
      if (e.target === root) RyujinVoiceMode.hide(true);
    });
    // Escape key closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('on')) RyujinVoiceMode.hide(true);
    });
  }

  let analyser = null;
  let audioCtx = null;
  let sourceNode = null;
  let rafId = null;
  let currentAudio = null;
  let currentOnHide = null;

  function drawFlatWave(){
    const canvas = document.getElementById('rvm-wave-canvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 60;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(8, h / 2);
    ctx2d.lineTo(w - 8, h / 2);
    ctx2d.stroke();
  }

  function startWaveform(audioEl){
    const canvas = document.getElementById('rvm-wave-canvas');
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    function resize(){
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 60;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx2d.scale(dpr, dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    if (!audioEl) {
      // No audio element (browser TTS path or idle) — animate gentle wave only while actually speaking
      const isSpeaking = sessionState === 'speaking';
      if (!isSpeaking) {
        drawFlatWave();
        return;
      }
      let phase = 0;
      function fakeFrame(){
        if (sessionState !== 'speaking') {
          drawFlatWave();
          return;
        }
        const w = canvas.clientWidth || 600, h = canvas.clientHeight || 60;
        ctx2d.clearRect(0, 0, w, h);
        ctx2d.fillStyle = '#22d3ee';
        const barCount = 80, barWidth = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const v = 0.3 + 0.5 * Math.abs(Math.sin((i * 0.4) + phase * 0.1));
          const barH = Math.max(3, v * h * 0.9);
          ctx2d.fillRect(i * barWidth, (h - barH) / 2, barWidth - 1.5, barH);
        }
        phase += 1;
        rafId = requestAnimationFrame(fakeFrame);
      }
      fakeFrame();
      return;
    }

    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (sourceNode) { try { sourceNode.disconnect(); } catch {} sourceNode = null; }
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      function frame(){
        analyser.getByteFrequencyData(buf);
        const w = canvas.clientWidth || 600, h = canvas.clientHeight || 60;
        ctx2d.clearRect(0, 0, w, h);
        const barCount = 80;
        const barWidth = w / barCount;
        const step = Math.floor(buf.length / barCount);
        ctx2d.fillStyle = '#22d3ee';
        for (let i = 0; i < barCount; i++) {
          const v = buf[i * step] / 255;
          const barH = Math.max(2, v * h * 0.95);
          ctx2d.fillRect(i * barWidth, (h - barH) / 2, barWidth - 1.5, barH);
        }
        rafId = requestAnimationFrame(frame);
      }
      frame();
    } catch (e) {
      // Cross-origin or already-connected element; fall back to simulated
      let phase = 0;
      function frame2(){
        const w = canvas.clientWidth || 600, h = canvas.clientHeight || 60;
        ctx2d.clearRect(0, 0, w, h);
        ctx2d.fillStyle = '#22d3ee';
        const barCount = 80, barWidth = w / barCount;
        for (let i = 0; i < barCount; i++) {
          const v = 0.3 + 0.5 * Math.abs(Math.sin((i * 0.4) + phase * 0.1));
          const barH = Math.max(3, v * h * 0.9);
          ctx2d.fillRect(i * barWidth, (h - barH) / 2, barWidth - 1.5, barH);
        }
        phase += 1;
        rafId = requestAnimationFrame(frame2);
      }
      frame2();
    }
  }

  function stopWaveform(){
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    try { if (sourceNode) sourceNode.disconnect(); } catch {}
    sourceNode = null;
    drawFlatWave();
  }

  // Face management — keep BOTH static image and animated video in the DOM, toggle visibility per state.
  // Idle/listening/thinking → static image (mouth closed, hovering).
  // Speaking → video plays (mouth animates).
  // Paused → video pauses on current frame.
  let currentVideo = null;
  let currentStandby = null;
  let currentImage = null;
  let currentArchetype = null;

  function setFace(archetype){
    const faceEl = document.getElementById('rvm-face');
    if (!faceEl) return;
    if (archetype === currentArchetype && (currentVideo || currentImage)) return; // already set up
    faceEl.innerHTML = '';
    faceEl.classList.remove('fallback');
    currentVideo = null;
    currentStandby = null;
    currentImage = null;
    currentArchetype = archetype || null;
    if (!archetype) {
      faceEl.classList.add('fallback');
      faceEl.textContent = 'R';
      return;
    }

    // Static image — visible by default, hidden when video is shown
    const img = new Image();
    img.alt = archetypeLabel(archetype);
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block';
    img.onerror = () => {
      // No JPG either — go to letter glyph fallback
      if (!currentVideo) {
        faceEl.classList.add('fallback');
        faceEl.textContent = (archetype || 'R').slice(0, 1).toUpperCase();
      }
    };
    img.src = `/assets/archetypes/${archetype}.jpg`;
    faceEl.appendChild(img);
    currentImage = img;
    faceEl.style.position = 'relative';

    // Animated video — preloaded but hidden + paused until speaking state
    const video = document.createElement('video');
    video.src = `/assets/archetypes/${archetype}.mp4`;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
    video.onerror = () => {
      // No MP4 — image stays visible, video just doesn't activate during speaking
      currentVideo = null;
    };
    faceEl.appendChild(video);
    currentVideo = video;
    try { video.load(); } catch {}

    // Standby loop — plays between turns when file exists. Silent fallback if missing.
    const standby = document.createElement('video');
    standby.src = `/assets/archetypes/${archetype}-standby.mp4`;
    standby.loop = true;
    standby.muted = true;
    standby.playsInline = true;
    standby.preload = 'auto';
    standby.setAttribute('playsinline', '');
    standby.setAttribute('webkit-playsinline', '');
    standby.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none';
    standby.onerror = () => { currentStandby = null; };
    faceEl.appendChild(standby);
    currentStandby = standby;
    try { standby.load(); } catch {}
  }

  function showSpeakingFace(){
    if (currentStandby) { try { currentStandby.pause(); } catch {} currentStandby.style.display = 'none'; }
    if (currentVideo) {
      currentVideo.style.display = 'block';
      try {
        currentVideo.currentTime = 0;
        const p = currentVideo.play();
        if (p && p.catch) p.catch(() => {});
      } catch {}
      if (currentImage) currentImage.style.display = 'none';
    }
  }
  function showIdleFace(){
    if (currentVideo) {
      try { currentVideo.pause(); } catch {}
      currentVideo.style.display = 'none';
    }
    // Prefer standby loop; fall back to static image
    if (currentStandby && currentStandby.readyState >= 2) {
      currentStandby.style.display = 'block';
      try { currentStandby.play().catch(() => {}); } catch {}
      if (currentImage) currentImage.style.display = 'none';
    } else if (currentImage) {
      currentImage.style.display = 'block';
    }
  }
  function pauseSpeakingFace(){
    if (currentVideo) {
      try { currentVideo.pause(); } catch {}
      // keep video visible (paused on current frame)
    }
  }
  function resumeSpeakingFace(){
    if (currentVideo && currentVideo.style.display === 'block') {
      try { currentVideo.play().catch(() => {}); } catch {}
    }
  }

  // Clean up text for both subtitle display and TTS — strips markdown noise without breaking words
  function cleanForDisplay(text){
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[\*_`#>~|]/g, '')
      .replace(/\\([\w])/g, '$1')
      .replace(/[(){}\[\]]/g, ' ')
      .replace(/\s[—–]\s/g, ', ')
      .replace(/[—–]/g, ', ')
      .replace(/^[\s]*[•\u2022\u25CF\-\d]+[.)]?[\s]+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.\s*\./g, '.')
      .replace(/,\s*,/g, ',')
      .trim();
  }

  // Per-speech state for word-by-word reveal
  let revealWords = null;
  let revealAudio = null;
  let revealRaf = null;

  function setSubtitle(text){
    const el = document.getElementById('rvm-subtitle');
    if (!el) return;
    el.textContent = cleanForDisplay(text);
    // Anchor at bottom — newest text always visible, older fades up
    const win = document.getElementById('rvm-subtitle-window');
    if (win) win.scrollTop = win.scrollHeight;
  }

  // Build word→time map from ElevenLabs character-level alignment.
  // alignment shape: { characters: [...], character_start_times_seconds: [...], character_end_times_seconds: [...] }
  function buildWordTimeMap(alignment){
    if (!alignment || !Array.isArray(alignment.characters)) return null;
    const chars = alignment.characters;
    const starts = alignment.character_start_times_seconds || [];
    const ends = alignment.character_end_times_seconds || [];
    const words = [];
    let cur = '';
    let curStart = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const isWS = /\s/.test(c);
      if (isWS) {
        if (cur) {
          words.push({ word: cur, start: curStart, end: ends[i - 1] != null ? ends[i - 1] : starts[i] });
          cur = '';
        }
      } else {
        if (!cur) curStart = starts[i] != null ? starts[i] : 0;
        cur += c;
      }
    }
    if (cur) {
      const lastEnd = ends.length ? ends[ends.length - 1] : curStart + 0.2;
      words.push({ word: cur, start: curStart, end: lastEnd });
    }
    return words;
  }

  function startWordReveal(text, audioEl, alignment){
    stopWordReveal();
    const el = document.getElementById('rvm-subtitle');
    const win = document.getElementById('rvm-subtitle-window');
    if (!el) return;
    const cleaned = cleanForDisplay(text);
    revealAudio = audioEl;
    el.textContent = '';
    if (win) win.scrollTop = 0;

    // Word-level timing map from ElevenLabs alignment, when available — exact sync.
    const timed = buildWordTimeMap(alignment);

    if (timed && timed.length && audioEl) {
      function tickTimed(){
        if (!revealAudio) return;
        const t = revealAudio.currentTime;
        let count = 0;
        for (let i = 0; i < timed.length; i++) {
          if (timed[i].start <= t) count = i + 1; else break;
        }
        const slice = timed.slice(0, count).map(w => w.word).join(' ');
        if (el.textContent !== slice) {
          el.textContent = slice;
          if (win) win.scrollTop = win.scrollHeight;
        }
        if (revealAudio.paused && revealAudio.currentTime > 0) return;
        if (count >= timed.length) {
          el.textContent = timed.map(w => w.word).join(' ');
          if (win) win.scrollTop = win.scrollHeight;
          return;
        }
        revealRaf = requestAnimationFrame(tickTimed);
      }
      revealRaf = requestAnimationFrame(tickTimed);
      return;
    }

    // Fallback: proportional reveal when no alignment data
    revealWords = cleaned ? cleaned.split(/\s+/) : [];
    if (!revealAudio || !revealWords.length) {
      el.textContent = cleaned;
      if (win) win.scrollTop = win.scrollHeight;
      return;
    }
    function tickProp(){
      if (!revealAudio) return;
      const dur = revealAudio.duration;
      if (!isFinite(dur) || dur <= 0) {
        revealRaf = requestAnimationFrame(tickProp);
        return;
      }
      const progress = Math.min(1, revealAudio.currentTime / dur);
      const count = Math.max(1, Math.floor(progress * revealWords.length) + 1);
      const slice = revealWords.slice(0, count).join(' ');
      if (el.textContent !== slice) {
        el.textContent = slice;
        if (win) win.scrollTop = win.scrollHeight;
      }
      if (revealAudio.paused && revealAudio.currentTime > 0) return;
      if (progress >= 1) {
        el.textContent = revealWords.join(' ');
        if (win) win.scrollTop = win.scrollHeight;
        return;
      }
      revealRaf = requestAnimationFrame(tickProp);
    }
    revealRaf = requestAnimationFrame(tickProp);
  }

  function stopWordReveal(){
    if (revealRaf) { cancelAnimationFrame(revealRaf); revealRaf = null; }
    revealWords = null;
    revealAudio = null;
  }

  function setArchetypeTag(archetype){
    const el = document.getElementById('rvm-archetype-tag');
    if (el) el.textContent = '#' + (archetype || 'plusultra');
  }

  // State machine for the voice-mode session.
  // States: 'idle' (just opened), 'listening' (mic active), 'thinking' (waiting on AI), 'speaking' (audio + face animating)
  let sessionActive = false;
  let sessionArchetype = null;
  let sessionState = 'idle';
  let sessionExitHandler = null;
  let sessionMicHandler = null;   // called when user taps mic — chat surface implements
  let speechRec = null;
  let speechRecognizing = false;

  function setState(state){
    sessionState = state;
    const overlay = document.getElementById('rvm-overlay');
    if (!overlay) return;
    overlay.dataset.state = state;
    const status = overlay.querySelector('#rvm-status-bar span:nth-child(2)');
    if (status) {
      status.textContent =
        state === 'listening' ? 'Listening' :
        state === 'thinking'  ? 'Thinking' :
        state === 'speaking'  ? 'Speaking' :
        state === 'paused'    ? 'Paused' :
        'Voice Active';
    }
    // Phase 14.1: face only animates while speaking
    if (state === 'speaking') showSpeakingFace();
    else if (state === 'paused') pauseSpeakingFace();
    else showIdleFace();
  }

  function startMic(onTranscript){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSubtitle('Voice input not supported in this browser. Try Chrome, Edge, or Safari.');
      return;
    }
    if (speechRecognizing) {
      try { speechRec && speechRec.stop(); } catch {}
      return;
    }
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    speechRec = r;
    speechRecognizing = true;
    setState('listening');
    const micBtn = document.getElementById('rvm-mic-btn');
    if (micBtn) micBtn.classList.add('listening');
    let finalTranscript = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalTranscript += res[0].transcript;
        else interim += res[0].transcript;
      }
      const live = (finalTranscript + interim).trim();
      if (live) setSubtitle(live);
    };
    r.onerror = () => {};
    r.onend = () => {
      speechRecognizing = false;
      speechRec = null;
      if (micBtn) micBtn.classList.remove('listening');
      const text = finalTranscript.trim();
      if (text && onTranscript) {
        onTranscript(text);
      } else {
        setState('idle');
        setSubtitle('Tap the mic to speak.');
      }
    };
    try { r.start(); } catch (err) {
      speechRecognizing = false;
      if (micBtn) micBtn.classList.remove('listening');
    }
  }

  function wireMicButton(){
    const micBtn = document.getElementById('rvm-mic-btn');
    if (!micBtn || micBtn._wired) return;
    micBtn._wired = true;
    micBtn.addEventListener('click', () => {
      if (!sessionMicHandler) {
        startMic((t) => { setSubtitle('You said: ' + t); setState('idle'); });
        return;
      }
      if (speechRecognizing) {
        try { speechRec && speechRec.stop(); } catch {}
        return;
      }
      startMic((transcript) => {
        try { sessionMicHandler(transcript); } catch {}
        setState('thinking');
        setSubtitle('Thinking, please hold.');
      });
    });
  }

  function wireTextInput(){
    const inp = document.getElementById('rvm-text-input');
    if (!inp || inp._wired) return;
    inp._wired = true;
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = inp.value.trim();
        if (!text) return;
        inp.value = '';
        if (sessionMicHandler) {
          try { sessionMicHandler(text); } catch {}
          setState('thinking');
          setSubtitle('Thinking, please hold.');
        }
      }
    });
  }

  function setPauseIcon(paused){
    const svg = document.getElementById('rvm-pause-icon');
    if (!svg) return;
    if (paused) {
      // Play triangle
      svg.innerHTML = '<polygon points="6 4 20 12 6 20" />';
    } else {
      // Pause bars
      svg.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';
    }
    const btn = document.getElementById('rvm-pause-btn');
    if (btn) btn.title = paused ? 'Resume' : 'Pause';
  }

  function wirePlaybackControls(){
    const pauseBtn = document.getElementById('rvm-pause-btn');
    const stopBtn = document.getElementById('rvm-stop-btn');
    const restartBtn = document.getElementById('rvm-restart-btn');

    if (pauseBtn && !pauseBtn._wired) {
      pauseBtn._wired = true;
      pauseBtn.addEventListener('click', () => {
        const audio = currentAudio;
        if (audio) {
          if (audio.paused) {
            try { audio.play(); } catch {}
            resumeSpeakingFace();
            setState('speaking');
            setPauseIcon(false);
          } else {
            audio.pause();
            pauseSpeakingFace();
            setState('paused');
            setPauseIcon(true);
          }
          return;
        }
        // Browser TTS path
        if ('speechSynthesis' in window) {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            resumeSpeakingFace();
            setState('speaking');
            setPauseIcon(false);
          } else if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause();
            pauseSpeakingFace();
            setState('paused');
            setPauseIcon(true);
          }
        }
      });
    }

    if (stopBtn && !stopBtn._wired) {
      stopBtn._wired = true;
      stopBtn.addEventListener('click', () => {
        if (currentAudio) { try { currentAudio.pause(); currentAudio.currentTime = 0; } catch {} }
        if (currentVideo) { try { currentVideo.pause(); currentVideo.currentTime = 0; } catch {} }
        try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
        if (currentOnHide) { try { currentOnHide(); } catch {} }
        currentAudio = null;
        if (sessionActive) {
          setState('idle');
          setSubtitle('Tap the mic to speak.');
          stopWaveform();
          startWaveform(null);
          setPauseIcon(false);
        } else {
          window.RyujinVoiceMode.hide();
        }
      });
    }

    if (restartBtn && !restartBtn._wired) {
      restartBtn._wired = true;
      restartBtn.addEventListener('click', () => {
        if (currentAudio) {
          try { currentAudio.currentTime = 0; currentAudio.play(); } catch {}
        }
        if (currentVideo) {
          try { currentVideo.currentTime = 0; currentVideo.play(); } catch {}
        }
        setPauseIcon(false);
        if (sessionActive) setState('speaking');
      });
    }
  }

  window.RyujinVoiceMode = {
    // Entering a persistent voice-mode session (clicked speaker icon).
    // exitHandler is called when user dismisses (click X / Escape / background).
    // micHandler(transcript) is called when user finishes speaking via the mic — chat surface sends to /api/chat.
    enter(archetype, exitHandler, micHandler){
      injectStyles();
      buildOverlay();
      sessionActive = true;
      sessionArchetype = archetype || sessionArchetype || 'ruler';
      sessionExitHandler = exitHandler || null;
      sessionMicHandler = micHandler || null;
      setFace(sessionArchetype);
      setArchetypeTag(sessionArchetype);
      setSubtitle('Tap the mic to speak.');
      stopWaveform();
      startWaveform(null);
      document.getElementById('rvm-overlay').classList.add('on');
      // Hide the agent rail in plain Speech Mode
      const rail = document.getElementById('rvm-rail');
      if (rail) rail.hidden = true;
      wireMicButton();
      wireTextInput();
      wirePlaybackControls();
      setState('idle');
    },
    exit(){
      const rail = document.getElementById('rvm-rail');
      if (rail) rail.hidden = true;
      const root = document.getElementById('rvm-overlay');
      if (root) root.classList.remove('on');
      stopWaveform();
      stopWordReveal();
      try { speechRec && speechRec.stop(); } catch {}
      speechRec = null;
      speechRecognizing = false;
      sessionActive = false;
      sessionState = 'idle';
      const handler = sessionExitHandler;
      sessionExitHandler = null;
      sessionMicHandler = null;
      currentAudio = null;
      currentOnHide = null;
      if (handler) { try { handler(); } catch {} }
    },
    isActive(){ return sessionActive; },
    getState(){ return sessionState; },
    getArchetype(){ return sessionArchetype; },

    // Phase 17: Agent Mode — opens overlay in pre-routing state (loading bubble face, "What's your request?" prompt).
    // After user submits, the chat surface fires the request; the SSE `matched_archetype` event triggers setMatchedArchetype()
    // which swaps face + chip to the routed archetype.
    // exitHandler / micHandler same as enter().
    enterAgentMode(exitHandler, micHandler){
      injectStyles();
      buildOverlay();
      sessionActive = true;
      sessionArchetype = null; // not yet matched
      sessionExitHandler = exitHandler || null;
      sessionMicHandler = micHandler || null;
      // Set face to agent loading bubble (no archetype yet)
      const faceEl = document.getElementById('rvm-face');
      if (faceEl) {
        faceEl.innerHTML = '';
        faceEl.classList.remove('fallback');
        const img = new Image();
        img.alt = 'Finding agent';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;padding:8%';
        img.onerror = () => {
          faceEl.classList.add('fallback');
          faceEl.textContent = '?';
        };
        img.src = '/assets/picker/agent-loading.jpg';
        faceEl.style.position = 'relative';
        faceEl.appendChild(img);
        currentImage = img;
        currentVideo = null;
        currentArchetype = null;
      }
      setArchetypeTag('agent');
      const tagEl = document.getElementById('rvm-archetype-tag');
      if (tagEl) tagEl.textContent = 'finding agent';
      setSubtitle("What's your request?");
      // Show side rail (agent-only chrome)
      const rail = document.getElementById('rvm-rail');
      if (rail) {
        rail.hidden = false;
        const archEl = document.getElementById('rvm-rail-arch');
        const lensEl = document.getElementById('rvm-rail-lens');
        if (archEl) archEl.textContent = 'finding…';
        if (lensEl) lensEl.textContent = 'Routing your request to the best lens.';
      }
      stopWaveform();
      startWaveform(null);
      document.getElementById('rvm-overlay').classList.add('on');
      wireMicButton();
      wireTextInput();
      wirePlaybackControls();
      setState('idle');
    },

    // Called by chat surface when SSE `matched_archetype` event arrives. Swaps face + chip in place.
    setMatchedArchetype(slug){
      if (!slug || !sessionActive) return;
      sessionArchetype = slug;
      currentArchetype = null; // force setFace to rebuild
      setFace(slug);
      setArchetypeTag(slug);
      // Update rail
      const archEl = document.getElementById('rvm-rail-arch');
      const lensEl = document.getElementById('rvm-rail-lens');
      const lenses = {
        ruler:'Strategy & governance', caregiver:'Operations & customer care',
        hero:'Sales & closing', creator:'Production & build',
        sage:'Knowledge & analysis', magician:'Tech & transformation',
        explorer:'Marketing & frontier', jester:'Creative & light',
        lover:'Relationships & brand', innocent:'Onboarding & fresh start',
        everyman:'Relatable & grounded', outlaw:'Disruption & challenge'
      };
      if (archEl) archEl.textContent = archetypeLabel(slug);
      if (lensEl) lensEl.textContent = lenses[slug] || '';
    },

    // Per-message bridges (used while a session is active OR for legacy auto-speak fallback).
    // When session active: updates the active overlay (face + waveform + subtitle).
    // When session NOT active: opens the overlay for just this message (legacy behavior).
    show(text, archetype, audioEl, onHide, alignment){
      injectStyles();
      buildOverlay();
      if (!sessionActive) {
        sessionExitHandler = null;
      }
      sessionArchetype = archetype || sessionArchetype || null;
      setFace(sessionArchetype);
      setArchetypeTag(sessionArchetype);
      currentAudio = audioEl || null;
      currentOnHide = onHide || null;
      stopWaveform();
      startWaveform(audioEl || null);
      document.getElementById('rvm-overlay').classList.add('on');
      wireMicButton();
      wireTextInput();
      wirePlaybackControls();
      setPauseIcon(false);
      setState('speaking');
      // Word-level sync when alignment data is provided (ElevenLabs timestamps).
      // Falls back to time-proportional reveal otherwise.
      startWordReveal(text || '', audioEl || null, alignment || null);
    },
    updateSubtitle(text){ setSubtitle(text); },
    setState(state){ setState(state); },
    setStatusThinking(label){ setSubtitle(label || 'Thinking...'); setState('thinking'); },
    setStatusListening(transcript){ setSubtitle(transcript || 'Listening...'); setState('listening'); },

    // Legacy: for non-session per-message overlays, hide() exits like the old behavior
    hide(userInitiated){
      stopWordReveal();
      if (sessionActive) {
        stopWaveform();
        startWaveform(null);
        setSubtitle('Tap the mic to speak.');
        setState('idle');
        if (userInitiated && currentOnHide) { try { currentOnHide(); } catch {} }
        currentAudio = null;
        currentOnHide = null;
        return;
      }
      const root = document.getElementById('rvm-overlay');
      if (!root) return;
      root.classList.remove('on');
      stopWaveform();
      if (userInitiated && currentOnHide) { try { currentOnHide(); } catch {} }
      currentAudio = null;
      currentOnHide = null;
    }
  };

  // Override the close handlers so they call exit() when in session mode
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'rvm-close-btn' && sessionActive) {
      e.stopPropagation();
      window.RyujinVoiceMode.exit();
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sessionActive) {
      window.RyujinVoiceMode.exit();
    }
  });
})();
