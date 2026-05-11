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
    const m = path.match(/^\/([a-z\-]+)\.html$/);
    if (!m) return null;
    const head = m[1];
    if (['sales','marketing','service','customer','finance','production'].includes(head)) return head;
    if (head === 'admin-overview' || head === 'portal') return 'hq';
    return null;
  })();

  // Pillar resolution order:
  //   1. window.__RYUJIN_PILLAR__   (set by page-level inline script)
  //   2. <html data-pillar="…">     (set declaratively in markup)
  //   3. URL-derived (/sales.html → 'sales', /portal.html → 'hq')
  const PILLAR = window.__RYUJIN_PILLAR__
    || (document.documentElement.dataset.pillar || '').toLowerCase()
    || PILLAR_FROM_URL;
  if (!PILLAR) return;  // shell only renders where a pillar is resolvable

  const conversation = [];   // [{ role, content }]
  let archetype = null;
  let speechRec = null;

  // Client-side mirror of lib/archetypeRegistry's PILLAR_REGISTRY just deep
  // enough to paint the avatar BEFORE the first /api/agent-chat round-trip.
  // Without this, the shell opens with only the cyan text fallback (e.g.
  // "HQ"/"SERVICE") and the bust never appears until the user sends a
  // message. The server still returns the canonical archetype on first
  // reply and may swap a richer one in.
  const CLIENT_ARCHETYPES = {
    hq:         { name: 'Sage',      accent_color: '#22d3ee', avatar_image: '/assets/archetypes/sage-bust.png',      avatar_video: '/assets/archetypes/sage.mp4',      avatar_poster: '/assets/archetypes/sage.jpg' },
    sales:      { name: 'Hero',      accent_color: '#fbbf24', avatar_image: '/assets/archetypes/sovereign-bust.png', avatar_video: '/assets/archetypes/hero.mp4',      avatar_poster: '/assets/archetypes/hero.jpg' },
    marketing:  { name: 'Magician',  accent_color: '#7c3aed', avatar_image: '/assets/archetypes/sage-bust.png',      avatar_video: '/assets/archetypes/magician.mp4',  avatar_poster: '/assets/archetypes/magician.jpg' },
    service:    { name: 'Caregiver', accent_color: '#4ade80', avatar_image: '/assets/archetypes/caregiver-bust.png', avatar_video: '/assets/archetypes/caregiver.mp4', avatar_poster: '/assets/archetypes/caregiver.jpg' },
    customer:   { name: 'Lover',     accent_color: '#f87171', avatar_image: '/assets/archetypes/caregiver-bust.png', avatar_video: '/assets/archetypes/lover.mp4',     avatar_poster: '/assets/archetypes/lover.jpg' },
    finance:    { name: 'Ruler',     accent_color: '#a78bfa', avatar_image: '/assets/archetypes/sovereign-bust.png', avatar_video: '/assets/archetypes/ruler.mp4',     avatar_poster: '/assets/archetypes/ruler.jpg' },
    production: { name: 'Sovereign', accent_color: '#fb923c', avatar_image: '/assets/archetypes/sovereign-bust.png', avatar_video: null, avatar_poster: null },
  };

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
      html[data-mode="agent"] main,
      html[data-mode="agent"] .main,
      html[data-mode="agent"] .wrap { display: none; }
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
      .ry-agent-msg.user {
        align-self: flex-end; max-width: 88%;
        background: rgba(34, 211, 238, 0.10);
        border: 1px solid rgba(34, 211, 238, 0.18);
        padding: 10px 14px; border-radius: 14px;
        border-bottom-right-radius: 4px;
      }
      .ry-agent-msg.assistant {
        align-self: flex-start; max-width: 92%;
        background: rgba(20, 30, 50, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.05);
        padding: 10px 14px; border-radius: 14px;
        border-bottom-left-radius: 4px;
      }
      .ry-agent-msg .role {
        font-size: 0.62em; letter-spacing: 2px; text-transform: uppercase;
        color: rgba(160, 190, 230, 0.55); margin-bottom: 4px;
        font-family: 'Share Tech Mono', monospace;
      }
      .ry-agent-msg .body {
        color: #eaf0fa;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-wrap: break-word;
        word-break: break-word;
        line-height: 1.5;
        min-width: 0;
        max-width: 100%;
      }
      .ry-agent-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; width: 100%; }
      .ry-agent-action {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px 14px; border-radius: 10px;
        background: rgba(20, 30, 50, 0.85);
        border: 1px solid rgba(34, 211, 238, 0.16);
        cursor: pointer; transition: all 0.15s;
        text-align: left;
        color: #d0daf0; font-family: inherit; font-size: 0.9em;
        width: 100%;
      }
      .ry-agent-action:hover { border-color: rgba(34, 211, 238, 0.35); }
      .ry-agent-action.recommended {
        border-color: var(--archetype-color, #22d3ee);
        box-shadow: 0 0 12px rgba(34, 211, 238, 0.25);
      }
      .ry-agent-action .label {
        font-weight: 600; flex: 1; min-width: 0;
        word-wrap: break-word; overflow-wrap: break-word;
        white-space: normal; line-height: 1.35;
      }
      .ry-agent-action .why {
        display: block;
        font-size: 0.78em; color: rgba(160, 190, 230, 0.55); margin-top: 4px;
        font-weight: 400; line-height: 1.4;
        word-wrap: break-word; overflow-wrap: break-word;
      }
      .ry-agent-action .badge { flex-shrink: 0; align-self: flex-start; }
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
        outline: none; min-height: 48px; max-height: 160px;
        resize: none; line-height: 1.4;
      }
      .ry-agent-input:focus { border-color: rgba(34, 211, 238, 0.55); }
      .ry-agent-input-row { align-items: flex-end; }
      .ry-agent-btn { align-self: flex-end; }
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
      .ry-agent-header {
        position: absolute; top: 14px; left: 18px; right: 18px;
        display: flex; justify-content: space-between; align-items: center;
        gap: 10px; font-family: 'Share Tech Mono', monospace;
        font-size: 0.62em; letter-spacing: 1.6px; text-transform: uppercase;
        color: rgba(160, 190, 230, 0.55);
        pointer-events: none;
      }
      .ry-agent-header > * { pointer-events: auto; }
      .ry-agent-header-link {
        background: transparent; border: 1px solid rgba(34, 211, 238, 0.16);
        color: inherit; font-family: inherit; font-size: inherit;
        letter-spacing: inherit; text-transform: inherit;
        padding: 6px 10px; border-radius: 12px; cursor: pointer;
      }
      .ry-agent-header-link:hover { color: #22d3ee; border-color: rgba(34, 211, 238, 0.4); }
      .ry-agent-close {
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(20, 30, 50, 0.85);
        border: 1px solid rgba(34, 211, 238, 0.25);
        color: rgba(208, 218, 240, 0.75);
        cursor: pointer; font-size: 1.1em; line-height: 1; font-family: inherit;
      }
      .ry-agent-close:hover { color: #f87171; border-color: rgba(248, 113, 113, 0.4); }
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
        <div class="ry-agent-header">
          <button type="button" class="ry-agent-header-link" id="ry-agent-suppress">Don't auto-show today</button>
          <button type="button" class="ry-agent-close" id="ry-agent-close" aria-label="Close agent">✕</button>
        </div>
        <div class="ry-agent-avatar" id="ry-agent-avatar">
          <div class="ry-agent-avatar-fallback">${PILLAR}</div>
        </div>
        <div class="ry-agent-name" id="ry-agent-name">${PILLAR.toUpperCase()} · agent</div>
        <div class="ry-agent-transcript" id="ry-agent-transcript">
          <div class="ry-agent-msg assistant"><div class="role">Agent</div><div class="body">Loading…</div></div>
        </div>
        <div class="ry-agent-input-row">
          <button class="ry-agent-btn voice" id="ry-agent-voice" title="Voice (browser SpeechRecognition)">🎤</button>
          <textarea class="ry-agent-input" id="ry-agent-input" rows="1" placeholder="Ask anything about ${PILLAR}…"></textarea>
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
    // Auto-grow the textarea up to its max-height (CSS caps at 160px).
    elInput.addEventListener('input', () => {
      elInput.style.height = 'auto';
      elInput.style.height = Math.min(160, elInput.scrollHeight) + 'px';
    });
    elVoiceBtn.addEventListener('click', toggleVoice);
    document.getElementById('ry-agent-close').addEventListener('click', closeShell);
    document.getElementById('ry-agent-suppress').addEventListener('click', () => {
      if (window.RyujinMode?.suppressAutoLaunch) window.RyujinMode.suppressAutoLaunch();
      closeShell();
    });
  }

  function isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '') &&
      !window.matchMedia('(min-width: 1024px)').matches;
  }

  function ensureReopenFab() {
    if (document.getElementById('ry-agent-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'ry-agent-fab';
    fab.type = 'button';
    fab.title = 'Reopen agent';
    fab.setAttribute('aria-label', 'Reopen agent');
    fab.textContent = '💬';
    fab.style.cssText = [
      'position:fixed','right:18px','bottom:18px','z-index:79',
      'width:56px','height:56px','border-radius:50%',
      'border:1px solid var(--archetype-color,#22d3ee)',
      'background:rgba(8,12,24,0.9)','color:#22d3ee',
      'font-size:1.4em','cursor:pointer',
      'box-shadow:0 6px 18px rgba(34,211,238,0.25)',
      'display:none',
    ].join(';');
    fab.addEventListener('click', openShell);
    document.body.appendChild(fab);
  }

  function setFabVisible(visible) {
    const fab = document.getElementById('ry-agent-fab');
    if (fab) fab.style.display = visible ? 'block' : 'none';
  }

  function openShell() {
    setFabVisible(false);
    if (window.RyujinMode?.set) window.RyujinMode.set('agent');
    else document.documentElement.dataset.mode = 'agent';
    maybeBoot();
    setTimeout(() => elInput?.focus(), 50);
  }

  function closeShell() {
    if (isMobile()) {
      // On mobile, flip data-mode to 'interactive' in memory only — the
      // existing CSS rule un-hides <main> and hides the shell. mode-switcher
      // doesn't persist to localStorage on mobile, so a reload restores
      // mode='agent' from readMode(). Surface a FAB so Mac can re-summon
      // the shell without reloading.
      document.documentElement.dataset.mode = 'interactive';
      setFabVisible(true);
      return;
    }
    // Desktop: flip mode away from 'agent' so the underlying admin/portal UI
    // reappears via the existing CSS rule.
    if (window.RyujinMode?.set) {
      const target = window.RyujinMode.available?.().includes('interactive') ? 'interactive' : 'advanced';
      window.RyujinMode.set(target);
    } else {
      document.documentElement.dataset.mode = 'interactive';
    }
  }

  function setArchetypeStyling(arch) {
    if (!arch) return;
    archetype = arch;
    elShell.style.setProperty('--archetype-color', arch.accent_color);
    elShell.style.setProperty('--archetype-glow', arch.accent_color + '55');
    elAvatarName.textContent = `${arch.name.toUpperCase()} · ${PILLAR.toUpperCase()} agent`;
    // Resolution chain: avatar_image (always present per archetypeRegistry)
    // wins as the static base so the avatar is NEVER just a name overlaid on
    // empty space. If avatar_video is also provided and loads cleanly, the
    // video plays over the still. The text-only fallback only renders if
    // every image attempt fails (rare — bust PNGs ship in the repo).
    const fallbackHtml = `<div class="ry-agent-avatar-fallback">${arch.name}</div>`;
    elAvatar.innerHTML = fallbackHtml;
    if (arch.avatar_image) {
      const img = document.createElement('img');
      img.src = arch.avatar_image;
      img.addEventListener('load', () => {
        // Image rendered → ditch the text overlay so the face is unobscured.
        const fb = elAvatar.querySelector('.ry-agent-avatar-fallback');
        if (fb) fb.remove();
      });
      elAvatar.prepend(img);
    }
    if (arch.avatar_video) {
      const video = document.createElement('video');
      video.src = arch.avatar_video;
      video.autoplay = true; video.loop = true; video.muted = true; video.playsInline = true;
      video.poster = arch.avatar_poster || arch.avatar_image || '';
      video.addEventListener('loadeddata', () => {
        // Video took over → the still img beneath is fine to keep (it
        // shows during loading), but make sure no text fallback remains.
        const fb = elAvatar.querySelector('.ry-agent-avatar-fallback');
        if (fb) fb.remove();
      });
      video.addEventListener('error', () => {
        video.remove();  // leave the image in place; no text relapse
      });
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
      if (Array.isArray(data.auto_routed) && data.auto_routed.length) showRouteToast(data.auto_routed);
      speak(data.reply);
    } catch (e) {
      thinking.remove();
      appendMessage('assistant', `Network error: ${e.message}`);
    } finally {
      elSendBtn.disabled = false;
      elInput.focus();
    }
  }

  // ─── Auto-route toast (RG) ─────────────────────────────────
  function showRouteToast(routes) {
    if (!routes?.length) return;
    let stack = document.getElementById('ry-route-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'ry-route-toast-stack';
      stack.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:340px;font-family:Inter,system-ui,sans-serif';
      document.body.appendChild(stack);
    }
    for (const r of routes) {
      const names = (Array.isArray(r) ? r : [r]).map(x => x.name).join(' + ');
      const intent = (r.intent || 'message').replace(/_/g, ' ');
      const messageIds = r.message_ids || [];
      const t = document.createElement('div');
      t.style.cssText = 'background:linear-gradient(135deg,rgba(34,211,238,0.18),rgba(124,58,237,0.12));border:1px solid rgba(34,211,238,0.35);color:#d0daf0;padding:10px 14px;border-radius:12px;font-size:0.85em;display:flex;align-items:center;gap:10px;box-shadow:0 4px 18px rgba(0,0,0,0.4);animation:ry-toast-in 0.25s ease-out';
      t.innerHTML = `<div style="flex:1">→ Notified <strong style="color:#22d3ee">${escapeHtml(names || 'team')}</strong><div style="font-size:0.78em;color:rgba(160,190,230,0.65);margin-top:2px">auto-route · ${escapeHtml(intent)}</div></div><button style="background:transparent;border:1px solid rgba(248,113,113,0.4);color:#f87171;padding:3px 9px;border-radius:8px;font-size:0.75em;cursor:pointer">Undo</button>`;
      const undoBtn = t.querySelector('button');
      undoBtn.addEventListener('click', async () => {
        undoBtn.disabled = true; undoBtn.textContent = '…';
        const tok = localStorage.getItem('ryujin_token');
        for (const mid of messageIds) {
          try {
            await fetch('/api/messages?id=' + mid, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify({ archived: true }) });
          } catch {}
        }
        t.style.opacity = '0.4';
        undoBtn.textContent = 'Undone';
      });
      stack.appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity 0.4s, transform 0.4s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 500); }, 7000);
    }
    if (!document.getElementById('ry-toast-anim-styles')) {
      const s = document.createElement('style');
      s.id = 'ry-toast-anim-styles';
      s.textContent = '@keyframes ry-toast-in { from { opacity: 0; transform: translateX(20px) } to { opacity: 1; transform: translateX(0) } }';
      document.head.appendChild(s);
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
      // Quiet hours: no outbound texts before 07:00 or after 19:00 local
      // time (Mac's hard rule). Fall back to the internal inbox so the
      // recipient still gets the message, just not as a midnight buzz.
      const h = new Date().getHours();
      if (h < 7 || h >= 19) {
        const r = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
          body: JSON.stringify({
            to_phone: p.to,
            subject: p.subject || `Note from ${archetype?.name || PILLAR} agent`,
            body: p.body || '',
            metadata: { suppressed_sms: true, reason: 'quiet_hours_7am_7pm', original_kind: 'send_sms' },
          }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => '');
          throw new Error(`Quiet-hours fallback to /api/messages failed: ${r.status} ${t.slice(0, 100)}`);
        }
        return `Quiet hours — delivered to inbox instead of SMS (${p.to}).`;
      }
      window.location.href = `sms:${encodeURIComponent(p.to)}?body=${encodeURIComponent(p.body || '')}`;
      return `SMS composer opened to ${p.to}`;
    }
    if (k === 'create_quest') {
      // API requires category + type (CHECK constraints on the quests
      // table). Match what lib/router.js does for routed tasks so the
      // shape is consistent: category=personal, type=optional.
      const r = await fetch('/api/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
        body: JSON.stringify({
          title: p.title,
          description: p.description || '',
          category: p.category || 'personal',
          type: p.type || 'optional',
          assigned_to: p.assigned_to || null,
          metadata: { from_agent: PILLAR, priority: p.priority || 'normal' },
        }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`/api/quests ${r.status}: ${txt.slice(0, 120)}`);
      }
      return `Task added: ${p.title}`;
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
    ensureReopenFab();
    // Paint the avatar with the pillar's default archetype IMMEDIATELY so
    // there's a face the moment the shell opens — not just on the first
    // /api/agent-chat reply.
    const initialArch = CLIENT_ARCHETYPES[PILLAR] || CLIENT_ARCHETYPES.hq;
    setArchetypeStyling(initialArch);
    document.addEventListener('ryujin:mode-change', onModeChange);
    // mode-switcher.js fires this on mobile first-visits so we boot the
    // greeting + focus the input even if a `ryujin:mode-change` event
    // didn't fire (e.g. mode was already 'agent' from prior session).
    document.addEventListener('ryujin:auto-launch-agent', () => {
      maybeBoot();
      setTimeout(() => elInput?.focus(), 50);
    });
    onModeChange();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
