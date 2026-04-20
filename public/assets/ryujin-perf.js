// ── Ryujin perf kit ──
// Detects low-perf devices + lets users force lite mode via ?perf=lite
// Sets <html class="perf-lite"> which the companion CSS uses to kill
// backdrop-filter, infinite animations, and video autoplay across pages.
(function(){
  const url = new URLSearchParams(location.search);
  const LS = 'ry_perf_lite';

  // URL overrides persist
  if (url.has('perf')) {
    if (url.get('perf') === 'lite') localStorage.setItem(LS, '1');
    else localStorage.removeItem(LS);
  }
  const forced = localStorage.getItem(LS) === '1';

  // Auto-detect signals that consistently cause jank:
  // - prefers-reduced-motion
  // - Save-Data / effective 2g
  // - Low-end: deviceMemory < 4, hardwareConcurrency <= 2
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '');
  const lowEnd = (navigator.deviceMemory && navigator.deviceMemory < 4) ||
                 (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);

  const lite = forced || reducedMotion || saveData || lowEnd;
  if (lite) document.documentElement.classList.add('perf-lite');

  // FPS sampler — if we drop below 25fps sustained, flip to lite automatically
  // Only runs for ~3s on load so it doesn't itself cost perf.
  if (!lite) {
    let frames = 0, start = performance.now();
    const sample = (t) => {
      frames++;
      if (t - start < 3000) { requestAnimationFrame(sample); return; }
      const fps = (frames / ((t - start) / 1000));
      if (fps < 25) {
        document.documentElement.classList.add('perf-lite');
        localStorage.setItem(LS, '1');
      }
    };
    requestAnimationFrame(sample);
  }

  // Under lite mode: once the DOM is ready, yank src from every autoplay video
  // so the browser doesn't burn bandwidth on bg videos the user can't see.
  function stripMediaSrc(){
    if (!document.documentElement.classList.contains('perf-lite')) return;
    document.querySelectorAll('video[autoplay], video[preload]').forEach(v => {
      try { v.pause(); v.removeAttribute('autoplay'); } catch(e){}
      // Keep dataset.src as a restore hint, but clear the live src(s)
      if (v.src && !v.dataset.origSrc) v.dataset.origSrc = v.src;
      v.querySelectorAll('source').forEach(s => {
        if (s.src && !s.dataset.origSrc) s.dataset.origSrc = s.src;
        s.removeAttribute('src');
      });
      v.removeAttribute('src');
      try { v.load(); } catch(e){}
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stripMediaSrc);
  else stripMediaSrc();

  // Expose a toggle + a query for pages that want to branch behavior
  window.RyujinPerf = {
    isLite: () => document.documentElement.classList.contains('perf-lite'),
    toggle: () => {
      if (localStorage.getItem(LS) === '1') { localStorage.removeItem(LS); document.documentElement.classList.remove('perf-lite'); }
      else { localStorage.setItem(LS, '1'); document.documentElement.classList.add('perf-lite'); }
      return document.documentElement.classList.contains('perf-lite');
    }
  };
})();
