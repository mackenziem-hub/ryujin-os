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
    await fetchOverrides();
    applyToDom();
    // Re-apply when the DOM mutates (panels render briefing/KPI cards async).
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes.length) { applyToDom(); break; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
