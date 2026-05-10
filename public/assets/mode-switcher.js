// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Mode switcher.
//
// Three-mode architecture (per session plan 2026-05-10):
//   agent       — talking-head archetype, voice + chat
//   interactive — multiple-choice cards, gamepad-friendly
//   advanced    — full mouse + keyboard, label rename
//
// State: localStorage.ryujin_mode (sticky system-wide). Broadcasts
// `ryujin:mode-change` CustomEvent on flip so pillar shells can
// re-render without a full page reload. Reads from
// /api/entitlements; if features.agent_layer_only is true, locks the
// mode to 'agent' (Agent Layer SKU is read-only-with-AI).
//
// Drop-in: <script src="/assets/mode-switcher.js" defer></script>
// at the top of any pillar page.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const MODES = ['agent', 'interactive', 'advanced'];
  const DEFAULT_MODE = 'advanced';
  const STORAGE_KEY = 'ryujin_mode';
  const TENANT = window.__RYUJIN_TENANT__ || document.documentElement.dataset.tenant || 'plus-ultra';

  let lockedMode = null;        // set when entitlements force a mode
  let currentMode = DEFAULT_MODE;

  function readMode() {
    if (lockedMode) return lockedMode;
    const stored = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
    if (MODES.includes(stored)) return stored;
    return DEFAULT_MODE;
  }

  function writeMode(mode) {
    if (lockedMode && mode !== lockedMode) return false;
    if (!MODES.includes(mode)) return false;
    if (mode === currentMode) return true;
    currentMode = mode;
    localStorage.setItem(STORAGE_KEY, mode);
    document.documentElement.dataset.mode = mode;
    document.dispatchEvent(new CustomEvent('ryujin:mode-change', { detail: { mode, locked: !!lockedMode } }));
    paintToggle();
    return true;
  }

  // ─── UI ────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ry-mode-switcher-styles')) return;
    const css = `
      .ry-mode-switcher {
        position: fixed; top: 14px; right: 14px; z-index: 90;
        display: inline-flex; gap: 0;
        background: rgba(8,12,24,0.95); border: 1px solid rgba(34,211,238,0.25);
        border-radius: 14px; padding: 3px; backdrop-filter: blur(8px);
        box-shadow: 0 4px 14px rgba(0,0,0,0.4);
        font-family: 'Share Tech Mono', monospace;
      }
      .ry-mode-btn {
        background: transparent; border: 0; cursor: pointer;
        color: rgba(160,190,230,0.55); padding: 6px 12px; border-radius: 11px;
        font-size: 0.62em; letter-spacing: 1.6px; text-transform: uppercase;
        font-family: inherit; font-weight: 700;
        transition: all 0.18s; min-width: 64px; text-align: center;
      }
      .ry-mode-btn:hover { color: #d0daf0; }
      .ry-mode-btn.active {
        background: linear-gradient(135deg, rgba(34,211,238,0.18), rgba(124,58,237,0.12));
        color: #22d3ee;
        box-shadow: inset 0 0 12px rgba(34,211,238,0.15);
      }
      .ry-mode-btn:disabled { cursor: not-allowed; opacity: 0.5; }
      .ry-mode-locked {
        font-size: 0.55em; letter-spacing: 1.4px; text-transform: uppercase;
        color: rgba(251,191,36,0.7); padding: 4px 10px;
        border-left: 1px solid rgba(34,211,238,0.16);
      }
      @media (max-width: 540px) {
        .ry-mode-switcher { top: 8px; right: 8px; padding: 2px; }
        .ry-mode-btn { min-width: 0; padding: 5px 8px; font-size: 0.55em; letter-spacing: 1.2px; }
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ry-mode-switcher-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function paintToggle() {
    const root = document.getElementById('ry-mode-switcher');
    if (!root) return;
    root.querySelectorAll('.ry-mode-btn').forEach((b) => {
      const m = b.dataset.mode;
      b.classList.toggle('active', m === currentMode);
      b.disabled = !!(lockedMode && m !== lockedMode);
    });
  }

  function buildToggle() {
    if (document.getElementById('ry-mode-switcher')) return;
    const root = document.createElement('div');
    root.id = 'ry-mode-switcher';
    root.className = 'ry-mode-switcher';
    root.setAttribute('role', 'tablist');
    root.setAttribute('aria-label', 'Interaction mode');
    for (const m of MODES) {
      const b = document.createElement('button');
      b.className = 'ry-mode-btn';
      b.dataset.mode = m;
      b.textContent = m;
      b.setAttribute('role', 'tab');
      b.title = ({
        agent: 'Agent — talk to your archetype, voice or chat',
        interactive: 'Interactive — multiple-choice, controller-friendly',
        advanced: 'Advanced — full mouse + keyboard, edit any label',
      })[m] || m;
      b.addEventListener('click', () => writeMode(m));
      root.appendChild(b);
    }
    document.body.appendChild(root);
    paintToggle();
  }

  async function checkEntitlements() {
    try {
      const r = await fetch('/api/entitlements', { headers: { 'x-tenant-id': TENANT } });
      if (!r.ok) return;
      const ent = await r.json();
      if (ent?.features?.agent_layer_only === true) {
        lockedMode = 'agent';
        // Append a small "(locked)" hint to the toggle.
        const root = document.getElementById('ry-mode-switcher');
        if (root && !root.querySelector('.ry-mode-locked')) {
          const tag = document.createElement('span');
          tag.className = 'ry-mode-locked';
          tag.textContent = 'Agent Layer';
          tag.title = 'Your plan is Agent Layer — write actions are gated; agent mode only.';
          root.appendChild(tag);
        }
        if (currentMode !== 'agent') writeMode('agent');
        else paintToggle();
      }
    } catch { /* fail-open: no lock applied */ }
  }

  function init() {
    injectStyles();
    currentMode = readMode();
    document.documentElement.dataset.mode = currentMode;
    buildToggle();
    checkEntitlements();
    // Public API for shells
    window.RyujinMode = {
      get: () => currentMode,
      set: writeMode,
      MODES,
      isLocked: () => !!lockedMode,
      lockedTo: () => lockedMode,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
