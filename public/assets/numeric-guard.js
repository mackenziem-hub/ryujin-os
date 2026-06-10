// ═══════════════════════════════════════════════════════════════
// NUMERIC GUARD - shared on-blur validator for money/quantity inputs.
//
// Bug Class #10 (2026-06-09 pillar review): paysheet, PO, and WO
// surfaces silently coerce "$100" or "12 sq" to 0 via Number(value)||0,
// and the operator only finds out at vendor reconciliation. This module
// gives immediate on-blur feedback: red border + inline message, and it
// NEVER zeroes or rewrites what the user typed.
//
// Usage (classic script, no module system):
//   <script src="/assets/numeric-guard.js"></script>
//   NumericGuard.attach(inputEl)            -> validates on blur, clears on input
//   NumericGuard.parse('$1,500.50')         -> { ok: true,  num: 1500.5 }
//   NumericGuard.parse('abc')               -> { ok: false, num: null, error: ... }
//   NumericGuard.validate(inputEl)          -> runs parse + paints/clears the error UI
//   NumericGuard.hasErrors(rootEl?)         -> true if any guarded input is invalid
//   NumericGuard.dismissAll()               -> remove floating messages (call on modal close)
//
// <input type="number"> note: browsers swallow bad text (value reads ''
// while the junk is still visible), so validate() checks validity.badInput
// before parsing - that is the only tell.
// ═══════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  var MSG_ATTR = 'data-ng-msg-for';
  var counter = 0;

  // Strip $ signs, commas, and spaces; everything left must be one number.
  // Number() (not parseFloat) so '12abc' fails instead of truncating to 12.
  function parse(value) {
    if (value == null) return { ok: true, num: 0, empty: true };
    var raw = String(value).trim();
    if (!raw) return { ok: true, num: 0, empty: true };
    var cleaned = raw.replace(/[$,\s]/g, '');
    var num = Number(cleaned);
    if (cleaned === '' || !isFinite(num)) {
      return { ok: false, num: null, error: 'Not a number: "' + raw + '"' };
    }
    return { ok: true, num: num };
  }

  function ensureId(el) {
    if (!el.dataset.ngId) { counter += 1; el.dataset.ngId = 'ng' + counter; }
    return el.dataset.ngId;
  }

  function msgNodeFor(el) {
    var id = el.dataset.ngId;
    return id ? document.querySelector('[' + MSG_ATTR + '="' + id + '"]') : null;
  }

  // Remove message nodes whose input left the DOM (re-rendered rows, etc.).
  function sweep() {
    var nodes = document.querySelectorAll('[' + MSG_ATTR + ']');
    for (var i = 0; i < nodes.length; i++) {
      var owner = document.querySelector('[data-ng-id="' + nodes[i].getAttribute(MSG_ATTR) + '"]');
      if (!owner) nodes[i].remove();
    }
  }

  function dismissAll() {
    var nodes = document.querySelectorAll('[' + MSG_ATTR + ']');
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
  }

  function clearError(el) {
    el.style.borderColor = '';
    el.style.boxShadow = '';
    el.removeAttribute('data-ng-error');
    el.removeAttribute('aria-invalid');
    el.title = '';
    var msg = msgNodeFor(el);
    if (msg) msg.remove();
  }

  function showError(el, text) {
    sweep();
    el.style.borderColor = '#f87171';
    el.style.boxShadow = '0 0 0 1px rgba(248,113,113,0.45)';
    el.setAttribute('data-ng-error', text);
    el.setAttribute('aria-invalid', 'true');
    el.title = text;
    var id = ensureId(el);
    var msg = msgNodeFor(el);
    if (!msg) {
      msg = document.createElement('div');
      msg.setAttribute(MSG_ATTR, id);
      msg.style.cssText = 'position:absolute;z-index:9999;font:600 11px/1.3 Inter,system-ui,sans-serif;' +
        'color:#f87171;background:rgba(20,8,10,0.94);border:1px solid rgba(248,113,113,0.5);' +
        'border-radius:6px;padding:3px 8px;pointer-events:none;max-width:240px';
      document.body.appendChild(msg);
    }
    msg.textContent = text;
    var r = el.getBoundingClientRect();
    msg.style.left = Math.round(r.left + (global.scrollX || 0)) + 'px';
    msg.style.top = Math.round(r.bottom + (global.scrollY || 0) + 3) + 'px';
  }

  function validate(el, opts) {
    opts = opts || {};
    // type=number with unparseable content: value is '' but the junk is on screen.
    if (el.validity && el.validity.badInput) {
      var bad = opts.message || 'Numbers only - no $ signs or letters';
      showError(el, bad);
      return { ok: false, num: null, error: bad };
    }
    var result = parse(el.value);
    if (!result.ok) {
      showError(el, opts.message || result.error);
      return result;
    }
    if (opts.allowNegative === false && result.num < 0) {
      var neg = 'Must not be negative';
      showError(el, neg);
      return { ok: false, num: null, error: neg };
    }
    clearError(el);
    return result;
  }

  function attach(el, opts) {
    if (!el || el.dataset.ngAttached) return el;
    el.dataset.ngAttached = '1';
    el.addEventListener('blur', function () { validate(el, opts); });
    el.addEventListener('input', function () { clearError(el); });
    return el;
  }

  function hasErrors(root) {
    return !!(root || document).querySelector('[data-ng-error]');
  }

  global.NumericGuard = {
    parse: parse,
    validate: validate,
    attach: attach,
    clearError: clearError,
    hasErrors: hasErrors,
    dismissAll: dismissAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
