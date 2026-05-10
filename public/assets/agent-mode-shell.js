// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Agent-mode shell.
//
// Activates when window.RyujinMode.get() === 'agent'. Overlays the
// pillar dashboard with: pillar archetype avatar, chat transcript,
// text input, voice button (browser SpeechRecognition + TTS), and
// proposed-action confirm gates.
//
// Talks to POST /api/agent-chat. Each user message returns a reply
// + optional proposed_actions that the operator confirms one-by-one
// before execution.
//
// Drop-in: <script src="/assets/agent-mode-shell.js" defer></script>
// after mode-switcher.js. Pillar is auto-detected from the URL
// (/sales.html → 'sales'); pages can override via
// `window.__RYUJIN_PILLAR__ = 'sales'`.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TENANT = window.__RYUJIN_TENANT__ || document.documentElement.dataset.tenant || 'plus-ultra';
  const PILLAR_FROM_URL = (() => {
    const path = window.location.pathname;
    const m = path.match(/^\/([a-z]+)\.html$/);
    if (!m) return null;
    const head = m[1];
    if (['sales','marketing','service','customer','finance','production'].includes(head)) return head;
    if (head === 'admin-overview') return 'hq';
    return null;
  })();

  const PILLAR = window.__RYUJIN_PILLAR__ || PILLAR_FROM_URL;
  if (!PILLAR) return;  // shell only renders on pillar pages

  const conversation = [];   // [{ role, content }]
  let archetype = null;
  let speechRec = null;

  // ─── Styles ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ry-agent-shell-styles')) return;
    const css = `
      .ry-agent-shell {
        position: fixed; inset: 0; z-index: 80;
        background: rgba(6, 10, 20, 0.92); backdrop-filter: blur(8px);
        display: none;
        font-family: 'Inter', system-ui, sans-serif;
      }
      html[data-mode="agent"] .ry-agent-shell { display: flex; }
      html[data-mode="agent"] main, html[data-mode="agent"] .main { display: none; }
      .ry-agent-stage {
        flex: 1; display: flex; flex-direction: column;
        max-width: 920px; margin: 0 auto;
        padding: 64px 22px 22px; gap: 18px;
        position: relative;
      }
      .ry-agent-avatar {
        width: 220px; height: 220px; border-radius: 50%;
        margin: 0 auto; position: relative; overflow: hidden;
        background: rgba(20, 30, 50, 0.85);
        border: 2px solid var(--archetype-color, #22d3ee);
        box-shadow: 0 0 38px var(--archetype-glow, rgba(34, 211, 238, 0.35));
      }
      .ry-agent-avatar video, .ry-agent-avatar img {
        width: 100%; height: 100%; object-fit: cover;
      }
      .ry-agent-avatar-fallback {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Orbitron', monospace;
        font-size: 1.6em; font-weight: 800; letter-spacing: 3px;
        text-transform: uppercase;
        color: var(--archetype-color, #22d3ee);
        background: radial-gradient(circle at center, rgba(34,211,238,0.06), transparent 60%);
      }
      .ry-agent-name {
        text-align: center;
        font-family: 'Share Tech Mono', monospace;
        font-size: 0.78em; letter-spacing: 3px; text-transform: uppercase;
        color: rgba(208, 218, 240, 0.7);
      }
      .ry-agent-transcript {
        flex: 1; overflow-y: auto; min-height: 100px;
        background: rgba(8, 12, 24, 0.6);
        border: 1px solid rgba(34, 211, 238, 0.12);
        border-radius: 14px; padding: 14px 16px;
        display: flex; flex-direction: column; gap: 12px;
        font-size: 0.95em; line-height: 1.5;
      }
      .ry-agent-msg.user { align-self: flex-end; max-width: 75%; }
      .ry-agent-msg.assistant { align-self: flex-start; max-width: 85%; }
      .ry-agent-msg .role {
        font-size: 0.6em; letter-spacing: 2px; text-transform: uppercase;
        color: rgba(160, 190, 230, 0.55); margin-bottom: 4px;
        font-family: 'Share Tech Mono', monospace;
      }
      .ry-agent-msg .body { color: #d0daf0; }
      .ry-agent-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
      .ry-agent-action {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px; border-radius: 10px;
        background: rgba(20, 30, 50, 0.85);
        border: 1px solid rgba(34, 211, 238, 0.16);
        cursor: pointer; transition: all 0.15s;
        text-align: left;
        color: #d0daf0; font-family: inherit; font-size: 0.9em;
      }
      .ry-agent-action:hover { border-color: rgba(34, 211, 238, 0.35); transform: translateX(2px); }
      .ry-agent-action.recommended {
        border-color: var(--archetype-color, #22d3ee);
        box-shadow: 0 0 12px rgba(34, 211, 238, 0.25);
      }
      .ry-agent-action .label { font-weight: 600; flex: 1; }
      .ry-agent-action .why {
        display: block;
        font-size: 0.78em; color: rgba(160, 190, 230, 0.55); margin-top: 2px;
      }
      .ry-agent-action .badge {
        font-size: 0.55em; letter-spacing: 1.6px; text-transform: uppercase;
        padding: 2px 8px; border-radius: 8px;
        background: rgba(251, 191, 36, 0.15); color: #fbbf24;
        border: 1px solid rgba(251, 191, 36, 0.3);
        font-family: 'Share Tech Mono', monospace;
      }
      .ry-agent-input-row {
        display: flex; gap: 8px; align-items: stretch;
      }
      .ry-agent-input {
        flex: 1; padding: 12px 16px; font-size: 0.95em; font-family: inherit;
        background: rgba(8, 12, 24, 0.7); color: #d0daf0;
        border: 1px solid rgba(34, 211, 238, 0.25); border-radius: 12px;
        outline: none; min-height: 48px;
      }
      .ry-agent-input:focus { border-color: rgba(34, 211, 238, 0.55); }
      .ry-agent-btn {
        padding: 0 18px; min-width: 48px; cursor: pointer;
        background: linear-gradient(135deg, #22d3ee, #7c3aed);
        color: #0a0e1a; border: none; border-radius: 12px;
        font-family: 'Orbitron', monospace; font-size: 0.7em;
        font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase;
      }
      .ry-agent-btn:hover { box-shadow: 0 0 16px rgba(34, 211, 238, 0.4); }
      .ry-agent-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .ry-agent-btn.voice {
        background: rgba(20, 30, 50, 0.85); color: #22d3ee;
        border: 1px solid rgba(34, 211, 238, 0.25);
      }
      .ry-agent-btn.voice.listening { background: #f87171; color: #fff; animation: ry-pulse 1s infinite; }
      @keyframes ry-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
      .ry-agent-thinking {
        align-self: flex-start;
        font-family: 'Share Tech Mono', monospace; font-size: 0.78em;
        color: rgba(160, 190, 230, 0.5); padding: 6px 10px;
      }
      .ry-agent-thinking::after { content: '...'; animation: ry-dots 1.2s infinite; }
      @keyframes ry-dots { 0%{content:'.'} 33%{content:'..'} 66%{content:'...'} }
      @media (max-width: 540px) {
        .ry-agent-stage { padding: 60px 12px 12px; }
        .ry-agent-avatar { width: 140px; height: 140px; }
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ry-agent-shell-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ─── DOM ───────────────────────────────────────────────────────
  let elShell, elTranscript, elInput, elSendBtn, elVoiceBtn, elAvatar, elAvatarName;

  function buildShell() {
    if (document.querySelector('.ry-agent-shell')) return;
    elShell = document.createElement('div');
    elShell.className = 'ry-agent-shell';
    elShell.innerHTML = `
      <div class="ry-agent-stage">
        <div class="ry-agent-avatar" id="ry-agent-avatar">
          <div class="ry-agent-avatar-fallback">${PILLAR}</div>
        </div>
        <div class="ry-agent-name" id="ry-agent-name">${PILLAR.toUpperCase()} · agent</div>
        <div class="ry-agent-transcript" id="ry-agent-transcript">
          <div class="ry-agent-msg assistant"><div class="role">Agent</div><div class="body">Loading…</div></div>
        </div>
        <div class="ry-agent-input-row">
          <button class="ry-agent-btn voice" id="ry-agent-voice" title="Voice (browser SpeechRecognition)">🎤</button>
          <input class="ry-agent-input" id="ry-agent-input" placeholder="Ask anything about ${PILLAR}…" />
          <button class="ry-agent-btn" id="ry-agent-send">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(elShell);
    elTranscript = document.getElementById('ry-agent-transcript');
    elInput = document.getElementById('ry-agent-input');
    elSendBtn = document.getElementById('ry-agent-send');
    elVoiceBtn = document.getElementById('ry-agent-voice');
    elAvatar = document.getElementById('ry-agent-avatar');
    elAvatarName = document.getElementById('ry-agent-name');

    elSendBtn.addEventListener('click', onSend);
    elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
    elVoiceBtn.addEventListener('click', toggleVoice);
  }

  function setArchetypeStyling(arch) {
    if (!arch) return;
    archetype = arch;
    elShell.style.setProperty('--archetype-color', arch.accent_color);
    elShell.style.setProperty('--archetype-glow', arch.accent_color + '55');
    elAvatarName.textContent = `${arch.name.toUpperCase()} · ${PILLAR.toUpperCase()} agent`;
    if (arch.avatar_video) {
      // Try video first; if it 404s, fall back to poster, then to text fallback.
      const video = document.createElement('video');
      video.src = arch.avatar_video;
      video.autoplay = true; video.loop = true; video.muted = true; video.playsInline = true;
      video.poster = arch.avatar_poster || '';
      video.addEventListener('error', () => {
        if (arch.avatar_poster) {
          const img = document.createElement('img');
          img.src = arch.avatar_poster;
          img.addEventListener('error', () => { /* keep text fallback */ });
          elAvatar.innerHTML = `<div class="ry-agent-avatar-fallback">${arch.name}</div>`;
          elAvatar.prepend(img);
        }
      });
      elAvatar.innerHTML = `<div class="ry-agent-avatar-fallback">${arch.name}</div>`;
      elAvatar.prepend(video);
    }
  }

  // ─── Conversation ─────────────────────────────────────────────
  function appendMessage(role, body, actions) {
    const div = document.createElement('div');
    div.className = `ry-agent-msg ${role}`;
    div.innerHTML = `<div class="role">${role === 'user' ? 'You' : (archetype?.name || 'Agent')}</div><div class="body"></div>`;
    div.querySelector('.body').textContent = body;
    if (actions && actions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'ry-agent-actions';
      for (const a of actions) {
        const btn = document.createElement('button');
        btn.className = 'ry-agent-action' + (a.recommended ? ' recommended' : '');
        btn.innerHTML = `
          <span class="label">${escapeHtml(a.label)}${a.why ? `<span class="why">${escapeHtml(a.why)}</span>` : ''}</span>
          ${a.recommended ? '<span class="badge">★ recommended</span>' : ''}
        `;
        btn.addEventListener('click', () => onActionClick(a, btn));
        wrap.appendChild(btn);
      }
      div.appendChild(wrap);
    }
    elTranscript.appendChild(div);
    elTranscript.scrollTop = elTranscript.scrollHeight;
  }

  function appendThinking() {
    const div = document.createElement('div');
    div.className = 'ry-agent-thinking';
    div.id = 'ry-thinking';
    div.textContent = `${archetype?.name || 'Agent'} thinking`;
    elTranscript.appendChild(div);
    elTranscript.scrollTop = elTranscript.scrollHeight;
    return div;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function onSend() {
    const text = (elInput.value || '').trim();
    if (!text) return;
    elInput.value = '';
    elSendBtn.disabled = true;
    appendMessage('user', text);
    conversation.push({ role: 'user', content: text });
    const thinking = appendThinking();
    try {
      const r = await fetch('/api/agent-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
        body: JSON.stringify({ pillar: PILLAR, message: text, conversation }),
      });
      thinking.remove();
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        appendMessage('assistant', `Error ${r.status}: ${txt.slice(0, 200) || 'agent unreachable'}`);
        return;
      }
      const data = await r.json();
      if (data.archetype && !archetype) setArchetypeStyling(data.archetype);
      appendMessage('assistant', data.reply, data.proposed_actions || []);
      conversation.push({ role: 'assistant', content: data.reply });
      speak(data.reply);
    } catch (e) {
      thinking.remove();
      appendMessage('assistant', `Network error: ${e.message}`);
    } finally {
      elSendBtn.disabled = false;
      elInput.focus();
    }
  }

  // ─── Action confirm/execute ───────────────────────────────────
  async function onActionClick(action, btn) {
    btn.disabled = true;
    const ok = confirm(`Confirm: ${action.label}\n\n${action.why || ''}`);
    if (!ok) { btn.disabled = false; return; }
    try {
      const result = await executeAction(action);
      btn.style.opacity = '0.5';
      btn.querySelector('.label').textContent = `✓ ${action.label}`;
      appendMessage('assistant', result || `Done: ${action.label}`);
    } catch (e) {
      btn.disabled = false;
      appendMessage('assistant', `Action failed: ${e.message}`);
    }
  }

  async function executeAction(action) {
    const k = action.kind;
    const p = action.payload || {};
    if (k === 'navigate_to') {
      if (p.url) window.location.href = p.url;
      return `Opening ${p.url}`;
    }
    if (k === 'open_estimate') {
      window.location.href = `/admin.html#estimates`;
      return `Opening estimate ${p.estimate_id}`;
    }
    if (k === 'open_customer') {
      window.location.href = `/customer-profile.html?id=${encodeURIComponent(p.customer_id || '')}`;
      return `Opening customer`;
    }
    if (k === 'send_email' && p.to) {
      const subject = encodeURIComponent(p.subject || '');
      const bodyEnc = encodeURIComponent(p.body || '');
      window.location.href = `mailto:${encodeURIComponent(p.to)}?subject=${subject}&body=${bodyEnc}`;
      return `Email composer opened to ${p.to}`;
    }
    if (k === 'send_sms' && p.to) {
      window.location.href = `sms:${encodeURIComponent(p.to)}?body=${encodeURIComponent(p.body || '')}`;
      return `SMS composer opened to ${p.to}`;
    }
    if (k === 'create_quest') {
      const r = await fetch('/api/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
        body: JSON.stringify({ title: p.title, description: p.description || '', priority: p.priority || 'normal' }),
      });
      if (!r.ok) throw new Error(`/api/quests ${r.status}`);
      return `Quest added: ${p.title}`;
    }
    if (k === 'run_agent' && p.agent_slug) {
      const r = await fetch(`/api/agents/${p.agent_slug}`, { headers: { 'x-tenant-id': TENANT } });
      return r.ok ? `Agent ${p.agent_slug} ran.` : `Agent ${p.agent_slug} returned ${r.status}.`;
    }
    if (k === 'noop') return 'Acknowledged.';
    throw new Error(`Unsupported action kind: ${k}`);
  }

  // ─── Voice (browser) ──────────────────────────────────────────
  function toggleVoice() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      appendMessage('assistant', 'Voice input is not supported in this browser. Try Chrome or Safari.');
      return;
    }
    if (speechRec) {
      speechRec.stop();
      speechRec = null;
      elVoiceBtn.classList.remove('listening');
      return;
    }
    speechRec = new Rec();
    speechRec.lang = navigator.language || 'en-US';
    speechRec.interimResults = false;
    speechRec.maxAlternatives = 1;
    speechRec.onresult = (ev) => {
      const transcript = ev.results[0][0].transcript;
      elInput.value = transcript;
      onSend();
    };
    speechRec.onend = () => {
      elVoiceBtn.classList.remove('listening');
      speechRec = null;
    };
    speechRec.onerror = (ev) => {
      elVoiceBtn.classList.remove('listening');
      speechRec = null;
      appendMessage('assistant', `Voice error: ${ev.error}`);
    };
    elVoiceBtn.classList.add('listening');
    speechRec.start();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1; u.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* swallow */ }
  }

  // ─── Boot ──────────────────────────────────────────────────────
  let bootedOnce = false;
  async function maybeBoot() {
    if (bootedOnce) return;
    bootedOnce = true;
    elTranscript.innerHTML = '';
    appendMessage('assistant', `Hi. I\'m the ${PILLAR} agent. Tell me what you want to do, or ask me what to focus on.`);
  }

  function onModeChange() {
    const mode = (window.RyujinMode && window.RyujinMode.get()) || document.documentElement.dataset.mode || 'advanced';
    if (mode === 'agent') {
      maybeBoot();
      setTimeout(() => elInput?.focus(), 50);
    }
  }

  function init() {
    injectStyles();
    buildShell();
    document.addEventListener('ryujin:mode-change', onModeChange);
    onModeChange();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
