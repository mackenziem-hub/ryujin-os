// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Interactive-mode shell.
//
// Activates when window.RyujinMode.get() === 'interactive'. Hides
// the panel <main> and presents one card at a time with up to 4
// large multiple-choice buttons, gamepad-friendly + keyboard +
// touch. Options are agent-generated via GET /api/options?pillar=X
// (3-mode MD).
//
// Controls:
//   1 / 2 / 3 / 4    — pick option N
//   ArrowUp/Down     — focus prev/next option
//   Enter / Space    — confirm focused option
//   Escape / B       — back up the trail (or close to dashboard)
//   R                — refresh options (re-call /api/options)
//   Xbox A           — confirm focused
//   Xbox B           — back
//   Xbox D-pad       — focus prev/next
//
// Drop-in: <script src="/assets/interactive-mode-shell.js" defer></script>
// after mode-switcher.js. Pillar auto-detected from URL.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TENANT = window.__RYUJIN_TENANT__ || document.documentElement.dataset.tenant || 'plus-ultra';
  const PILLAR = window.__RYUJIN_PILLAR__ || (() => {
    const m = window.location.pathname.match(/^\/([a-z]+)\.html$/);
    if (!m) return null;
    const head = m[1];
    if (['sales','marketing','service','customer','finance','production'].includes(head)) return head;
    if (head === 'admin-overview') return 'hq';
    return null;
  })();
  if (!PILLAR) return;

  // State
  let trail = [];      // stack of { state_id, payload? }
  let archetype = null;
  let options = [];
  let focusIdx = 0;
  let loading = false;
  let gamepadIndex = null;
  let lastButtonState = {};

  // ─── Styles ────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ry-int-shell-styles')) return;
    const css = `
      .ry-int-shell {
        position: fixed; inset: 0; z-index: 80;
        background: rgba(6, 10, 20, 0.96);
        display: none;
        font-family: 'Inter', system-ui, sans-serif;
        align-items: center; justify-content: center;
        padding: 22px;
      }
      html[data-mode="interactive"] .ry-int-shell { display: flex; }
      html[data-mode="interactive"] main, html[data-mode="interactive"] .main { display: none; }
      .ry-int-stage { width: 100%; max-width: 920px; display: flex; flex-direction: column; gap: 22px; }
      .ry-int-header { display: flex; align-items: center; gap: 12px; }
      .ry-int-back {
        background: rgba(20,30,50,0.85); border: 1px solid rgba(34,211,238,0.16);
        color: rgba(208,218,240,0.8); padding: 8px 14px; border-radius: 10px;
        font-family: 'Share Tech Mono', monospace; font-size: 0.7em; letter-spacing: 1.6px;
        text-transform: uppercase; cursor: pointer;
      }
      .ry-int-back:hover { color: #d0daf0; border-color: rgba(34,211,238,0.35); }
      .ry-int-pillar {
        font-family: 'Orbitron', monospace; font-size: 0.78em; font-weight: 700;
        letter-spacing: 3px; text-transform: uppercase;
        color: var(--archetype-color, #22d3ee);
      }
      .ry-int-context {
        font-size: 1.15em; line-height: 1.5; color: #d0daf0;
        background: rgba(20,30,50,0.7);
        border: 1px solid rgba(34,211,238,0.16);
        border-left: 4px solid var(--archetype-color, #22d3ee);
        border-radius: 14px; padding: 18px 22px;
      }
      .ry-int-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      @media (max-width: 640px) { .ry-int-options { grid-template-columns: 1fr; } }
      .ry-int-option {
        display: flex; flex-direction: column; gap: 8px; align-items: flex-start;
        padding: 22px 20px; border-radius: 16px;
        background: rgba(20,30,50,0.85);
        border: 2px solid rgba(34,211,238,0.16);
        cursor: pointer; transition: all 0.18s;
        text-align: left;
        color: #d0daf0; font-family: inherit;
        min-height: 130px; position: relative;
      }
      .ry-int-option:hover, .ry-int-option.focused {
        border-color: var(--archetype-color, #22d3ee);
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(34,211,238,0.18);
      }
      .ry-int-option.recommended { border-color: var(--archetype-color, #22d3ee); }
      .ry-int-option.recommended::before {
        content: '★ recommended';
        position: absolute; top: 8px; right: 10px;
        font-family: 'Share Tech Mono', monospace; font-size: 0.55em;
        letter-spacing: 1.6px; text-transform: uppercase;
        color: #fbbf24;
      }
      .ry-int-key {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 8px;
        background: rgba(34,211,238,0.12); color: var(--archetype-color, #22d3ee);
        font-family: 'Orbitron', monospace; font-size: 0.85em; font-weight: 800;
      }
      .ry-int-label { font-size: 1.05em; font-weight: 700; line-height: 1.3; }
      .ry-int-why { font-size: 0.85em; color: rgba(160,190,230,0.7); line-height: 1.45; }
      .ry-int-loading {
        text-align: center; color: rgba(160,190,230,0.55);
        font-family: 'Share Tech Mono', monospace; font-size: 0.9em;
        padding: 40px;
      }
      .ry-int-empty { text-align: center; padding: 40px; color: rgba(160,190,230,0.6); }
      .ry-int-controls {
        display: flex; gap: 14px; justify-content: center;
        font-family: 'Share Tech Mono', monospace;
        font-size: 0.65em; letter-spacing: 1.6px; text-transform: uppercase;
        color: rgba(160,190,230,0.5);
      }
      .ry-int-controls kbd {
        display: inline-block; padding: 2px 6px; margin-right: 4px;
        background: rgba(34,211,238,0.12); border: 1px solid rgba(34,211,238,0.2);
        border-radius: 4px; font-family: inherit; color: rgba(208,218,240,0.85);
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ry-int-shell-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ─── DOM ───────────────────────────────────────────────────────
  let elShell, elContext, elOptions, elPillar, elBack;

  function buildShell() {
    if (document.querySelector('.ry-int-shell')) return;
    elShell = document.createElement('div');
    elShell.className = 'ry-int-shell';
    elShell.innerHTML = `
      <div class="ry-int-stage">
        <div class="ry-int-header">
          <button class="ry-int-back" id="ry-int-back" title="Back / Esc / B">← Back</button>
          <div class="ry-int-pillar" id="ry-int-pillar">${PILLAR.toUpperCase()}</div>
        </div>
        <div class="ry-int-context" id="ry-int-context">Loading…</div>
        <div class="ry-int-options" id="ry-int-options"></div>
        <div class="ry-int-controls">
          <span><kbd>1-4</kbd> pick</span>
          <span><kbd>↑↓</kbd> focus</span>
          <span><kbd>Enter</kbd> confirm</span>
          <span><kbd>Esc</kbd> back</span>
          <span><kbd>R</kbd> refresh</span>
        </div>
      </div>
    `;
    document.body.appendChild(elShell);
    elContext = document.getElementById('ry-int-context');
    elOptions = document.getElementById('ry-int-options');
    elPillar = document.getElementById('ry-int-pillar');
    elBack = document.getElementById('ry-int-back');
    elBack.addEventListener('click', goBack);
  }

  // ─── Render ────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderOptions() {
    if (loading) {
      elContext.textContent = 'Loading…';
      elOptions.innerHTML = '<div class="ry-int-loading">Asking the agent…</div>';
      return;
    }
    if (!options.length) {
      elContext.textContent = 'No actions surfaced. Try refreshing or switch to advanced mode.';
      elOptions.innerHTML = '<div class="ry-int-empty">Press R to refresh, or switch the mode toggle to Advanced for full controls.</div>';
      return;
    }
    elOptions.innerHTML = options.map((o, i) => {
      const isRec = o.recommended_rank === 1;
      return `
        <button class="ry-int-option ${i === focusIdx ? 'focused' : ''} ${isRec ? 'recommended' : ''}" data-idx="${i}">
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="ry-int-key">${i + 1}</span>
            <span class="ry-int-label">${escapeHtml(o.label)}</span>
          </div>
          ${o.why ? `<div class="ry-int-why">${escapeHtml(o.why)}</div>` : ''}
        </button>
      `;
    }).join('');
    elOptions.querySelectorAll('.ry-int-option').forEach((b) => {
      b.addEventListener('click', () => { focusIdx = parseInt(b.dataset.idx, 10); confirmFocused(); });
    });
  }

  function refocus() {
    elOptions.querySelectorAll('.ry-int-option').forEach((b, i) => {
      b.classList.toggle('focused', i === focusIdx);
    });
  }

  // Page the operator is on — prefer the embedding top page if same-origin,
  // else this page. Sent as ?cp= so the options brain knows the context.
  function ryCurrentPage() {
    try { const t = window.top; if (t && t !== window && t.location && /\.html$/.test(t.location.pathname)) return t.location.pathname + (t.location.search || '') + (t.location.hash || ''); } catch (e) {}
    return location.pathname + (location.search || '') + (location.hash || '');
  }

  // Only follow a same-origin, real catalog page (defense-in-depth on top of the
  // server's fail-closed nav). window.RyujinPages comes from /assets/page-catalog.js,
  // which every host page loads with `defer` BEFORE this shell (no async race).
  // FAILS CLOSED if it is somehow absent — a host page embedding this shell MUST
  // include <script src="/assets/page-catalog.js" defer> ahead of it.
  function ryNavSafe(u) {
    return !!(window.RyujinPages && window.RyujinPages.validateUrl && window.RyujinPages.validateUrl(u));
  }

  // ─── Actions ───────────────────────────────────────────────────
  async function loadOptions(stateId) {
    loading = true;
    options = [];
    focusIdx = 0;
    renderOptions();
    try {
      const url = `/api/options?pillar=${encodeURIComponent(PILLAR)}` + (stateId && stateId !== 'root' ? `&state=${encodeURIComponent(stateId)}` : '') + `&cp=${encodeURIComponent(ryCurrentPage())}`;
      const r = await fetch(url, { headers: { 'x-tenant-id': TENANT } });
      if (!r.ok) {
        elContext.textContent = `Could not load options: HTTP ${r.status}`;
        loading = false; renderOptions(); return;
      }
      const data = await r.json();
      if (data.archetype && !archetype) {
        archetype = data.archetype;
        elShell.style.setProperty('--archetype-color', archetype.accent_color);
        elPillar.textContent = `${archetype.name.toUpperCase()} · ${PILLAR.toUpperCase()}`;
      }
      elContext.textContent = data.context_summary || '';
      options = data.options || [];
      loading = false;
      renderOptions();
    } catch (e) {
      elContext.textContent = `Network error: ${e.message}`;
      loading = false; renderOptions();
    }
  }

  async function confirmFocused() {
    const opt = options[focusIdx];
    if (!opt) return;
    const ok = window.confirm(`Confirm: ${opt.label}\n\n${opt.why || ''}`);
    if (!ok) return;
    await executeOption(opt);
  }

  async function executeOption(o) {
    const k = o.kind;
    const p = o.payload || {};
    if (k === 'navigate_to' || k === 'escalate_to_advanced') {
      if (p.url && ryNavSafe(p.url)) window.location.href = p.url;
      return;
    }
    if (k === 'open_estimate') { window.location.href = '/admin.html#estimates'; return; }
    if (k === 'open_customer') {
      window.location.href = `/customer-profile.html?id=${encodeURIComponent(p.customer_id || '')}`;
      return;
    }
    if (k === 'send_email' && p.to) {
      window.location.href = `mailto:${encodeURIComponent(p.to)}?subject=${encodeURIComponent(p.subject || '')}&body=${encodeURIComponent(p.body || '')}`;
      return;
    }
    if (k === 'send_sms' && p.to) {
      window.location.href = `sms:${encodeURIComponent(p.to)}?body=${encodeURIComponent(p.body || '')}`;
      return;
    }
    if (k === 'create_quest') {
      try {
        const r = await fetch('/api/quests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
          body: JSON.stringify({ title: p.title, description: p.description || '', priority: p.priority || 'normal' }),
        });
        elContext.textContent = r.ok ? `Quest added: ${p.title}` : `Quest create failed (${r.status})`;
      } catch (e) { elContext.textContent = `Network error: ${e.message}`; }
      // Re-load options now that state has changed
      trail.push({ state_id: 'after_quest_added' });
      loadOptions('after_quest_added');
      return;
    }
    if (k === 'run_agent' && p.agent_slug) {
      try {
        await fetch(`/api/agents/${p.agent_slug}`, { headers: { 'x-tenant-id': TENANT } });
        elContext.textContent = `Agent ${p.agent_slug} ran. Re-loading options…`;
      } catch {}
      loadOptions('after_agent_run');
      return;
    }
    if (k === 'compose_message' && p.to_user) {
      try {
        const tok = localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token');
        const r = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
          body: JSON.stringify({ to_user_id: p.to_user, subject: p.subject || `From your ${PILLAR} agent`, body: p.body || '', from_label: p.from_label || `${PILLAR} agent` }),
        });
        elContext.textContent = r.ok ? `Message sent.` : `Send failed (${r.status}); falling back to mailto…`;
        if (!r.ok) window.location.href = `mailto:?subject=${encodeURIComponent('From your ' + PILLAR + ' agent')}&body=${encodeURIComponent(p.body || '')}`;
      } catch (e) {
        elContext.textContent = `Send error: ${e.message}`;
      }
      return;
    }
    elContext.textContent = `(action kind "${k}" not yet wired)`;
  }

  function goBack() {
    if (trail.length > 0) {
      trail.pop();
      const prev = trail[trail.length - 1];
      loadOptions(prev?.state_id || 'root');
    } else {
      // Bail out to advanced mode
      if (window.RyujinMode) window.RyujinMode.set('advanced');
    }
  }

  // ─── Input ─────────────────────────────────────────────────────
  function onKey(ev) {
    if (document.documentElement.dataset.mode !== 'interactive') return;
    if (loading) return;
    const k = ev.key;
    if (/^[1-4]$/.test(k)) {
      const idx = parseInt(k, 10) - 1;
      if (idx < options.length) { focusIdx = idx; refocus(); confirmFocused(); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowRight') { focusIdx = Math.min(options.length - 1, focusIdx + 1); refocus(); ev.preventDefault(); return; }
    if (k === 'ArrowUp' || k === 'ArrowLeft') { focusIdx = Math.max(0, focusIdx - 1); refocus(); ev.preventDefault(); return; }
    if (k === 'Enter' || k === ' ') { ev.preventDefault(); confirmFocused(); return; }
    if (k === 'Escape' || k === 'b' || k === 'B') { ev.preventDefault(); goBack(); return; }
    if (k === 'r' || k === 'R') { ev.preventDefault(); loadOptions(trail[trail.length - 1]?.state_id || 'root'); return; }
  }

  // ─── Gamepad ───────────────────────────────────────────────────
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (gamepadIndex == null) {
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) { gamepadIndex = i; break; }
      }
    }
    const pad = gamepadIndex != null ? pads[gamepadIndex] : null;
    if (pad && document.documentElement.dataset.mode === 'interactive' && !loading) {
      const buttons = pad.buttons.map(b => b.pressed);
      const justPressed = (i) => buttons[i] && !lastButtonState[i];
      // Standard mapping: 0=A 1=B 2=X 3=Y, 12=DUp 13=DDown 14=DLeft 15=DRight
      if (justPressed(0)) confirmFocused();
      if (justPressed(1)) goBack();
      if (justPressed(12) || justPressed(14)) { focusIdx = Math.max(0, focusIdx - 1); refocus(); }
      if (justPressed(13) || justPressed(15)) { focusIdx = Math.min(options.length - 1, focusIdx + 1); refocus(); }
      lastButtonState = buttons.reduce((acc, v, i) => { acc[i] = v; return acc; }, {});
    }
    requestAnimationFrame(pollGamepad);
  }

  // ─── Mode hook ─────────────────────────────────────────────────
  let bootedOnce = false;
  function onModeChange() {
    const mode = (window.RyujinMode && window.RyujinMode.get()) || document.documentElement.dataset.mode || 'advanced';
    if (mode === 'interactive') {
      if (!bootedOnce) {
        bootedOnce = true;
        trail = [{ state_id: 'root' }];
        loadOptions('root');
      }
    }
  }

  function init() {
    injectStyles();
    buildShell();
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(pollGamepad);
    document.addEventListener('ryujin:mode-change', onModeChange);
    onModeChange();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
