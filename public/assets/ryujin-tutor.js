// ────────────────────────────────────────────────────────────────────
// Ryujin Tutor — MTGA-style guided tour with spotlight + dragon narration
// Usage:
//   RyujinTutor.register('dashboard', [
//     { target: '#dragonStage', title: 'Meet your sentinel', body: '...', position: 'right' },
//     ...
//   ]);
//   RyujinTutor.start('dashboard');   // manual trigger
//   RyujinTutor.auto('dashboard');    // run once per browser (stored in localStorage)
// ────────────────────────────────────────────────────────────────────
(function(){
  const T = window.RyujinTutor = window.RyujinTutor || {};
  const sequences = {};
  T._registered = sequences;        // public read for other scripts (auto-tutor)
  T.has = (id) => !!sequences[id];
  T.any = () => Object.keys(sequences).length > 0;
  let current = null;
  let stepIdx = 0;
  let keyHandler = null;

  const STYLES = `
  #rt-root{position:fixed;inset:0;z-index:9990;pointer-events:none;font-family:'Inter',system-ui,sans-serif}
  #rt-backdrop{position:absolute;inset:0;background:rgba(3,6,17,0.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:none;opacity:0;transition:opacity 0.4s}
  #rt-backdrop.on{opacity:1;pointer-events:auto}
  #rt-spotlight{position:absolute;border-radius:14px;box-shadow:0 0 0 9999px rgba(3,6,17,0.78),0 0 28px 6px rgba(34,211,238,0.45),inset 0 0 20px rgba(34,211,238,0.15);pointer-events:none;transition:all 0.5s cubic-bezier(.2,.8,.3,1);opacity:0;border:2px solid rgba(34,211,238,0.65);animation:rtPulse 2.5s ease-in-out infinite}
  #rt-spotlight.on{opacity:1}
  @keyframes rtPulse{0%,100%{box-shadow:0 0 0 9999px rgba(3,6,17,0.78),0 0 28px 6px rgba(34,211,238,0.45),inset 0 0 20px rgba(34,211,238,0.15)}50%{box-shadow:0 0 0 9999px rgba(3,6,17,0.8),0 0 40px 10px rgba(34,211,238,0.7),inset 0 0 24px rgba(34,211,238,0.25)}}

  #rt-popup{position:absolute;max-width:360px;background:rgba(6,12,24,0.98);border:1px solid rgba(34,211,238,0.4);border-radius:14px;backdrop-filter:blur(20px);box-shadow:0 20px 60px rgba(0,0,0,0.55),0 0 40px rgba(34,211,238,0.2);pointer-events:auto;opacity:0;transform:scale(0.94);transition:all 0.35s cubic-bezier(.2,.8,.3,1.05);overflow:hidden}
  #rt-popup.on{opacity:1;transform:scale(1)}
  #rt-popup::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,#7c3aed,transparent);opacity:0.75}
  .rt-arrow{position:absolute;width:16px;height:16px;background:rgba(6,12,24,0.98);border:1px solid rgba(34,211,238,0.4);transform:rotate(45deg)}

  .rt-head{display:flex;align-items:center;gap:11px;padding:14px 18px 10px}
  .rt-avatar{width:38px;height:38px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(220,240,255,0.35),rgba(34,211,238,0.3) 35%,rgba(10,25,50,0.9) 80%);border:1px solid rgba(34,211,238,0.4);box-shadow:0 0 16px rgba(34,211,238,0.35);flex-shrink:0;position:relative;overflow:hidden;animation:rtGlow 3s ease-in-out infinite}
  .rt-avatar::after{content:'';position:absolute;top:7px;left:11px;width:10px;height:5px;background:rgba(255,255,255,0.3);border-radius:50%;transform:rotate(-20deg);filter:blur(1px)}
  @keyframes rtGlow{0%,100%{box-shadow:0 0 16px rgba(34,211,238,0.3)}50%{box-shadow:0 0 22px rgba(34,211,238,0.5)}}
  .rt-who{flex:1;min-width:0}
  .rt-who .n{font-family:'Orbitron',sans-serif;font-size:0.68em;font-weight:800;letter-spacing:2px;color:#e0e6f0}
  .rt-who .s{font-family:'Share Tech Mono',monospace;font-size:0.58em;color:#22d3ee;letter-spacing:1px}
  .rt-progress{font-family:'Share Tech Mono',monospace;font-size:0.58em;color:rgba(160,190,230,0.55);letter-spacing:0.5px}

  .rt-title{padding:0 18px;font-family:'Orbitron',sans-serif;font-size:0.88em;font-weight:800;letter-spacing:1px;color:#22d3ee;margin-bottom:6px}
  .rt-body{padding:0 18px 14px;font-size:0.86em;line-height:1.55;color:#e0e6f0}
  .rt-body b{color:#22d3ee}
  .rt-body code{font-family:'Share Tech Mono',monospace;font-size:0.88em;background:rgba(34,211,238,0.08);padding:1px 6px;border-radius:4px;color:#67e8f9}

  .rt-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 18px 14px;gap:8px;border-top:1px solid rgba(34,211,238,0.1)}
  .rt-dots{display:flex;gap:5px}
  .rt-dot{width:7px;height:7px;border-radius:50%;background:rgba(34,211,238,0.2);transition:all 0.25s}
  .rt-dot.on{background:#22d3ee;box-shadow:0 0 6px #22d3ee}
  .rt-dot.done{background:rgba(34,211,238,0.6)}
  .rt-btns{display:flex;gap:6px}
  .rt-btn{padding:7px 14px;border-radius:7px;font-family:'Orbitron',sans-serif;font-size:0.64em;font-weight:700;letter-spacing:1.3px;cursor:pointer;border:1px solid;transition:all 0.2s}
  .rt-btn.primary{background:linear-gradient(135deg,rgba(34,211,238,0.3),rgba(34,211,238,0.12));color:#22d3ee;border-color:rgba(34,211,238,0.45);font-weight:800}
  .rt-btn.primary:hover{box-shadow:0 0 12px rgba(34,211,238,0.3)}
  .rt-btn.ghost{background:rgba(6,10,20,0.5);color:rgba(160,190,230,0.65);border-color:rgba(34,211,238,0.2)}
  .rt-btn.ghost:hover{color:#e0e6f0;border-color:rgba(34,211,238,0.4)}

  #rt-floating{position:fixed;bottom:14px;left:14px;z-index:9989;display:none;align-items:center;gap:10px;padding:10px 14px;background:rgba(6,12,24,0.95);border:1px solid rgba(34,211,238,0.3);border-radius:12px;backdrop-filter:blur(10px);box-shadow:0 6px 20px rgba(0,0,0,0.5);cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:0.72em;color:#22d3ee;letter-spacing:1px;animation:rtFloat 3s ease-in-out infinite}
  #rt-floating.on{display:flex}
  #rt-floating:hover{box-shadow:0 8px 28px rgba(0,0,0,0.55),0 0 20px rgba(34,211,238,0.3)}
  #rt-floating .avatar{width:26px;height:26px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(220,240,255,0.35),rgba(34,211,238,0.3) 35%,rgba(10,25,50,0.9) 80%);border:1px solid rgba(34,211,238,0.5)}
  @keyframes rtFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  `;

  function injectStyles(){
    if (document.getElementById('rt-styles')) return;
    const s = document.createElement('style');
    s.id = 'rt-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function createDom(){
    if (document.getElementById('rt-root')) return;
    const root = document.createElement('div');
    root.id = 'rt-root';
    root.innerHTML = `
      <div id="rt-backdrop"></div>
      <div id="rt-spotlight"></div>
      <div id="rt-popup">
        <div class="rt-arrow"></div>
        <div class="rt-head">
          <div class="rt-avatar"></div>
          <div class="rt-who"><div class="n">RYUJIN</div><div class="s" id="rt-sector">TUTORIAL</div></div>
          <div class="rt-progress" id="rt-prog">1 / N</div>
        </div>
        <div class="rt-title" id="rt-title"></div>
        <div class="rt-body" id="rt-body"></div>
        <div class="rt-foot">
          <div class="rt-dots" id="rt-dots"></div>
          <div class="rt-btns">
            <button class="rt-btn ghost" id="rt-skip">SKIP</button>
            <button class="rt-btn ghost" id="rt-back">BACK</button>
            <button class="rt-btn primary" id="rt-next">NEXT</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    document.getElementById('rt-next').addEventListener('click', () => next());
    document.getElementById('rt-back').addEventListener('click', () => back());
    document.getElementById('rt-skip').addEventListener('click', () => end(true));

    // Floating "Resume tutorial" pill
    const floating = document.createElement('div');
    floating.id = 'rt-floating';
    floating.innerHTML = `<div class="avatar"></div><span>Resume tutorial</span>`;
    floating.addEventListener('click', () => {
      floating.classList.remove('on');
      if (current) start(current.id);
    });
    document.body.appendChild(floating);
  }

  function positionPopup(target, position){
    const popup = document.getElementById('rt-popup');
    const spotlight = document.getElementById('rt-spotlight');
    const arrow = popup.querySelector('.rt-arrow');
    const PAD = 20;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let rect;
    if (target === '__center__') {
      rect = { top: vh/2 - 140, left: vw/2 - 140, width: 280, height: 280, bottom: vh/2 + 140, right: vw/2 + 140 };
      spotlight.classList.remove('on');
    } else {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) { rect = { top: vh/2 - 100, left: vw/2 - 100, width: 200, height: 200 }; }
      else rect = el.getBoundingClientRect();
      // Pad the spotlight around the element
      spotlight.classList.add('on');
      const padSp = 8;
      spotlight.style.top = (rect.top - padSp) + 'px';
      spotlight.style.left = (rect.left - padSp) + 'px';
      spotlight.style.width = (rect.width + padSp*2) + 'px';
      spotlight.style.height = (rect.height + padSp*2) + 'px';
    }

    // Preferred position; fall back if offscreen
    const popupW = 360, popupH = 260; // approx
    let pos = position || 'auto';
    if (pos === 'auto') {
      if (rect.right + popupW + PAD < vw) pos = 'right';
      else if (rect.left - popupW - PAD > 0) pos = 'left';
      else if (rect.bottom + popupH + PAD < vh) pos = 'bottom';
      else pos = 'top';
    }

    let top, left;
    arrow.style.cssText = '';
    if (pos === 'right') {
      top = Math.max(PAD, Math.min(rect.top + rect.height/2 - popupH/2, vh - popupH - PAD));
      left = Math.min(rect.right + PAD, vw - popupW - PAD);
      arrow.style.cssText = 'left:-9px;top:50%;margin-top:-8px;border-right:none;border-top:none';
    } else if (pos === 'left') {
      top = Math.max(PAD, Math.min(rect.top + rect.height/2 - popupH/2, vh - popupH - PAD));
      left = Math.max(PAD, rect.left - popupW - PAD);
      arrow.style.cssText = 'right:-9px;top:50%;margin-top:-8px;border-left:none;border-bottom:none';
    } else if (pos === 'bottom') {
      top = Math.min(rect.bottom + PAD, vh - popupH - PAD);
      left = Math.max(PAD, Math.min(rect.left + rect.width/2 - popupW/2, vw - popupW - PAD));
      arrow.style.cssText = 'top:-9px;left:50%;margin-left:-8px;border-bottom:none;border-right:none';
    } else {
      top = Math.max(PAD, rect.top - popupH - PAD);
      left = Math.max(PAD, Math.min(rect.left + rect.width/2 - popupW/2, vw - popupW - PAD));
      arrow.style.cssText = 'bottom:-9px;left:50%;margin-left:-8px;border-top:none;border-left:none';
    }

    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }

  function renderStep(){
    const step = current.steps[stepIdx];
    if (!step) { end(); return; }

    document.getElementById('rt-sector').textContent = (current.id || 'TUTORIAL').toUpperCase();
    document.getElementById('rt-title').textContent = step.title || '';
    document.getElementById('rt-body').innerHTML = step.body || '';
    document.getElementById('rt-prog').textContent = (stepIdx+1) + ' / ' + current.steps.length;

    // Dots
    const dots = current.steps.map((_, i) =>
      `<div class="rt-dot ${i === stepIdx ? 'on' : i < stepIdx ? 'done' : ''}"></div>`
    ).join('');
    document.getElementById('rt-dots').innerHTML = dots;

    document.getElementById('rt-back').style.display = stepIdx === 0 ? 'none' : '';
    document.getElementById('rt-next').textContent = stepIdx === current.steps.length - 1 ? 'FINISH' : 'NEXT';

    positionPopup(step.target || '__center__', step.position);
  }

  function next(){
    if (!current) return;
    if (stepIdx >= current.steps.length - 1) return end();
    stepIdx++;
    renderStep();
  }
  function back(){
    if (!current) return;
    if (stepIdx <= 0) return;
    stepIdx--;
    renderStep();
  }

  function start(id){
    const seq = sequences[id];
    if (!seq) { console.warn('RyujinTutor: no sequence', id); return; }
    injectStyles();
    createDom();
    current = { id, steps: seq };
    stepIdx = 0;
    document.getElementById('rt-backdrop').classList.add('on');
    document.getElementById('rt-popup').classList.add('on');
    document.getElementById('rt-floating').classList.remove('on');
    renderStep();

    keyHandler = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Escape') { e.preventDefault(); end(true); }
    };
    document.addEventListener('keydown', keyHandler);
  }

  function end(skipped){
    document.getElementById('rt-backdrop')?.classList.remove('on');
    document.getElementById('rt-popup')?.classList.remove('on');
    document.getElementById('rt-spotlight')?.classList.remove('on');
    if (current) {
      try { localStorage.setItem('rt_done_' + current.id, '1'); } catch(e){}
    }
    current = null;
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    // Nuke everything — no floating pill, no lingering DOM
    setTimeout(() => {
      if (!current) {
        document.getElementById('rt-root')?.remove();
        document.getElementById('rt-floating')?.remove();
      }
    }, 400);
  }

  T.register = function(id, steps){ sequences[id] = steps; };
  T.start = start;
  T.end = end;
  T.auto = function(id){
    try { if (localStorage.getItem('rt_done_' + id)) return; } catch(e){}
    // Wait for layout to settle, then start
    setTimeout(() => start(id), 1200);
  };
  T.reset = function(id){ try { localStorage.removeItem('rt_done_' + (id || '')); } catch(e){} };
  T.resetAll = function(){
    try { Object.keys(localStorage).filter(k => k.startsWith('rt_done_')).forEach(k => localStorage.removeItem(k)); } catch(e){}
  };
})();
