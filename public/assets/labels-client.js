// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Client-side label resolver + DOM applier.
//
// Mirrors lib/labels.js getLabel() and walks the DOM at load to swap
// every [data-label-id="<key>"] element's text with the operator's
// per-tenant override (if any).
//
// Drop-in: <script src="/assets/labels-client.js" defer></script>
// in any pillar page that contains data-label-id attributes.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TENANT = window.__RYUJIN_TENANT__ || document.documentElement.dataset.tenant || 'plus-ultra';
  const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

  let overrides = {};

  function isValid(key) { return typeof key === 'string' && KEY_PATTERN.test(key); }

  function getLabel(key, fallback) {
    if (!isValid(key)) return fallback ?? key;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const v = overrides[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return fallback ?? key;
  }

  function applyToDom(root) {
    (root || document).querySelectorAll('[data-label-id]').forEach((el) => {
      const key = el.getAttribute('data-label-id');
      if (!isValid(key)) return;
      // Cache the original text on first apply so we can fall back if override clears.
      if (!el.dataset.labelOriginal) el.dataset.labelOriginal = el.textContent.trim();
      const fallback = el.dataset.labelOriginal;
      const next = getLabel(key, fallback);
      if (el.textContent !== next) el.textContent = next;
    });
  }

  async function fetchOverrides() {
    try {
      const r = await fetch('/api/settings', { headers: { 'x-tenant-id': TENANT } });
      if (!r.ok) return;
      const data = await r.json();
      overrides = data?.label_overrides || {};
    } catch { /* fail-open: no overrides applied */ }
  }

  // ─── Inline-edit affordance (advanced mode only) ──────────────
  let editEnabled = false;
  let entitlementsReadOnly = false;

  function injectEditStyles() {
    if (document.getElementById('ry-label-edit-styles')) return;
    const css = `
      [data-label-id] { position: relative; }
      [data-label-id].ry-label-editable { cursor: text; }
      [data-label-id].ry-label-editable:hover::after {
        content: '✎'; position: absolute; right: -16px; top: 50%; transform: translateY(-50%);
        font-size: 0.85em; color: rgba(34,211,238,0.7); pointer-events: none;
      }
      input.ry-label-editor {
        font: inherit; color: inherit; background: rgba(6,10,20,0.7);
        border: 1px solid rgba(34,211,238,0.4); border-radius: 4px;
        padding: 1px 6px; outline: none; min-width: 60px; max-width: 240px;
        box-shadow: 0 0 8px rgba(34,211,238,0.2);
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ry-label-edit-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function setEditAffordance(on) {
    document.querySelectorAll('[data-label-id]').forEach((el) => {
      el.classList.toggle('ry-label-editable', !!on);
      if (on) el.addEventListener('click', onLabelClick);
      else el.removeEventListener('click', onLabelClick);
    });
  }

  function onLabelClick(ev) {
    if (!editEnabled || entitlementsReadOnly) return;
    const el = ev.currentTarget;
    if (el.querySelector('input.ry-label-editor')) return;  // already editing
    if (el.closest('a')) ev.preventDefault();
    ev.stopPropagation();
    const key = el.getAttribute('data-label-id');
    if (!isValid(key)) return;
    const before = el.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 80;
    input.className = 'ry-label-editor';
    input.value = before;
    el.textContent = '';
    el.appendChild(input);
    input.focus(); input.select();

    let committed = false;
    const commit = async (cancel) => {
      if (committed) return;
      committed = true;
      const next = (input.value || '').trim();
      if (cancel || next === before || next === '') {
        el.textContent = before;
        applyToDom(el.parentElement || el);
        return;
      }
      // Persist via PATCH /api/settings?field=label_overrides
      el.textContent = next;
      try {
        await fetch('/api/settings?field=label_overrides', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
          body: JSON.stringify({ [key]: next })
        });
        overrides[key] = next;
      } catch { /* keep local change but warn nobody — best-effort */ }
    };
    input.addEventListener('blur', () => commit(false));
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') { k.preventDefault(); input.blur(); }
      if (k.key === 'Escape') { k.preventDefault(); commit(true); }
    });
  }

  async function checkEntitlements() {
    try {
      const r = await fetch('/api/entitlements', { headers: { 'x-tenant-id': TENANT } });
      if (!r.ok) return;
      const ent = await r.json();
      entitlementsReadOnly = !!ent?.features?.agent_layer_only;
    } catch { /* fail-open */ }
  }

  function syncToMode() {
    const mode = (window.RyujinMode && window.RyujinMode.get()) || (document.documentElement.dataset.mode) || 'advanced';
    editEnabled = (mode === 'advanced') && !entitlementsReadOnly;
    setEditAffordance(editEnabled);
  }

  // Public API for inline editors / mode-switcher
  window.RyujinLabels = {
    get: getLabel,
    apply: applyToDom,
    refresh: async () => { await fetchOverrides(); applyToDom(); },
    setOverride(key, value) {
      if (!isValid(key)) return false;
      if (value === null || value === '') delete overrides[key];
      else overrides[key] = value;
      applyToDom();
      return true;
    },
    overrides() { return { ...overrides }; },
  };

  async function init() {
    injectEditStyles();
    await Promise.all([fetchOverrides(), checkEntitlements()]);
    applyToDom();
    syncToMode();
    document.addEventListener('ryujin:mode-change', syncToMode);
    // Re-apply when the DOM mutates (panels render briefing/KPI cards async).
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes.length) { applyToDom(); if (editEnabled) setEditAffordance(true); break; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
