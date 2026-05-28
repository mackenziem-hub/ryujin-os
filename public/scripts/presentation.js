/*
 * presentation.js
 * Lightweight Gamma-style slideshow overlay for Ryujin deck pages.
 * Activates on any page containing .slide sections.
 *
 * Controls
 *   Right arrow / Space / PageDown / click right edge / swipe left  -> next
 *   Left arrow / PageUp / click left edge / swipe right             -> previous
 *   Home / End                                                       -> jump to first / last
 *   Esc                                                              -> toggle scroll mode
 *   "S" key or scroll-toggle button                                  -> toggle scroll mode
 *   F                                                                -> fullscreen
 */
(function () {
  'use strict';

  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (slides.length === 0) return;

  var STYLE = [
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
    'body.present-mode .slide.present-prev {',
    '  transform: translateX(-48px) scale(0.985);',
    '}',
    'body.present-mode .slide-num { display: none; }',
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
    '.present-ui.hidden { opacity: 0; pointer-events: none; }',
    '.present-btn {',
    '  background: rgba(255, 255, 255, 0.06);',
    '  border: 1px solid rgba(255, 255, 255, 0.12);',
    '  color: #fff; cursor: pointer;',
    '  width: 38px; height: 38px; border-radius: 50%;',
    '  font-size: 1.25em; font-weight: 700; line-height: 1;',
    '  display: flex; align-items: center; justify-content: center;',
    '  transition: background 0.15s, transform 0.15s, border-color 0.15s;',
    '  padding: 0;',
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
    '}'
  ].join('\n');

  var style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

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
  hint.innerHTML = 'Use <kbd>←</kbd> <kbd>→</kbd> or <kbd>Space</kbd> to navigate · <kbd>S</kbd> for scroll mode · <kbd>F</kbd> for fullscreen';

  document.body.appendChild(progress);
  document.body.appendChild(ui);
  document.body.appendChild(hint);
  setTimeout(function () { hint.classList.add('fade'); }, 4500);
  setTimeout(function () { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 5500);

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

  function toggleFullscreen() {
    var doc = document;
    var el = doc.documentElement;
    var isFs = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
    if (isFs) {
      (doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen).call(doc);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
    }
  }

  ui.querySelector('.prev').addEventListener('click', prev);
  ui.querySelector('.next').addEventListener('click', next);
  ui.querySelector('.toggle').addEventListener('click', toggleMode);
  ui.querySelector('.fs').addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
    var k = e.key;
    if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { e.preventDefault(); next(); return; }
    if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prev(); return; }
    if (k === 'Home') { e.preventDefault(); go(0); return; }
    if (k === 'End') { e.preventDefault(); go(slides.length - 1); return; }
    if (k === 'Escape') { e.preventDefault(); toggleMode(); return; }
    if (k === 's' || k === 'S') { e.preventDefault(); toggleMode(); return; }
    if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); return; }
  });

  document.addEventListener('click', function (e) {
    if (!isPresent) return;
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest('.present-ui, .nav-dots, a, button, input, textarea, code')) return;
    var x = e.clientX;
    var w = window.innerWidth;
    if (x > w * 0.78) next();
    else if (x < w * 0.22) prev();
  });

  var touchStartX = 0;
  var touchStartY = 0;
  document.addEventListener('touchstart', function (e) {
    if (!e.touches || !e.touches[0]) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!isPresent) return;
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
    var anchorMatch = location.hash && document.querySelector(location.hash);
    if (anchorMatch && anchorMatch.classList.contains('slide')) {
      currentIndex = slides.indexOf(anchorMatch);
      if (currentIndex < 0) currentIndex = 0;
    }
  }
  render();
})();
