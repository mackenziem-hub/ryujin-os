// ────────────────────────────────────────────────────────────────────
// Ryujin Mode — LIVE vs SANDBOX toggle.
// LIVE = real data, real APIs, real consequences.
// SANDBOX = isolated practice mode. Pre-loaded fictional scenario.
//
// Fires 'ryujin-mode-change' CustomEvent on document when mode changes.
// ────────────────────────────────────────────────────────────────────
(function(){
  const M = window.RyujinMode = window.RyujinMode || {};
  const KEY = 'ry_mode';
  const LIVE = 'live', SANDBOX = 'sandbox';

  function get(){
    try { return localStorage.getItem(KEY) === SANDBOX ? SANDBOX : LIVE; } catch(e){ return LIVE; }
  }
  function set(mode){
    const m = mode === SANDBOX ? SANDBOX : LIVE;
    try { localStorage.setItem(KEY, m); } catch(e){}
    document.documentElement.setAttribute('data-ry-mode', m);
    document.dispatchEvent(new CustomEvent('ryujin-mode-change', { detail: { mode: m } }));
    return m;
  }
  function toggle(){ return set(get() === LIVE ? SANDBOX : LIVE); }
  function isSandbox(){ return get() === SANDBOX; }
  function isLive(){ return get() === LIVE; }

  // Namespace helper — persist uses this to pick the right prefix
  function nsPrefix(){ return isSandbox() ? 'ry_sb_' : 'ry_v1_'; }

  M.get = get;
  M.set = set;
  M.toggle = toggle;
  M.isSandbox = isSandbox;
  M.isLive = isLive;
  M.nsPrefix = nsPrefix;
  M.LIVE = LIVE;
  M.SANDBOX = SANDBOX;

  // Initialize doc attribute on load so CSS can react
  document.documentElement.setAttribute('data-ry-mode', get());
})();
