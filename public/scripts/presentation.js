/*
 * presentation.js v2
 * Gamma-style slideshow + softened color palette + sticky-note suggestions
 * for Ryujin deck pages. Activates on any page containing .slide sections.
 *
 * Controls
 *   Right arrow / Space / PageDown / click right edge / swipe left  -> next
 *   Left arrow / PageUp / click left edge / swipe right             -> previous
 *   Home / End                                                       -> jump first / last
 *   Esc                                                              -> toggle scroll mode
 *   S                                                                -> toggle scroll mode
 *   F                                                                -> fullscreen
 *   N                                                                -> add a new suggestion sticky note on the current slide
 *
 * Sticky notes
 *   Click "+ Add suggestion" on any slide to write a note. Notes persist
 *   in localStorage keyed per deck per slide. Pre-populated Jewels notes
 *   render in gold with a star prefix.
 */
(function () {
  'use strict';

  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (slides.length === 0) return;

  /* ────────────────────────────────────────────────────────────────
   *  STYLE INJECTION
   *  - Presentation-mode layout
   *  - Color softener (unifies dark/light/gold slides on a navy base)
   *  - Sticky-note styles
   * ──────────────────────────────────────────────────────────────── */
  var STYLE = [
    /* Presentation mode shell */
    'body.present-mode { overflow: hidden; background: #0a0e1a; }',
    'body.present-mode .topbar { display: none; }',
    'body.present-mode .nav-dots { display: none; }',
    'body.present-mode footer { display: none; }',
    'body.present-mode .slide {',
    '  position: fixed; top: 0; left: 0; right: 0; bottom: 0;',
    '  min-height: 100vh; height: 100vh;',
    '  border-bottom: none;',
    '  opacity: 0; pointer-events: none;',
    '  transform: translateX(48px) scale(0.985);',
    '  transition: opacity 0.42s cubic-bezier(0.22, 0.61, 0.36, 1), transform 0.42s cubic-bezier(0.22, 0.61, 0.36, 1);',
    '  overflow-y: auto; overflow-x: hidden;',
    '  -webkit-overflow-scrolling: touch;',
    '}',
    'body.present-mode .slide.present-active {',
    '  opacity: 1; pointer-events: auto;',
    '  transform: translateX(0) scale(1);',
    '  z-index: 10;',
    '}',
    'body.present-mode .slide.present-prev { transform: translateX(-48px) scale(0.985); }',
    'body.present-mode .slide-num { display: none; }',

    /* ── COLOR SOFTENER ──
       Unifies the palette. Light slides become "raised navy" instead of
       paper-cream, gold slides become accent-bordered navy instead of full
       gold flood. Eliminates the dark to bright to dark whiplash. */

    '.slide.light { background: linear-gradient(180deg, #172244 0%, #1a2645 100%) !important; }',
    '.slide.light h1, .slide.light h2 { color: #fff !important; }',
    '.slide.light h3 { color: #fde047 !important; }',
    '.slide.light p { color: rgba(255,255,255,0.84) !important; }',
    '.slide.light ul, .slide.light ol { color: rgba(255,255,255,0.84) !important; }',
    '.slide.light strong { color: #fff !important; }',
    '.slide.light .slide-num { color: rgba(255,255,255,0.4) !important; }',
    '.slide.light .slide-kicker {',
    '  color: #facc15 !important;',
    '  background: rgba(250,204,21,0.12) !important;',
    '  border: 1px solid rgba(250,204,21,0.32) !important;',
    '}',
    '.slide.light .stat { background: rgba(255,255,255,0.06) !important; border-color: rgba(255,255,255,0.1) !important; }',
    '.slide.light .stat .v { color: #fff !important; }',
    '.slide.light .stat .l { color: rgba(255,255,255,0.6) !important; }',
    '.slide.light .bx-table { background: rgba(255,255,255,0.04) !important; border-color: rgba(255,255,255,0.1) !important; }',
    '.slide.light .bx-table th { background: rgba(14,26,53,0.65) !important; color: #fde047 !important; border-color: transparent !important; }',
    '.slide.light .bx-table td { color: rgba(255,255,255,0.85) !important; border-top-color: rgba(255,255,255,0.06) !important; }',

    /* Light-mode "touch card" rebalance */
    '.slide.light .touch-light, .slide.light .touch {',
    '  background: rgba(255,255,255,0.04) !important;',
    '  border: 1px solid rgba(255,255,255,0.08) !important;',
    '  border-left: 4px solid #facc15 !important;',
    '}',
    '.slide.light .touch-light .touch-head .when, .slide.light .touch .touch-head .when { color: #facc15 !important; }',
    '.slide.light .touch-light .touch-head h3, .slide.light .touch .touch-head h3 { color: #fff !important; }',
    '.slide.light .touch-light .touch-meta, .slide.light .touch .touch-meta { color: rgba(255,255,255,0.65) !important; }',
    '.slide.light .touch-light .touch-meta b, .slide.light .touch .touch-meta b { color: rgba(255,255,255,0.88) !important; }',
    '.slide.light .touch-light .touch-foot, .slide.light .touch .touch-foot { color: rgba(255,255,255,0.6) !important; }',
    '.slide.light .touch-body, .slide.light .touch-light .touch-body { background: #0a0e1a !important; color: rgba(255,255,255,0.92) !important; border-color: rgba(255,255,255,0.08) !important; }',

    /* Light-mode branch / guard cards */
    '.slide.light .branch, .slide.light .guard { background: rgba(217,119,6,0.12) !important; border-color: rgba(217,119,6,0.35) !important; }',
    '.slide.light .branch p, .slide.light .guard p { color: rgba(255,255,255,0.82) !important; }',
    '.slide.light .branch-green { background: rgba(22,163,74,0.12) !important; border-color: rgba(22,163,74,0.4) !important; }',
    '.slide.light .branch-red { background: rgba(220,38,38,0.12) !important; border-color: rgba(220,38,38,0.4) !important; }',

    /* Gold sign-off slide rebalance */
    '.slide.gold { background: linear-gradient(135deg, #1a2440 0%, #1d2745 100%) !important; }',
    '.slide.gold h1, .slide.gold h2 { color: #fff !important; }',
    '.slide.gold h3 { color: #fde047 !important; }',
    '.slide.gold p, .slide.gold li { color: rgba(255,255,255,0.85) !important; }',
    '.slide.gold strong { color: #fff !important; }',
    '.slide.gold .slide-num { color: rgba(255,255,255,0.5) !important; }',
    '.slide.gold .slide-kicker {',
    '  color: #facc15 !important;',
    '  background: rgba(250,204,21,0.12) !important;',
    '  border: 1px solid rgba(250,204,21,0.35) !important;',
    '}',
    '.slide.gold .signoff li {',
    '  background: rgba(255,255,255,0.04) !important;',
    '  border: 1px solid rgba(250,204,21,0.22) !important;',
    '  border-left: 4px solid #facc15 !important;',
    '  color: #fff !important;',
    '}',
    '.slide.gold .signoff li strong { color: #fde047 !important; }',
    '.slide.gold .signoff li::before { color: #facc15 !important; }',
    '.slide.gold .signoff li code { background: rgba(250,204,21,0.18) !important; color: #fde047 !important; padding: 2px 6px !important; border-radius: 4px !important; }',

    /* ── PRESENT-UI ── */
    '.present-ui {',
    '  position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);',
    '  z-index: 100;',
    '  background: rgba(14, 26, 53, 0.92); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);',
    '  border: 1px solid rgba(250, 204, 21, 0.35);',
    '  border-radius: 999px; padding: 8px 10px;',
    '  display: flex; align-items: center; gap: 6px;',
    '  font-family: "Inter", system-ui, sans-serif;',
    '  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);',
    '  transition: opacity 0.3s;',
    '}',
    '.present-btn {',
    '  background: rgba(255, 255, 255, 0.06);',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  color: #fff; cursor: pointer;',
    '  width: 38px; height: 38px; border-radius: 50%;',
    '  font-size: 1.25em; font-weight: 700; line-height: 1;',
    '  display: flex; align-items: center; justify-content: center;',
    '  transition: background 0.15s, transform 0.15s, border-color 0.15s;',
    '  padding: 0;',
    '  font-family: inherit;',
    '}',
    '.present-btn:hover { background: rgba(250, 204, 21, 0.22); border-color: rgba(250, 204, 21, 0.5); transform: scale(1.08); }',
    '.present-btn:active { transform: scale(0.94); }',
    '.present-btn.icon { font-size: 0.95em; }',
    '.present-counter {',
    '  color: rgba(255, 255, 255, 0.7); font-size: 0.85em; font-weight: 700;',
    '  padding: 0 12px; min-width: 62px; text-align: center;',
    '  letter-spacing: 1px;',
    '  font-variant-numeric: tabular-nums;',
    '}',
    '.present-counter .curr { color: #facc15; font-size: 1.1em; }',
    '.present-progress {',
    '  position: fixed; top: 0; left: 0; right: 0;',
    '  height: 3px; background: rgba(14, 26, 53, 0.5);',
    '  z-index: 100;',
    '}',
    '.present-progress-bar {',
    '  height: 100%; background: linear-gradient(90deg, #facc15, #fde047);',
    '  width: 0; transition: width 0.42s cubic-bezier(0.22, 0.61, 0.36, 1);',
    '  box-shadow: 0 0 10px rgba(250, 204, 21, 0.6);',
    '}',
    '.present-hint {',
    '  position: fixed; top: 18px; right: 18px; z-index: 100;',
    '  background: rgba(14, 26, 53, 0.85); backdrop-filter: blur(10px);',
    '  color: rgba(255, 255, 255, 0.85); font-size: 0.75em;',
    '  padding: 8px 14px; border-radius: 6px;',
    '  border: 1px solid rgba(250, 204, 21, 0.25);',
    '  font-family: "Inter", system-ui, sans-serif;',
    '  letter-spacing: 0.5px;',
    '  pointer-events: none;',
    '  opacity: 1; transition: opacity 0.6s;',
    '}',
    '.present-hint.fade { opacity: 0; }',
    '.present-hint kbd {',
    '  background: rgba(250, 204, 21, 0.18); color: #fde047;',
    '  padding: 2px 6px; border-radius: 3px;',
    '  font-family: "JetBrains Mono", monospace; font-size: 0.92em;',
    '  margin: 0 3px;',
    '}',

    /* ── STICKY NOTES ── */
    '.note-toggle {',
    '  position: absolute; top: 18px; left: 18px; z-index: 35;',
    '  background: rgba(14, 26, 53, 0.85); backdrop-filter: blur(8px);',
    '  border: 1px solid rgba(250, 204, 21, 0.42);',
    '  color: #fde047;',
    '  padding: 9px 14px; border-radius: 999px;',
    '  font-size: 0.78em; font-weight: 700; letter-spacing: 0.4px;',
    '  cursor: pointer; font-family: "Inter", system-ui, sans-serif;',
    '  display: inline-flex; align-items: center; gap: 8px;',
    '  transition: background 0.15s, transform 0.15s, border-color 0.15s;',
    '  text-transform: uppercase;',
    '}',
    '.note-toggle:hover { background: rgba(14, 26, 53, 0.96); border-color: rgba(250, 204, 21, 0.7); transform: scale(1.04); }',
    '.note-toggle.open { background: rgba(14, 26, 53, 1); border-color: #facc15; box-shadow: 0 6px 20px rgba(250, 204, 21, 0.25); }',
    '.note-toggle .count-pill {',
    '  background: #facc15; color: #0e1a35;',
    '  padding: 1px 7px; border-radius: 999px;',
    '  font-size: 0.92em; font-weight: 800;',
    '  min-width: 20px; text-align: center; line-height: 1.3;',
    '}',
    '.note-toggle .count-pill.revised { background: #93c5fd; color: #0c1e3a; }',
    '.note-toggle .count-pill.user { background: #fef9c3; color: #1a1f2e; }',
    '.note-stack {',
    '  position: absolute; top: 62px; left: 18px;',
    '  display: none; flex-direction: column; gap: 10px;',
    '  max-width: 360px; width: 360px;',
    '  z-index: 30;',
    '  font-family: "Inter", system-ui, sans-serif;',
    '  max-height: calc(100vh - 100px); overflow-y: auto;',
    '  padding-right: 4px;',
    '}',
    '.note-stack.open { display: flex; }',
    '.note-add-btn {',
    '  background: rgba(250, 204, 21, 0.12);',
    '  border: 1px dashed rgba(250, 204, 21, 0.45);',
    '  color: #fde047;',
    '  padding: 9px 14px;',
    '  border-radius: 8px;',
    '  font-size: 0.84em; font-weight: 700;',
    '  cursor: pointer;',
    '  display: flex; align-items: center; gap: 8px;',
    '  letter-spacing: 0.5px;',
    '  transition: background 0.15s, border-color 0.15s, transform 0.15s;',
    '  font-family: inherit;',
    '  width: auto; align-self: flex-start;',
    '}',
    '.note-add-btn:hover { background: rgba(250, 204, 21, 0.22); border-color: rgba(250, 204, 21, 0.7); transform: translateY(-1px); }',
    '.note-add-btn .plus { font-size: 1.25em; font-weight: 900; line-height: 1; }',
    '.note {',
    '  background: linear-gradient(180deg, #fef9c3 0%, #fde68a 100%);',
    '  color: #1a1f2e;',
    '  padding: 12px 14px 10px;',
    '  border-radius: 4px;',
    '  border: 1px solid rgba(250, 204, 21, 0.45);',
    '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2);',
    '  font-size: 0.86em;',
    '  line-height: 1.5;',
    '  cursor: pointer;',
    '  transform: rotate(-0.6deg);',
    '  transition: transform 0.18s, box-shadow 0.18s;',
    '  position: relative;',
    '}',
    '.note:nth-child(odd) { transform: rotate(0.5deg); }',
    '.note:hover { transform: rotate(0) scale(1.02); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); z-index: 5; }',
    '.note.note-jules {',
    '  background: linear-gradient(180deg, #fde68a 0%, #facc15 100%);',
    '  border: 1px solid rgba(146, 64, 14, 0.4);',
    '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 0 0 2px rgba(250, 204, 21, 0.25);',
    '}',
    '.note.note-revised {',
    '  background: linear-gradient(180deg, #dbeafe 0%, #93c5fd 100%);',
    '  border: 1px solid rgba(30, 64, 175, 0.45);',
    '  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 0 0 2px rgba(59, 130, 246, 0.3);',
    '  color: #0c1e3a;',
    '}',
    '.note.note-revised .note-author { color: #1e3a8a; }',
    '.note.note-revised .note-ts { color: rgba(12, 30, 58, 0.6); }',
    '.note.note-revised .note-del { color: rgba(12, 30, 58, 0.4); }',
    '.note.note-front { z-index: 60 !important; transform: rotate(0) scale(1.04) !important; box-shadow: 0 14px 38px rgba(0, 0, 0, 0.55), 0 0 0 2px rgba(250, 204, 21, 0.4) !important; }',
    '.note-head {',
    '  display: flex; justify-content: space-between; align-items: center;',
    '  margin-bottom: 6px;',
    '}',
    '.note-author {',
    '  font-size: 0.72em; font-weight: 800;',
    '  letter-spacing: 1.2px; text-transform: uppercase;',
    '  color: rgba(26, 31, 46, 0.65);',
    '}',
    '.note.note-jules .note-author { color: #78350f; }',
    '.note-del {',
    '  background: transparent; border: none; cursor: pointer;',
    '  color: rgba(26, 31, 46, 0.4);',
    '  font-size: 1.1em; line-height: 1; font-weight: 700;',
    '  padding: 2px 6px; border-radius: 3px;',
    '  transition: background 0.12s, color 0.12s;',
    '}',
    '.note-del:hover { background: rgba(220, 38, 38, 0.18); color: #991b1b; }',
    '.note-body { white-space: pre-wrap; word-wrap: break-word; font-weight: 500; }',
    '.note-ts {',
    '  font-size: 0.7em; font-weight: 600;',
    '  color: rgba(26, 31, 46, 0.5);',
    '  margin-top: 6px;',
    '}',

    /* Sticky-note editor modal */
    '.note-editor-shroud {',
    '  position: fixed; inset: 0; z-index: 200;',
    '  background: rgba(10, 14, 26, 0.65);',
    '  backdrop-filter: blur(6px);',
    '  display: flex; align-items: center; justify-content: center;',
    '  padding: 24px;',
    '  font-family: "Inter", system-ui, sans-serif;',
    '}',
    '.note-editor {',
    '  background: linear-gradient(180deg, #fef9c3 0%, #fde68a 100%);',
    '  color: #1a1f2e;',
    '  padding: 22px;',
    '  border-radius: 8px;',
    '  border: 1px solid rgba(146, 64, 14, 0.4);',
    '  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);',
    '  width: 100%; max-width: 480px;',
    '}',
    '.note-editor h4 {',
    '  font-size: 0.78em; font-weight: 800; letter-spacing: 1.5px;',
    '  text-transform: uppercase;',
    '  color: rgba(26, 31, 46, 0.7);',
    '  margin: 0 0 12px;',
    '}',
    '.note-editor textarea {',
    '  width: 100%; min-height: 140px;',
    '  background: rgba(255, 255, 255, 0.7);',
    '  border: 1px solid rgba(146, 64, 14, 0.25);',
    '  border-radius: 4px;',
    '  padding: 12px;',
    '  font-family: inherit; font-size: 0.95em;',
    '  color: #1a1f2e;',
    '  resize: vertical;',
    '  outline: none;',
    '}',
    '.note-editor textarea:focus { border-color: rgba(146, 64, 14, 0.6); background: #fff; }',
    '.note-editor-actions {',
    '  display: flex; justify-content: flex-end; gap: 10px;',
    '  margin-top: 14px;',
    '}',
    '.note-editor-actions button {',
    '  padding: 9px 18px; border-radius: 6px;',
    '  font-family: inherit; font-size: 0.88em; font-weight: 700;',
    '  cursor: pointer;',
    '  border: 1px solid transparent;',
    '  transition: background 0.12s, transform 0.12s;',
    '}',
    '.note-editor-actions .cancel {',
    '  background: rgba(26, 31, 46, 0.1); color: #1a1f2e;',
    '  border-color: rgba(26, 31, 46, 0.2);',
    '}',
    '.note-editor-actions .cancel:hover { background: rgba(26, 31, 46, 0.18); }',
    '.note-editor-actions .save {',
    '  background: #0e1a35; color: #fde047;',
    '}',
    '.note-editor-actions .save:hover { background: #1a2950; transform: translateY(-1px); }',
    '.note-editor-actions .save:disabled { background: rgba(14, 26, 53, 0.3); color: rgba(253, 224, 71, 0.4); cursor: not-allowed; transform: none; }',

    /* Adjust slide content padding to avoid colliding with notes */
    '.slide .slide-inner { padding-left: 0; }',
    'body.present-mode .slide .slide-inner { padding-left: 0; }',

    /* Fullscreen — hide nav chrome but KEEP sticky notes (they are the point of review mode). Esc exits via browser default. */
    ':fullscreen .present-ui, :fullscreen .present-progress, :fullscreen .present-hint { display: none !important; }',
    ':-webkit-full-screen .present-ui, :-webkit-full-screen .present-progress, :-webkit-full-screen .present-hint { display: none !important; }',
    ':-moz-full-screen .present-ui, :-moz-full-screen .present-progress, :-moz-full-screen .present-hint { display: none !important; }',
    ':-ms-fullscreen .present-ui, :-ms-fullscreen .present-progress, :-ms-fullscreen .present-hint { display: none !important; }',
    'body.is-fullscreen .present-ui, body.is-fullscreen .present-progress, body.is-fullscreen .present-hint { display: none !important; }',
    'body.is-fullscreen .topbar { display: none !important; }',

    /* Mobile */
    '@media (max-width: 880px) {',
    '  .note-stack { position: static; max-width: 100%; width: 100%; margin: 14px 0 18px; }',
    '}',
    '@media (max-width: 720px) {',
    '  .present-ui { bottom: 14px; padding: 6px 8px; gap: 4px; }',
    '  .present-btn { width: 34px; height: 34px; font-size: 1.1em; }',
    '  .present-counter { padding: 0 8px; min-width: 50px; font-size: 0.78em; }',
    '  .present-hint { display: none; }',
    '  body.present-mode .slide { padding: 32px 18px; }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  body.present-mode .slide { transition: opacity 0.15s; transform: none !important; }',
    '  .present-progress-bar { transition: width 0.15s; }',
    '  .note { transform: none !important; }',
    '}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  /* ────────────────────────────────────────────────────────────────
   *  STICKY-NOTE STATE
   * ──────────────────────────────────────────────────────────────── */

  var DECK_ID = location.pathname
    .replace(/^.*\//, '')
    .replace(/\.html$/i, '') || 'index';
  var STORAGE_KEY = 'ryujin-deck-notes:' + DECK_ID;

  /* ── SERVER SYNC (optional) ──
     Notes are localStorage-first. When a portal session token is present
     (an admin viewing the deck from inside Ryujin), notes also sync to
     /api/deck-notes so they persist across devices and can be read back by
     the working session. Without a token every function below no-ops, so the
     deck stays localStorage-only and still opens standalone for review.
     Jewels-seeded notes are not synced (they are re-seeded from code each load). */
  var AUTH_TOKEN = (function () {
    try { return localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token') || null; }
    catch (e) { return null; }
  })();

  function syncHeaders(extra) {
    var h = extra || {};
    if (AUTH_TOKEN) h['Authorization'] = 'Bearer ' + AUTH_TOKEN;
    return h;
  }

  function serverUpsertNote(slideId, note) {
    if (!AUTH_TOKEN || !note || note.author === 'jules') return;
    fetch('/api/deck-notes', {
      method: 'POST',
      headers: syncHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        deck_id: DECK_ID, slide_id: slideId,
        client_note_id: note.id, author: note.author || 'mac', text: note.text
      })
    }).catch(function () {});
  }

  function serverDeleteNote(noteId) {
    if (!AUTH_TOKEN || !noteId) return;
    fetch('/api/deck-notes?deck=' + encodeURIComponent(DECK_ID) + '&note=' + encodeURIComponent(noteId), {
      method: 'DELETE',
      headers: syncHeaders()
    }).catch(function () {});
  }

  /* Pull server notes into localStorage, then push any local-only notes up
     (this is what migrates notes added before sync existed). */
  function serverSyncInit() {
    if (!AUTH_TOKEN) return;
    fetch('/api/deck-notes?deck=' + encodeURIComponent(DECK_ID), { headers: syncHeaders() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        var local = loadNotes();
        var serverKeys = {};
        if (payload && Array.isArray(payload.notes)) {
          payload.notes.forEach(function (n) {
            serverKeys[n.client_note_id] = true;
            if (!local[n.slide_id]) local[n.slide_id] = [];
            var found = null;
            for (var i = 0; i < local[n.slide_id].length; i++) {
              if (local[n.slide_id][i].id === n.client_note_id) { found = local[n.slide_id][i]; break; }
            }
            if (found) {
              // Newer side wins. If the local copy is newer (e.g. an edit whose
              // POST failed while offline), keep it and re-push instead of
              // clobbering it with stale server text.
              var serverTs = Date.parse(n.updated_at) || 0;
              var localTs = found.ts || 0;
              if (serverTs >= localTs) { found.text = n.text; found.author = n.author; found.ts = serverTs || localTs; }
              else serverUpsertNote(n.slide_id, found);
            }
            else local[n.slide_id].push({ id: n.client_note_id, author: n.author, text: n.text, ts: Date.parse(n.updated_at) || Date.now() });
          });
        }
        Object.keys(local).forEach(function (slideId) {
          (local[slideId] || []).forEach(function (note) {
            if (note.author !== 'jules' && !serverKeys[note.id]) serverUpsertNote(slideId, note);
          });
        });
        saveAllNotes(local);
        refreshAllSlideNotes();
      })
      .catch(function () {});
  }

  function loadNotes() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveAllNotes(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) { /* quota or private mode */ }
  }

  function uuid() {
    return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Public: seed Jewels suggestions. Called by external script (or inline at
     bottom of this file) after subagent returns. Does not overwrite existing
     user-added notes; only adds Jewels entries that aren't already present
     (matched by stable id). */
  window.RyujinDeckSeedJewels = function (deckId, jules) {
    if (deckId !== DECK_ID) return;
    var data = loadNotes();
    Object.keys(jules || {}).forEach(function (slideId) {
      if (!data[slideId]) data[slideId] = [];
      (jules[slideId] || []).forEach(function (entry) {
        var exists = data[slideId].some(function (n) { return n.id === entry.id; });
        if (!exists) {
          data[slideId].push({
            id: entry.id,
            author: entry.author || 'jules',
            text: entry.text,
            ts: entry.ts || Date.now()
          });
        }
      });
    });
    saveAllNotes(data);
    refreshAllSlideNotes();
  };

  function slideIdFor(slide, index) {
    return slide.id || ('slide-' + (index + 1));
  }

  function authorClass(author) {
    if (author === 'jules') return ' note-jules';
    if (author === 'revised') return ' note-revised';
    return '';
  }

  function authorLabel(author) {
    if (author === 'jules') return '★ Jewels';
    if (author === 'revised') return '✎ Revised copy';
    return 'Note';
  }

  function noteCardEl(slideId, note) {
    var el = document.createElement('div');
    el.className = 'note' + authorClass(note.author);
    el.setAttribute('data-note-id', note.id);
    el.innerHTML =
      '<div class="note-head">' +
        '<span class="note-author">' + authorLabel(note.author) + '</span>' +
        '<button class="note-del" aria-label="Delete suggestion" title="Delete">×</button>' +
      '</div>' +
      '<div class="note-body">' + escapeHTML(note.text) + '</div>' +
      '<div class="note-ts">' + new Date(note.ts).toLocaleString() + '</div>';

    var delBtn = el.querySelector('.note-del');
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!confirm('Delete this suggestion?')) return;
      deleteNote(slideId, note.id);
    });

    el.addEventListener('click', function (e) {
      if (e.target.closest('.note-del')) return;
      // Bring this note to the front of its stack so it sits above siblings
      // and above slide content.
      var siblings = el.parentNode ? el.parentNode.querySelectorAll('.note') : [];
      for (var i = 0; i < siblings.length; i++) siblings[i].classList.remove('note-front');
      el.classList.add('note-front');
      openEditor(slideId, note);
    });

    return el;
  }

  function renderNotesForSlide(slide, index) {
    var slideId = slideIdFor(slide, index);

    // Remove previous toggle + stack so re-rendering is clean
    var oldToggle = slide.querySelector('.note-toggle');
    if (oldToggle) oldToggle.remove();
    var oldStack = slide.querySelector('.note-stack');
    if (oldStack) oldStack.remove();

    var data = loadNotes();
    var notes = data[slideId] || [];
    var jewelsCount = 0;
    var revisedCount = 0;
    var userCount = 0;
    notes.forEach(function (n) {
      if (n.author === 'jules') jewelsCount++;
      else if (n.author === 'revised') revisedCount++;
      else userCount++;
    });

    // Toggle button — always visible, shows counts per author type
    var toggle = document.createElement('button');
    toggle.className = 'note-toggle';
    var pills = '';
    if (jewelsCount) pills += ' <span class="count-pill" title="Jewels suggestions">' + jewelsCount + '</span>';
    if (revisedCount) pills += ' <span class="count-pill revised" title="Revised copy">' + revisedCount + '</span>';
    if (userCount) pills += ' <span class="count-pill user" title="Your notes">' + userCount + '</span>';
    toggle.innerHTML = '💬 Suggestions &amp; revised' + (pills || ' <span class="count-pill" style="opacity:0.5">0</span>');
    slide.appendChild(toggle);

    // Stack — hidden by default, opens on toggle click
    var stack = document.createElement('div');
    stack.className = 'note-stack';

    var addBtn = document.createElement('button');
    addBtn.className = 'note-add-btn';
    addBtn.innerHTML = '<span class="plus">+</span> Add suggestion';
    addBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openEditor(slideId, null);
    });
    stack.appendChild(addBtn);

    notes.forEach(function (note) {
      stack.appendChild(noteCardEl(slideId, note));
    });

    slide.appendChild(stack);

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = stack.classList.toggle('open');
      toggle.classList.toggle('open', isOpen);
    });
  }

  function refreshAllSlideNotes() {
    slides.forEach(function (slide, i) { renderNotesForSlide(slide, i); });
  }

  function saveNote(slideId, note) {
    var data = loadNotes();
    if (!data[slideId]) data[slideId] = [];
    var idx = -1;
    for (var i = 0; i < data[slideId].length; i++) {
      if (data[slideId][i].id === note.id) { idx = i; break; }
    }
    if (idx >= 0) data[slideId][idx] = note;
    else data[slideId].push(note);
    saveAllNotes(data);
    refreshAllSlideNotes();
    serverUpsertNote(slideId, note);
  }

  function deleteNote(slideId, noteId) {
    var data = loadNotes();
    if (!data[slideId]) return;
    data[slideId] = data[slideId].filter(function (n) { return n.id !== noteId; });
    saveAllNotes(data);
    refreshAllSlideNotes();
    serverDeleteNote(noteId);
  }

  /* Modal editor */
  var openShroud = null;
  function closeEditor() {
    if (openShroud && openShroud.parentNode) openShroud.parentNode.removeChild(openShroud);
    openShroud = null;
  }

  function openEditor(slideId, existingNote) {
    closeEditor();
    var shroud = document.createElement('div');
    shroud.className = 'note-editor-shroud';
    var heading = existingNote ? 'Edit suggestion' : 'Add a suggestion';
    var initial = existingNote ? existingNote.text : '';
    var authorLabel = (existingNote && existingNote.author === 'jules') ? 'Jewels' : 'Note';
    shroud.innerHTML =
      '<div class="note-editor">' +
        '<h4>' + escapeHTML(authorLabel) + ' · ' + escapeHTML(heading) + '</h4>' +
        '<textarea placeholder="Type your suggestion. Markdown not rendered. Hit Cmd/Ctrl-Enter to save."></textarea>' +
        '<div class="note-editor-actions">' +
          '<button class="cancel">Cancel</button>' +
          '<button class="save" disabled>Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(shroud);
    openShroud = shroud;

    var ta = shroud.querySelector('textarea');
    var saveBtn = shroud.querySelector('.save');
    var cancelBtn = shroud.querySelector('.cancel');
    ta.value = initial;
    saveBtn.disabled = !initial.trim();

    ta.addEventListener('input', function () {
      saveBtn.disabled = !ta.value.trim();
    });

    function commit() {
      var text = ta.value.trim();
      if (!text) return;
      var note = existingNote ? {
        id: existingNote.id,
        author: existingNote.author || 'mac',
        text: text,
        ts: Date.now()
      } : {
        id: uuid(),
        author: 'mac',
        text: text,
        ts: Date.now()
      };
      saveNote(slideId, note);
      closeEditor();
    }

    saveBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', closeEditor);
    shroud.addEventListener('click', function (e) {
      if (e.target === shroud) closeEditor();
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commit(); }
    });

    setTimeout(function () { ta.focus(); }, 50);
  }

  refreshAllSlideNotes();
  serverSyncInit();

  /* ────────────────────────────────────────────────────────────────
   *  PRESENTATION UI + NAV
   * ──────────────────────────────────────────────────────────────── */

  var ui = document.createElement('div');
  ui.className = 'present-ui';
  ui.innerHTML =
    '<button class="present-btn prev" aria-label="Previous slide" title="Previous (←)">‹</button>' +
    '<div class="present-counter"><span class="curr">1</span> / <span class="total">' + slides.length + '</span></div>' +
    '<button class="present-btn next" aria-label="Next slide" title="Next (→ or Space)">›</button>' +
    '<button class="present-btn icon toggle" aria-label="Toggle scroll mode" title="Toggle scroll mode (S)">⇅</button>' +
    '<button class="present-btn icon fs" aria-label="Fullscreen" title="Fullscreen (F)">⛶</button>';

  var progress = document.createElement('div');
  progress.className = 'present-progress';
  progress.innerHTML = '<div class="present-progress-bar"></div>';

  var hint = document.createElement('div');
  hint.className = 'present-hint';
  hint.innerHTML = 'Use <kbd>←</kbd> <kbd>→</kbd> · <kbd>N</kbd> to add a note · <kbd>S</kbd> for scroll mode · <kbd>F</kbd> for fullscreen';

  document.body.appendChild(progress);
  document.body.appendChild(ui);
  document.body.appendChild(hint);
  setTimeout(function () { hint.classList.add('fade'); }, 5500);
  setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 6500);

  var currentIndex = 0;
  var isPresent = true;
  document.body.classList.add('present-mode');

  var counter = ui.querySelector('.curr');
  var bar = progress.querySelector('.present-progress-bar');

  function clamp(i) { return Math.max(0, Math.min(slides.length - 1, i)); }

  function render() {
    for (var i = 0; i < slides.length; i++) {
      slides[i].classList.remove('present-active', 'present-prev', 'present-next');
      if (i === currentIndex) slides[i].classList.add('present-active');
      else if (i < currentIndex) slides[i].classList.add('present-prev');
      else slides[i].classList.add('present-next');
    }
    counter.textContent = (currentIndex + 1);
    bar.style.width = ((currentIndex + 1) / slides.length * 100) + '%';
    if (history.replaceState) {
      history.replaceState(null, '', '#slide-' + (currentIndex + 1));
    }
  }

  function go(i) {
    currentIndex = clamp(i);
    if (isPresent && slides[currentIndex]) {
      slides[currentIndex].scrollTop = 0;
    }
    render();
  }

  function next() { go(currentIndex + 1); }
  function prev() { go(currentIndex - 1); }

  function setMode(present) {
    isPresent = present;
    document.body.classList.toggle('present-mode', present);
    progress.style.display = present ? 'block' : 'none';
    ui.style.display = present ? 'flex' : 'none';
    if (present) {
      go(currentIndex);
    } else {
      slides.forEach(function (s) {
        s.classList.remove('present-active', 'present-prev', 'present-next');
      });
      if (slides[currentIndex]) {
        slides[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function toggleMode() { setMode(!isPresent); }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || document.mozFullScreenElement);
  }

  function toggleFullscreen() {
    var doc = document;
    if (isFullscreen()) {
      var exitFn = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen || doc.mozCancelFullScreen;
      if (!exitFn) {
        console.warn('[presentation] no exitFullscreen API available');
        return;
      }
      try {
        var rOut = exitFn.call(doc);
        if (rOut && rOut.then) rOut.then(
          function () { console.log('[presentation] exited fullscreen'); },
          function (err) { console.warn('[presentation] exit fullscreen rejected:', err); }
        );
      } catch (err) {
        console.warn('[presentation] exitFullscreen threw:', err);
      }
      return;
    }
    /* Enter fullscreen — try a few targets in order until one resolves. */
    var targets = [doc.documentElement, doc.body];
    var tried = 0;
    function tryNext() {
      if (tried >= targets.length) {
        console.warn('[presentation] requestFullscreen failed on all targets (iframe sandbox? user-activation expired? browser blocked?)');
        return;
      }
      var el = targets[tried++];
      var reqFn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || el.mozRequestFullScreen;
      if (!reqFn) {
        console.warn('[presentation] no requestFullscreen on target', el.tagName);
        tryNext();
        return;
      }
      try {
        /* Call without options first — some browsers reject the options arg. */
        var r = reqFn.call(el);
        if (r && r.then) {
          r.then(
            function () { console.log('[presentation] entered fullscreen via', el.tagName); },
            function (err) {
              console.warn('[presentation] requestFullscreen rejected on', el.tagName, '—', err && err.message);
              tryNext();
            }
          );
        } else {
          console.log('[presentation] requestFullscreen returned non-promise on', el.tagName, '— assumed OK');
        }
      } catch (err) {
        console.warn('[presentation] requestFullscreen threw on', el.tagName, '—', err && err.message);
        tryNext();
      }
    }
    tryNext();
  }

  function syncFullscreenClass() {
    document.body.classList.toggle('is-fullscreen', isFullscreen());
  }
  document.addEventListener('fullscreenchange', syncFullscreenClass);
  document.addEventListener('webkitfullscreenchange', syncFullscreenClass);
  document.addEventListener('mozfullscreenchange', syncFullscreenClass);
  document.addEventListener('MSFullscreenChange', syncFullscreenClass);

  ui.querySelector('.prev').addEventListener('click', prev);
  ui.querySelector('.next').addEventListener('click', next);
  ui.querySelector('.toggle').addEventListener('click', toggleMode);
  ui.querySelector('.fs').addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', function (e) {
    if (openShroud) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { e.preventDefault(); next(); return; }
    if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prev(); return; }
    if (k === 'Home') { e.preventDefault(); go(0); return; }
    if (k === 'End') { e.preventDefault(); go(slides.length - 1); return; }
    if (k === 'Escape') {
      // If fullscreen is active, let the browser handle Esc natively (exits fullscreen).
      // Otherwise toggle scroll mode.
      if (isFullscreen()) return;
      e.preventDefault();
      toggleMode();
      return;
    }
    if (k === 's' || k === 'S') { e.preventDefault(); toggleMode(); return; }
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); return; }
    if (k === 'n' || k === 'N') {
      e.preventDefault();
      var sId = slideIdFor(slides[currentIndex], currentIndex);
      openEditor(sId, null);
      return;
    }
  });

  document.addEventListener('click', function (e) {
    if (!isPresent) return;
    if (openShroud) return;
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest('.present-ui, .nav-dots, .note-toggle, .note-stack, .note, .note-editor-shroud, a, button, input, textarea, code')) return;
    var x = e.clientX;
    var w = window.innerWidth;
    if (x > w * 0.78) next();
    else if (x < w * 0.22) prev();
  });

  // Click-outside closes any open note panels
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.note-toggle, .note-stack, .note-editor-shroud')) return;
    document.querySelectorAll('.note-stack.open').forEach(function (s) {
      s.classList.remove('open');
    });
    document.querySelectorAll('.note-toggle.open').forEach(function (b) {
      b.classList.remove('open');
    });
  });

  var touchStartX = 0;
  var touchStartY = 0;
  document.addEventListener('touchstart', function (e) {
    if (!e.touches || !e.touches[0]) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!isPresent || openShroud) return;
    if (!e.changedTouches || !e.changedTouches[0]) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
    }
  }, { passive: true });

  var hashMatch = location.hash.match(/^#slide-(\d+)/);
  if (hashMatch) {
    currentIndex = clamp(parseInt(hashMatch[1], 10) - 1);
  } else {
    var anchor = location.hash && document.querySelector(location.hash);
    if (anchor && anchor.classList.contains('slide')) {
      currentIndex = slides.indexOf(anchor);
      if (currentIndex < 0) currentIndex = 0;
    }
  }
  render();
})();
