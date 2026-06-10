// ═══════════════════════════════════════════════════════════════
// Jarvis dock - the cockpit voice surface. One script tag per page:
//   <script src="/assets/jarvis-dock.js" defer></script>
// (loads /assets/jarvis-dock.css + /assets/voice-core.js itself).
//
// Collapsed: 48px mic pill, bottom-right, zero idle animation.
// Open: right-docked panel = state header + Jarvis Brief (gated
// /api/metrics, labels rendered verbatim) + transcript + mic/text.
//
// Hotkeys: Ctrl+Shift+V toggle · hold Space = push-to-talk (outside
// inputs) · Esc stops speech, second Esc closes.
//
// Write safety: a SPOKEN bare "yes" never fires queued approvals.
// If the last reply carries approval codes, an affirmative transcript
// renders a click-to-approve card instead (click sends it as text).
// ═══════════════════════════════════════════════════════════════
(function () {
  if (window.__jarvisDock) return;
  window.__jarvisDock = true;

  const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';

  function token() {
    try { return localStorage.getItem('ryujin_token') || ''; } catch { return ''; }
  }

  // ── lazy asset loading: pill is instant, engine loads on first use ──
  let coreReady = null;
  function ensureCore() {
    if (window.RyujinVoiceCore) return Promise.resolve(true);
    if (coreReady) return coreReady;
    coreReady = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = '/assets/voice-core.js';
      s.onload = () => resolve(!!window.RyujinVoiceCore);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return coreReady;
  }
  (function ensureCss() {
    if (document.querySelector('link[href*="jarvis-dock.css"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/assets/jarvis-dock.css';
    document.head.appendChild(l);
  })();

  // ── DOM ─────────────────────────────────────────────────────
  const pill = document.createElement('button');
  pill.id = 'jarvis-pill';
  pill.title = 'Jarvis (Ctrl+Shift+V)';
  pill.setAttribute('aria-label', 'Open Jarvis voice assistant');
  pill.innerHTML = MIC_SVG;

  const dock = document.createElement('aside');
  dock.id = 'jarvis-dock';
  dock.dataset.state = 'idle';
  dock.setAttribute('role', 'dialog');
  dock.setAttribute('aria-label', 'Jarvis voice assistant');
  dock.innerHTML = [
    '<div class="jv-head">',
    '  <div class="jv-title">JARVIS</div>',
    '  <div class="jv-eq" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>',
    '  <div class="jv-state" id="jv-state" role="status">Tap the mic or press Ctrl+Shift+V</div>',
    '  <button class="jv-close" id="jv-close" aria-label="Close Jarvis">&times;</button>',
    '</div>',
    '<div class="jv-brief" id="jv-brief">',
    '  <div class="jv-brief-head">',
    '    <div class="jv-brief-title">Jarvis Brief</div>',
    '    <button class="jv-brief-speak" id="jv-speak-brief">SPEAK MY BRIEFING</button>',
    '  </div>',
    '  <div class="jv-kpis" id="jv-kpis"></div>',
    '</div>',
    '<div class="jv-msgs" id="jv-msgs" aria-live="polite"></div>',
    '<div class="jv-foot">',
    '  <div class="jv-input-row">',
    '    <button id="jv-mic" aria-label="Push to talk">' + MIC_SVG + '</button>',
    '    <input id="jv-text" type="text" placeholder="Or type it..." autocomplete="off">',
    '    <button id="jv-send">SEND</button>',
    '  </div>',
    '  <div class="jv-hint">Ctrl+Shift+V toggle &middot; hold Space to talk &middot; Esc stops</div>',
    '</div>'
  ].join('\n');

  function mount() {
    document.body.appendChild(pill);
    document.body.appendChild(dock);
    syncFabOffset();
    // ryujin-chat.js builds its fab asynchronously; re-check so the pill
    // never sits on top of it.
    setTimeout(syncFabOffset, 1500);
    setTimeout(syncFabOffset, 4000);
    wire();
  }
  function syncFabOffset() {
    document.body.classList.toggle('jarvis-has-fab', !!document.getElementById('ry-fab'));
  }

  // ── state + transcript rendering ────────────────────────────
  const $ = (id) => document.getElementById(id);
  const STATE_LABEL = {
    idle: 'Tap the mic or press Ctrl+Shift+V',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking. Tap to interrupt',
    error: 'Error'
  };

  let interimNode = null;
  let aiNode = null;
  let chips = {};               // tool_use id -> chip element
  // Accumulated from deltas (not assistant_done) so the approval guard still
  // sees codes from a reply the user barged into mid-stream.
  let assistantBuffer = '';
  let wiredCore = false;
  let spaceHeld = false;

  function setDockState(state, detail) {
    dock.dataset.state = state;
    const el = $('jv-state');
    if (el) el.textContent = state === 'error' && detail ? detail : (STATE_LABEL[state] || state);
    pill.classList.toggle('busy', state === 'thinking' || state === 'speaking');
  }

  function scrollMsgs() {
    const m = $('jv-msgs');
    if (m) m.scrollTop = m.scrollHeight;
  }
  function addBubble(cls, text) {
    const el = document.createElement('div');
    el.className = 'jv-bubble ' + cls;
    el.textContent = text;
    $('jv-msgs').appendChild(el);
    scrollMsgs();
    return el;
  }
  function addSys(text) {
    const el = document.createElement('div');
    el.className = 'jv-sys';
    el.textContent = text;
    $('jv-msgs').appendChild(el);
    scrollMsgs();
    return el;
  }

  function wireCoreEvents() {
    if (wiredCore || !window.RyujinVoiceCore) return;
    wiredCore = true;
    const core = window.RyujinVoiceCore;

    core.on('state', ({ state, detail }) => {
      setDockState(state, detail);
      // No final transcript arrived (silence, error, cancel): drop the ghost.
      if (state !== 'listening' && state !== 'thinking' && interimNode) {
        interimNode.remove();
        interimNode = null;
      }
    });

    core.on('interim', (text) => {
      if (!interimNode) interimNode = addBubble('user interim', text);
      else interimNode.textContent = text;
      scrollMsgs();
    });

    core.on('user_text', (text) => {
      if (interimNode) { interimNode.remove(); interimNode = null; }
      addBubble('user', text);
      aiNode = null;
      chips = {};
      assistantBuffer = '';
    });

    core.on('assistant_delta', (text) => {
      if (!aiNode) aiNode = addBubble('ai', '');
      aiNode.textContent += text;
      assistantBuffer += text;
      scrollMsgs();
    });

    core.on('assistant_done', () => {
      aiNode = null;
    });

    core.on('tool_step', (step) => {
      if (step.status === 'start') {
        const chip = document.createElement('div');
        chip.className = 'jv-chip';
        chip.textContent = '▸ ' + (step.label || 'Working');
        chips[step.id] = chip;
        $('jv-msgs').appendChild(chip);
        scrollMsgs();
      } else {
        const chip = chips[step.id];
        if (!chip) return;
        if (step.status === 'error') {
          chip.classList.add('err');
          chip.textContent = '⚠ ' + chip.textContent.replace(/^▸ /, '') + ' (failed: ' + (step.error || 'unknown') + ')';
        } else {
          chip.textContent = '✓ ' + chip.textContent.replace(/^▸ /, '');
        }
      }
    });

    core.on('error', (msg) => addSys(msg));
  }

  // ── spoken-affirmative approval guard ───────────────────────
  // If the last reply carries approval codes and the SPOKEN transcript is a
  // bare affirmative, render a click-to-approve card instead of sending.
  // Typed input bypasses this (typing "yes" is a deliberate act).
  const APPROVAL_CODE_RE = /\b[A-Z]{3}-\d{3}\b/;
  const BARE_AFFIRMATIVE_RE = /^(yes|yep|yeah|yup|go|go ahead|do it|approve|approved|confirm|confirmed|send it|ship it|ok|okay)[.! ]*$/i;

  function spokenApprovalGuard(text) {
    if (!APPROVAL_CODE_RE.test(assistantBuffer) || !BARE_AFFIRMATIVE_RE.test(String(text).trim())) return false;
    if (interimNode) { interimNode.remove(); interimNode = null; }
    addBubble('user', text);
    addSys('Queued writes need a click, not a spoken yes.');
    const card = document.createElement('button');
    card.className = 'jv-approve';
    card.textContent = 'APPROVE QUEUED ACTIONS';
    card.onclick = () => { card.remove(); window.RyujinVoiceCore.sendText('yes, approve'); };
    $('jv-msgs').appendChild(card);
    scrollMsgs();
    return true; // consumed: the engine will NOT send the utterance
  }

  async function startMic(fromSpace) {
    const ok = await ensureCore();
    if (!ok) { addSys('voice-core.js failed to load. Refresh and retry.'); return; }
    wireCoreEvents();
    if (!token()) {
      addSys('Not signed in. Jarvis needs a session: open /login.html, then come back.');
      return;
    }
    // Space was released while voice-core was still loading: don't start a
    // mic session nobody is holding.
    if (fromSpace && !spaceHeld) return;
    const core = window.RyujinVoiceCore;
    core.setSendInterceptor(spokenApprovalGuard);
    core.startListening();
  }

  function stopMic() {
    if (window.RyujinVoiceCore) window.RyujinVoiceCore.stopListening();
  }

  async function sendTyped() {
    const input = $('jv-text');
    const text = (input.value || '').trim();
    if (!text) return;
    const ok = await ensureCore();
    if (!ok) { addSys('voice-core.js failed to load. Refresh and retry.'); return; }
    wireCoreEvents();
    if (!token()) { addSys('Not signed in. Jarvis needs a session: open /login.html, then come back.'); return; }
    input.value = '';
    window.RyujinVoiceCore.sendText(text);
  }

  // ── panel open/close ────────────────────────────────────────
  let briefLoaded = false;
  function openDock() {
    dock.classList.add('open');
    if (!briefLoaded) { briefLoaded = true; loadBrief(); }
    const input = $('jv-text');
    if (input) input.focus({ preventScroll: true });
  }
  function closeDock() {
    dock.classList.remove('open');
    if (window.RyujinVoiceCore) window.RyujinVoiceCore.cancel();
  }
  function toggleDock() {
    if (dock.classList.contains('open')) closeDock();
    else openDock();
  }

  // ── Jarvis Brief: gated /api/metrics, labels byte-verbatim ──
  const BRIEF_PATHS = [
    ['signed', 'mtd'],
    ['pipeline', 'proposalsOut'],
    ['pipeline', 'signedBacklog'],
    ['collected', 'd7'],
    ['ads', 'cpl30d']
  ];
  function fmtValue(v) {
    if (v === null || v === undefined) return 'n/a';
    // Render the shipped value: cpl30d carries cents, the rest are whole dollars.
    if (typeof v === 'number') return '$' + v.toLocaleString('en-CA', { maximumFractionDigits: 2 });
    return String(v);
  }
  function briefError(host, msg) {
    host.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'jv-brief-err';
    el.textContent = msg;
    host.appendChild(el);
  }
  async function loadBrief() {
    const host = $('jv-kpis');
    if (!host) return;
    const t = token();
    if (!t) {
      briefError(host, 'Sign in to see live numbers.');
      return;
    }
    try {
      const r = await fetch('/api/metrics', { headers: { Authorization: 'Bearer ' + t } });
      if (!r.ok) {
        briefError(host, 'Brief unavailable: /api/metrics HTTP ' + r.status);
        return;
      }
      const m = await r.json();
      if (m.contract !== 'v1') {
        briefError(host, 'Brief unavailable: unexpected metrics contract "' + (m.contract || 'none') + '"');
        return;
      }
      host.innerHTML = '';
      for (const [a, b] of BRIEF_PATHS) {
        const kpi = m[a] && m[a][b];
        if (!kpi || typeof kpi.label !== 'string') continue;
        const card = document.createElement('div');
        card.className = 'jv-kpi';
        const val = document.createElement('div');
        val.className = 'jv-kpi-value';
        val.textContent = fmtValue(kpi.value);
        const label = document.createElement('div');
        label.className = 'jv-kpi-label';
        label.textContent = kpi.label; // contract rule: render the shipped label, no page-side wording
        card.appendChild(val);
        card.appendChild(label);
        host.appendChild(card);
      }
      if (!host.children.length) {
        briefError(host, 'Metrics returned no renderable KPIs.');
      }
    } catch (e) {
      briefError(host, 'Brief fetch failed: ' + (e && e.message ? e.message : 'network'));
    }
  }

  // ── wiring ──────────────────────────────────────────────────
  function wire() {
    pill.addEventListener('click', () => {
      openDock();
      startMic(); // one gesture: open + listen (and the click unlocks audio autoplay)
    });
    $('jv-close').addEventListener('click', closeDock);
    $('jv-send').addEventListener('click', sendTyped);
    $('jv-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendTyped(); }
    });

    $('jv-mic').addEventListener('click', () => {
      const core = window.RyujinVoiceCore;
      if (core && core.isListening) stopMic();
      else startMic(); // startListening() barge-ins via cancel() internally
    });

    // Speaking state label doubles as the interrupt affordance.
    $('jv-state').addEventListener('click', () => {
      if (dock.dataset.state === 'speaking' && window.RyujinVoiceCore) window.RyujinVoiceCore.cancel();
    });

    $('jv-speak-brief').addEventListener('click', async () => {
      const ok = await ensureCore();
      if (!ok) { addSys('voice-core.js failed to load. Refresh and retry.'); return; }
      wireCoreEvents();
      if (!token()) { addSys('Not signed in. Jarvis needs a session: open /login.html, then come back.'); return; }
      window.RyujinVoiceCore.sendText('Give me my morning brief: signed this month, what needs me today, and anything overdue. Four short sentences max.');
    });

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        toggleDock();
        return;
      }
      if (!dock.classList.contains('open')) return;
      const inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (e.key === 'Escape') {
        const core = window.RyujinVoiceCore;
        if (core && (core.state === 'speaking' || core.state === 'thinking' || core.state === 'listening')) core.cancel();
        else closeDock();
        return;
      }
      if (e.code === 'Space' && !inInput && !e.repeat) {
        e.preventDefault();
        spaceHeld = true;
        startMic(true);
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') spaceHeld = false;
      if (!dock.classList.contains('open')) return;
      const inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (e.code === 'Space' && !inInput) stopMic();
    });
  }

  // Mount last: every const/function above is initialized before wire() runs
  // (this script loads with defer, so readyState is usually 'interactive' and
  // mount() executes synchronously right here).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
