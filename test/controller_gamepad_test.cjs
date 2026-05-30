// ═══════════════════════════════════════════════════════════════
// Gamepad-mock harness for public/assets/controller.js (window.RyujinPad).
//
// A real Xbox controller cannot be driven by browser automation (the
// Gamepad API reads OS-level HID; there is no CDP/Playwright/Puppeteer
// gamepad-input API). This harness is the next best automated coverage:
// it loads controller.js in a vm sandbox, MOCKS navigator.getGamepads(),
// ticks the poll loop frame-by-frame, and asserts RyujinPad's held-
// direction state + edge events + the review fixes (diagonal-NAV
// dominance, multi-pad swap edge-state reset).
//
// It does NOT validate real-pad button MAPPING or rumble (hardware only).
//
// Run: node test/controller_gamepad_test.cjs
// ═══════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ─── Browser shim in a vm sandbox (Node 24's real globals are read-only) ──
let rafCb = null;          // controller calls requestAnimationFrame(poll); we capture + tick
let pads = [];             // current navigator.getGamepads() payload
const sandbox = {
  navigator: { getGamepads: () => pads },
  requestAnimationFrame: (cb) => { rafCb = cb; return 1; },
  cancelAnimationFrame: () => {},
  document: { addEventListener() {}, querySelectorAll() { return []; } },
  window: { addEventListener() {}, removeEventListener() {} },
  Math, Array, Object, Promise, console,
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);

const CTRL = process.argv[2] || path.join(__dirname, '..', 'public', 'assets', 'controller.js');
vm.runInContext(fs.readFileSync(CTRL, 'utf8'), sandbox, { filename: 'controller.js' });
const Pad = sandbox.window.RyujinPad;

// ─── Helpers ─────────────────────────────────────────────────────
function tick() { const cb = rafCb; rafCb = null; if (cb) cb(); }   // one poll frame
function gp(opts) {
  opts = opts || {};
  const pressed = opts.buttons || [];
  return {
    connected: opts.connected !== false,
    id: opts.id || 'Xbox Wireless Controller (STANDARD GAMEPAD)',
    mapping: 'standard',
    axes: opts.axes || [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: !!pressed[i], value: pressed[i] ? 1 : 0 })),
    vibrationActuator: { playEffect() { return Promise.resolve('complete'); } },
  };
}
function setPads(list) { pads = list; }
function dpad(i) { const b = []; b[i] = true; return b; }

const fired = [];
['A', 'B', 'X', 'Y', 'START', 'BACK', 'LB', 'RB', 'NAV_UP', 'NAV_DOWN', 'NAV_LEFT', 'NAV_RIGHT']
  .forEach(n => Pad.on(n, () => fired.push(n)));
function clearFired() { fired.length = 0; }
function count(n) { return fired.filter(x => x === n).length; }

let connects = 0, disconnects = 0;
Pad.onConnect(() => connects++);
Pad.onDisconnect(() => disconnects++);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

console.log('controller.js gamepad harness:', CTRL);

// 1. No pad initially
tick();
ok(!Pad.isConnected(), 'no pad connected initially');

// 2. Connect fires once, isConnected flips
setPads([gp({})]); tick();
ok(Pad.isConnected(), 'isConnected true after a pad appears');
ok(connects === 1, 'onConnect fired exactly once (' + connects + ')');

// 3. Held direction from stick + dpad
setPads([gp({ axes: [-1, 0] })]); tick();
ok(Pad.dir.left && !Pad.dir.right && !Pad.dir.up && !Pad.dir.down, 'stick left -> dir.left only');
setPads([gp({ axes: [0, -1] })]); tick();
ok(Pad.dir.up && !Pad.dir.down, 'stick up -> dir.up');
setPads([gp({ buttons: dpad(15) })]); tick();
ok(Pad.dir.right, 'dpad-right -> dir.right');
setPads([gp({})]); tick();
ok(!Pad.dir.left && !Pad.dir.right && !Pad.dir.up && !Pad.dir.down, 'centered -> no held dir');

// 4. Face-button edge: once on press, not while held, again after release
clearFired();
setPads([gp({ buttons: [true] })]); tick();   // A down
setPads([gp({ buttons: [true] })]); tick();   // A held
ok(count('A') === 1, 'A fires once while held (edge)');
setPads([gp({})]); tick();                    // A up
setPads([gp({ buttons: [true] })]); tick();   // A down again
ok(count('A') === 2, 'A fires again after release + repress');

// 5. NAV via dpad edge
clearFired();
setPads([gp({ buttons: dpad(13) })]); tick();
ok(fired.includes('NAV_DOWN'), 'dpad-down -> NAV_DOWN');

// 6. NAV via stick flick: one fire, re-armed only after returning near centre
clearFired();
setPads([gp({ axes: [0, 0.9] })]); tick();
setPads([gp({ axes: [0, 0.9] })]); tick();
ok(count('NAV_DOWN') === 1, 'stick-down NAV fires once while held');
setPads([gp({ axes: [0, 0] })]); tick();
setPads([gp({ axes: [0, 0.9] })]); tick();
ok(count('NAV_DOWN') === 2, 'stick-down NAV re-fires after re-centre');

// 7. Diagonal flick = single dominant-axis NAV (review fix)
clearFired();
setPads([gp({ axes: [0, 0] })]); tick();
setPads([gp({ axes: [0.9, 0.95] })]); tick();   // down-right, vertical dominant
ok(fired.filter(x => x.startsWith('NAV_')).length === 1, 'diagonal flick fires exactly one NAV');
ok(fired.includes('NAV_DOWN') && !fired.includes('NAV_RIGHT'), 'dominant axis wins the diagonal');

// 8. Deadzone: a small nudge is not a held direction
setPads([gp({ axes: [0.2, 0] })]); tick();
ok(!Pad.dir.right, 'sub-deadzone nudge does not register as held');

// 9. Disconnect clears state + fires once
clearFired();
setPads([]); tick();
ok(!Pad.isConnected(), 'isConnected false after disconnect');
ok(disconnects === 1, 'onDisconnect fired once');
ok(!Pad.dir.up && !Pad.dir.down && !Pad.dir.left && !Pad.dir.right, 'held dir cleared on disconnect');

// 10. Multi-pad swap: active pad drops, second pad (button already held) gets a fresh edge (review fix)
setPads([gp({})]); tick();                      // pad A at index 0
clearFired();
setPads([gp({ connected: false }), gp({ buttons: [true], id: 'pad-B' })]); tick();
ok(count('A') === 1, 'held button on swapped-in pad gets a fresh rising edge');

// 11. rumble does not throw with a mocked actuator
let threw = false; try { Pad.rumble(0.5, 100); } catch (e) { threw = true; }
ok(!threw, 'rumble() is safe to call');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
