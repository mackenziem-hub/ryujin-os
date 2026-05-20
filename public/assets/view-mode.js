/*
 * Ryujin OS · View-mode controller
 *
 * Three interchangeable view modes for the internal portal layer:
 *   graph  · noun-centric drilldown
 *   canvas · spatial cluster map
 *   river  · chronological feed
 *
 * Persists the user's choice in localStorage ('ry_view_mode'),
 * sets data-view-mode on <body>, and dispatches a 'viewmodechange'
 * CustomEvent so individual page components can react.
 *
 * Drop-in usage:
 *   <body>...<button class="rj-mode-toggle-btn" data-mode="graph">Graph</button>...</body>
 *   <script type="module" src="/assets/view-mode.js"></script>
 *
 * Programmatic:
 *   window.RyujinView.get();        // 'graph' | 'canvas' | 'river'
 *   window.RyujinView.set('canvas');
 *   document.addEventListener('viewmodechange', (e) => {
 *     console.log(e.detail.mode, 'was', e.detail.previous);
 *   });
 */

const STORAGE_KEY = 'ry_view_mode';
const MODES = Object.freeze(['graph', 'canvas', 'river']);
const DEFAULT_MODE = 'graph';

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(v) ? v : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function writeStored(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private mode, ignore */ }
}

function applyMode(mode, previous) {
  document.body.setAttribute('data-view-mode', mode);
  refreshToggleButtons(mode);
  document.dispatchEvent(new CustomEvent('viewmodechange', {
    detail: { mode, previous }
  }));
}

function refreshToggleButtons(mode) {
  document.querySelectorAll('.rj-mode-toggle-btn').forEach((btn) => {
    if (btn.dataset.mode === mode) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

function wireToggles() {
  document.querySelectorAll('.rj-mode-toggle-btn').forEach((btn) => {
    if (btn.dataset.viewModeBound === '1') return;
    btn.dataset.viewModeBound = '1';
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode;
      if (MODES.includes(next)) set(next);
    });
  });
}

function get() {
  return document.body.getAttribute('data-view-mode') || readStored();
}

function set(mode) {
  if (!MODES.includes(mode)) return false;
  const previous = get();
  if (previous === mode) return true;
  writeStored(mode);
  applyMode(mode, previous);
  return true;
}

function init() {
  const initial = readStored();
  applyMode(initial, null);
  wireToggles();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.RyujinView = Object.freeze({
  get,
  set,
  modes: MODES,
  STORAGE_KEY
});
