// ═══════════════════════════════════════════════════════════════
// Ryujin OS - shared gamepad layer (window.RyujinPad)
//
// One normalized controller singleton for the whole OS. game.html
// drives the 8-bit overworld + console with it; the same file drops
// into any tool page so the business is operable end-to-end on an
// Xbox controller ("run the whole business with a pad").
//
// Why a shared singleton instead of per-page polling:
//   - The 8-bit game opens tool pages in an iframe; a pad polled in
//     the parent can't drive focus inside the child (cross-frame
//     isolation). Each document that wants the pad includes THIS file
//     and polls its own navigator.getGamepads(), so whichever document
//     has focus responds. interactive-mode-shell.js had its own inline
//     poller; this generalizes it.
//
// API (window.RyujinPad):
//   .dir            → { up,down,left,right } HELD state (dpad OR stick
//                     past deadzone). Read each frame for movement.
//   .on(name, fn)   → edge-press handler. Names:
//                     A B X Y LB RB LT RT BACK START LS RS  (raw buttons)
//                     NAV_UP NAV_DOWN NAV_LEFT NAV_RIGHT     (dpad OR stick
//                     flick, re-armed near centre, for menu focus)
//                     '*' → fires for every edge with the name as arg.
//   .off(name, fn)
//   .onConnect(fn) / .onDisconnect(fn)
//   .rumble(strength=0.4, ms=120)
//   .isConnected()
//   .domFocusNav(opts) → turn NAV_*/A/B into spatial focus nav over a
//                     page's focusable elements (for tool pages). Opt-in.
//
// Standard mapping (Xbox / W3C "standard gamepad"):
//   0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=BACK 9=START
//   10=LS 11=RS 12=DUp 13=DDown 14=DLeft 15=DRight
//   axes[0]=LX axes[1]=LY
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (window.RyujinPad) return;            // singleton, survive double-include

  // Deadzone for treating a stick push as "held"; REARM is the smaller
  // magnitude the stick must fall back under before a NAV flick can
  // re-fire (prevents a held stick from machine-gunning menu focus).
  const DEADZONE = 0.5, REARM = 0.3; // stick magnitudes for held + NAV re-arm

  const RAW_NAMES = {
    0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
    8: 'BACK', 9: 'START', 10: 'LS', 11: 'RS'
    // 12-15 (dpad) are emitted as NAV_* instead of raw, below.
  };

  const handlers = {};                     // name -> [fn]
  const connectFns = [], disconnectFns = [];
  const dir = { up: false, down: false, left: false, right: false };
  const meta = { connected: false, index: null, id: '' };

  let index = null;
  let prevPressed = [];                     // last frame's button pressed[]
  const armed = { up: true, down: true, left: true, right: true };  // NAV re-arm gates

  function on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); }
  function off(name, fn) { if (handlers[name]) handlers[name] = handlers[name].filter(f => f !== fn); }
  function emit(name) {
    (handlers[name] || []).forEach(f => { try { f(); } catch (e) {} });
    (handlers['*'] || []).forEach(f => { try { f(name); } catch (e) {} });
  }

  function pads() { return navigator.getGamepads ? Array.prototype.slice.call(navigator.getGamepads()) : []; }
  function active() { const p = pads(); return index != null ? p[index] : null; }

  function rumble(strength, ms) {
    const gp = active(); if (!gp) return;
    const act = gp.vibrationActuator;
    if (act && act.playEffect) {
      const s = Math.max(0, Math.min(1, strength == null ? 0.4 : strength));
      try { act.playEffect('dual-rumble', { duration: ms || 120, strongMagnitude: s, weakMagnitude: s * 0.7 }); } catch (e) {}
    }
  }

  // Acquire/release the active pad index and fire connect/disconnect.
  function refreshIndex(list) {
    const stillGood = index != null && list[index] && list[index].connected;
    if (stillGood) return;
    const wasConnected = meta.connected;
    const prevIndex = index;
    index = null;
    for (let i = 0; i < list.length; i++) { if (list[i] && list[i].connected) { index = i; break; } }
    const nowConnected = index != null;
    // Active pad changed (disconnect, or swap when one of two drops): start
    // edge detection clean so a button already held on the new pad still
    // gets its rising edge and a stale held direction does not persist.
    if (index !== prevIndex) {
      prevPressed = [];
      dir.up = dir.down = dir.left = dir.right = false;
      armed.up = armed.down = armed.left = armed.right = true;
    }
    if (nowConnected !== wasConnected) {
      meta.connected = nowConnected; meta.index = index;
      if (nowConnected) { meta.id = list[index].id || ''; connectFns.forEach(f => { try { f(list[index]); } catch (e) {} }); }
      else { disconnectFns.forEach(f => { try { f(); } catch (e) {} }); }
    }
  }

  // NAV edge: fire once when crossing DEADZONE, re-arm when back under REARM.
  function navEdge(key, beyond, returned, navName) {
    if (returned) armed[key] = true;
    if (beyond && armed[key]) { armed[key] = false; emit(navName); }
  }

  function poll() {
    const list = pads();
    refreshIndex(list);
    const gp = index != null ? list[index] : null;
    if (gp) {
      const ax = gp.axes || [];
      const lx = ax[0] || 0, ly = ax[1] || 0;
      const pressed = (gp.buttons || []).map(b => (b && (b.pressed || b.value > 0.5)) || false);

      // Held directions = dpad OR stick past deadzone (used for walking).
      const dU = !!pressed[12], dD = !!pressed[13], dL = !!pressed[14], dR = !!pressed[15];
      dir.up = dU || ly < -DEADZONE;
      dir.down = dD || ly > DEADZONE;
      dir.left = dL || lx < -DEADZONE;
      dir.right = dR || lx > DEADZONE;

      // Raw face/shoulder/start edges.
      for (let i = 0; i < pressed.length; i++) {
        if (pressed[i] && !prevPressed[i] && RAW_NAMES[i]) emit(RAW_NAMES[i]);
      }
      // Dpad edges → NAV (discrete, one per press).
      if (dU && !prevPressed[12]) emit('NAV_UP');
      if (dD && !prevPressed[13]) emit('NAV_DOWN');
      if (dL && !prevPressed[14]) emit('NAV_LEFT');
      if (dR && !prevPressed[15]) emit('NAV_RIGHT');
      // Stick flicks → NAV (re-armed near centre). Only the dominant axis
      // fires so a diagonal flick steps menu focus once, not twice.
      const vDom = Math.abs(ly) >= Math.abs(lx);
      navEdge('up', vDom && ly < -DEADZONE, ly > -REARM, 'NAV_UP');
      navEdge('down', vDom && ly > DEADZONE, ly < REARM, 'NAV_DOWN');
      navEdge('left', !vDom && lx < -DEADZONE, lx > -REARM, 'NAV_LEFT');
      navEdge('right', !vDom && lx > DEADZONE, lx < REARM, 'NAV_RIGHT');

      prevPressed = pressed;
    }
    requestAnimationFrame(poll);
  }

  // ─── Optional: spatial DOM focus-nav for ordinary tool pages ───
  // Lets a non-game page be driven by the pad: NAV moves a focus ring
  // between focusable controls (nearest in the pressed direction), A
  // clicks, B goes back. Opt-in via RyujinPad.domFocusNav(). The 8-bit
  // game does NOT use this (it routes the pad itself); this is the
  // drop-in for the ~50 real tool pages (the long tail).
  function domFocusNav(opts) {
    opts = opts || {};
    const SEL = opts.selector ||
      'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[role="button"],.menu-item,[data-pad-focus]';
    function visible(elm) {
      const r = elm.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
        r.top < innerHeight && r.left < innerWidth && elm.offsetParent !== null && !elm.disabled;
    }
    function items() { return Array.prototype.filter.call(document.querySelectorAll(SEL), visible); }
    function center(elm) { const r = elm.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function step(d) {
      const list = items(); if (!list.length) return;
      const cur = document.activeElement && list.indexOf(document.activeElement) >= 0 ? document.activeElement : null;
      if (!cur) { list[0].focus(); return; }
      const c = center(cur);
      let best = null, bestScore = Infinity;
      list.forEach(elm => {
        if (elm === cur) return;
        const p = center(elm);
        const dx = p.x - c.x, dy = p.y - c.y;
        const horiz = d === 'left' || d === 'right';
        const along = d === 'right' ? dx : d === 'left' ? -dx : d === 'down' ? dy : -dy;
        if (along <= 1) return;                              // must be in the pressed direction
        const cross = horiz ? Math.abs(dy) : Math.abs(dx);
        const score = along + cross * 2;                     // prefer aligned + close
        if (score < bestScore) { bestScore = score; best = elm; }
      });
      if (best) { best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      else list[0].focus();
    }
    on('NAV_UP', () => step('up')); on('NAV_DOWN', () => step('down'));
    on('NAV_LEFT', () => step('left')); on('NAV_RIGHT', () => step('right'));
    on('A', () => { const a = document.activeElement; if (a && typeof a.click === 'function') a.click(); });
    on('B', () => { if (opts.onBack) opts.onBack(); else if (history.length > 1) history.back(); });
    if (opts.onStart) on('START', opts.onStart);
  }

  // gamepadconnected/disconnected just kick a poll; acquisition is done
  // in refreshIndex so we don't depend on the events firing (some
  // browsers require a button press first).
  window.addEventListener('gamepadconnected', () => {});
  window.addEventListener('gamepaddisconnected', () => {});

  window.RyujinPad = {
    dir, on, off, rumble, domFocusNav,
    isConnected: () => meta.connected,
    state: meta,
    onConnect: (fn) => { connectFns.push(fn); if (meta.connected) { try { fn(active()); } catch (e) {} } },
    onDisconnect: (fn) => disconnectFns.push(fn),
    DEADZONE
  };

  requestAnimationFrame(poll);
})();
