/* Plus Ultra Roofing - scroll-driven roof completion engine (POC)
   Shared across the three hero mockups. Procedural stand-in for the real
   WebP frame sequence: a top-down roof builds tear-off -> finished as you scroll.
   Production swaps drawRoof() for ctx.drawImage(frames[i]) on the same scroll/lerp rig.
   Vanilla, no CDN, classic script so it runs from file://. */
(function () {
  'use strict';

  var RAW = window.ROOF_CONFIG || {};
  var C = {
    bg:        RAW.bg        || '#0b0c0e',
    deck:      RAW.deck      || '#c7a06a',
    deckSeam:  RAW.deckSeam  || '#9c7b4e',
    felt:      RAW.felt      || '#26262b',
    shingle:   RAW.shingle   || '#34383f',
    ridge:     RAW.ridge     || '#23262b',
    trim:      RAW.trim      || '#d8dce0',
    accent:    RAW.accent    || '#6ea8ff',
    lightMode: RAW.lightMode || 'spot',   // 'even' | 'spot' | 'warm'
    grid:      RAW.grid      || false,    // faint drafting grid behind the roof
    glow:      RAW.glow      || false,    // accent glow as the roof completes
    vignette:  RAW.vignette  !== false    // dark corners (default on)
  };

  /* ---- color helpers ---- */
  function toRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a == null ? 1 : a) + ')'; }
  function shade(rgb, amt) {
    if (amt >= 0) return [Math.round(rgb[0] + (255 - rgb[0]) * amt), Math.round(rgb[1] + (255 - rgb[1]) * amt), Math.round(rgb[2] + (255 - rgb[2]) * amt)];
    var k = 1 + amt;
    return [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)];
  }

  var col = {
    bg: toRgb(C.bg), deck: toRgb(C.deck), deckSeam: toRgb(C.deckSeam),
    felt: toRgb(C.felt), shingle: toRgb(C.shingle), ridge: toRgb(C.ridge),
    trim: toRgb(C.trim), accent: toRgb(C.accent)
  };

  /* ---- math ---- */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function remap(x, a, b) { return clamp((x - a) / (b - a), 0, 1); }
  function hash(i, j) { var n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); }

  /* ---- phases ---- */
  var PHASES = [
    { label: 'Tear-off',      caption: 'Old roof stripped back to a clean deck.' },
    { label: 'Underlayment',  caption: 'Ice and water shield seals the whole deck.' },
    { label: 'Shingles',      caption: 'Architectural shingles laid course by course.' },
    { label: 'Ridge cap',     caption: 'Ridge capped, vents set, edges locked down.' },
    { label: 'Finished',      caption: 'Done right the first time. Built to go further beyond.' }
  ];
  function phaseIndex(p) {
    if (p >= 0.9) return 4;
    if (p >= 0.76) return 3;
    if (p >= 0.30) return 2;
    if (p >= 0.10) return 1;
    return 0;
  }

  /* ---- state ---- */
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var cx = 0, cy = 0, halfW = 0, roofH = 0;
  var persTop = 0.70, persBot = 1.10;
  var target = 0, shown = -1;            // scroll progress
  var camTX = 0, camTY = 0, camX = 0, camY = 0;   // mouse parallax (target / shown)
  var reduce = false, hero = null, lastPhase = -1, running = false;

  var COURSES = 11;                       // shingle courses per slope
  var TABS = 18;                          // tabs across

  function project(u, v) {
    var s = lerp(persTop, persBot, v);
    var depth = 0.45 + 0.55 * v;          // nearer rows drift more with the mouse
    return [
      cx + u * halfW * s + camX * depth,
      cy + (v - 0.5) * roofH + camY
    ];
  }
  function quad(pts, style) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = style; ctx.fill();
  }
  function band(v0, v1) { return [project(-1, v0), project(1, v0), project(1, v1), project(-1, v1)]; }

  function layout() {
    var r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    halfW = Math.min(W * 0.36, 510);
    roofH = Math.min(H * 0.56, 620);
    cx = W * 0.5;
    cy = H * 0.55;
  }

  /* ---- scene pieces ---- */
  function bgFill() { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); }

  function draftingGrid() {
    if (!C.grid) return;
    ctx.save();
    ctx.strokeStyle = rgba(col.accent, 0.06);
    ctx.lineWidth = 1;
    var step = 46;
    for (var x = (cx % step); x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = (cy % step); y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.restore();
  }

  function contactShadow() {
    var c = project(0, 1.02);
    var rx = halfW * persBot * 1.05, ry = roofH * 0.10;
    var g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], rx);
    g.addColorStop(0, rgba(shade(col.bg, -0.6), 0.55));
    g.addColorStop(1, rgba(shade(col.bg, -0.6), 0));
    ctx.save();
    ctx.translate(c[0], c[1]); ctx.scale(1, ry / rx);
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
  }

  function deck() {
    quad(band(0, 1), C.deck);
    // sheathing seams (4ft x 8ft sheet feel)
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(col.deckSeam, 0.85);
    var rows = 6, colsN = 6, i;
    for (i = 1; i < rows; i++) {
      var v = i / rows, a = project(-1, v), b = project(1, v);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (i = 1; i < colsN; i++) {
      var u = -1 + 2 * i / colsN, t = project(u, 0), bm = project(u, 1);
      ctx.beginPath(); ctx.moveTo(t[0], t[1]); ctx.lineTo(bm[0], bm[1]); ctx.stroke();
    }
    // grain speckle
    ctx.fillStyle = rgba(shade(col.deck, -0.18), 0.5);
    for (i = 0; i < 240; i++) {
      var hu = hash(i, 3) * 2 - 1, hv = hash(i, 7), pt = project(hu, hv);
      ctx.fillRect(pt[0], pt[1], 1.5, 1.5);
    }
  }

  function feltSlope(v0, v1) {
    quad(band(v0, v1), C.felt);
    ctx.strokeStyle = rgba(shade(col.felt, 0.22), 0.7);
    ctx.lineWidth = 1;
    var rolls = 4;
    for (var i = 1; i < rolls; i++) {
      var v = lerp(v0, v1, i / rolls), a = project(-1, v), b = project(1, v);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }
  function felt(cov) {
    if (cov <= 0) return;
    feltSlope(0, 0.5 * cov);            // top slope, eave -> ridge
    feltSlope(1 - 0.5 * cov, 1);        // bottom slope, eave -> ridge
  }

  function courseTabs(v0, v1, k, slope) {
    var tabW = 2 / TABS;
    var off = (k % 2) * tabW * 0.5;
    var base = col.shingle;
    for (var t = -1; t < TABS + 1; t++) {
      var u0 = clamp(-1 + t * tabW + off, -1, 1);
      var u1 = clamp(u0 + tabW * 0.92, -1, 1);
      if (u1 <= u0) continue;
      var d = (hash(k * 13 + t, slope * 5 + 1) - 0.5) * 0.14;
      quad([project(u0, v0), project(u1, v0), project(u1, v1), project(u0, v1)], rgba(shade(base, d), 1));
    }
    // shadow line on the eave-facing edge for depth
    var sv = slope === 0 ? v1 : v0;
    var a = project(-1, sv), b = project(1, sv);
    ctx.strokeStyle = rgba(shade(base, -0.5), 0.55); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    // top highlight
    var hv = slope === 0 ? v0 : v1, ha = project(-1, hv), hb = project(1, hv);
    ctx.strokeStyle = rgba(shade(base, 0.22), 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ha[0], ha[1]); ctx.lineTo(hb[0], hb[1]); ctx.stroke();
  }
  function shingles(cov) {
    if (cov <= 0) return;
    var cV = 0.5 / COURSES, k, limit = 0.5 * cov;
    for (k = 0; k < COURSES; k++) {                     // top slope eave(0) -> ridge(0.5)
      var a0 = k * cV; if (a0 >= limit) break;
      courseTabs(a0, Math.min((k + 1) * cV, limit), k, 0);
    }
    for (k = 0; k < COURSES; k++) {                     // bottom slope eave(1) -> ridge(0.5)
      var b1 = 1 - k * cV; if (b1 <= 1 - limit) break;
      courseTabs(Math.max(1 - (k + 1) * cV, 1 - limit), b1, k, 1);
    }
  }

  function ridgeCap(cov) {
    if (cov <= 0) return;
    var h = 0.018, segs = 26, ext = cov;
    for (var i = 0; i < segs; i++) {
      var u0 = -ext + (2 * ext) * (i / segs);
      var u1 = -ext + (2 * ext) * ((i + 1) / segs);
      var d = (hash(i, 99) - 0.5) * 0.12;
      quad([project(u0, 0.5 - h), project(u1, 0.5 - h), project(u1, 0.5 + h), project(u0, 0.5 + h)], rgba(shade(col.ridge, d), 1));
    }
    var a = project(-ext, 0.5), b = project(ext, 0.5);
    ctx.strokeStyle = rgba(shade(col.ridge, -0.4), 0.5); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }

  function dripEdge() {
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(col.trim, 0.9);
    var edges = [[[-1, 0], [1, 0]], [[-1, 1], [1, 1]], [[-1, 0], [-1, 1]], [[1, 0], [1, 1]]];
    for (var e = 0; e < edges.length; e++) {
      var a = project(edges[e][0][0], edges[e][0][1]), b = project(edges[e][1][0], edges[e][1][1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
  }

  function vents(amt) {
    if (amt <= 0) return;
    ctx.save(); ctx.globalAlpha = amt;
    var spots = [[0.32, 0.72], [-0.4, 0.66], [0.05, 0.6]];
    for (var i = 0; i < spots.length; i++) {
      var p = project(spots[i][0], spots[i][1]);
      var s = lerp(persTop, persBot, spots[i][1]) * 14;
      ctx.fillStyle = rgba(shade(col.ridge, -0.35), 1);
      ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s * 0.7);
      ctx.fillStyle = rgba(col.trim, 0.35);
      ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, 1.5);
    }
    ctx.restore();
  }

  function lighting(p, finishAmt) {
    if (C.glow && finishAmt > 0) {
      var c = project(0, 0.5);
      var g0 = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], halfW * 1.6);
      g0.addColorStop(0, rgba(col.accent, 0.16 * finishAmt));
      g0.addColorStop(1, rgba(col.accent, 0));
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (C.lightMode === 'spot') {
      var s = ctx.createRadialGradient(cx, cy - roofH * 0.25, 40, cx, cy, Math.max(W, H) * 0.62);
      s.addColorStop(0, rgba([255, 255, 255], 0.10));
      s.addColorStop(0.5, rgba([255, 255, 255], 0));
      ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
    } else if (C.lightMode === 'warm') {
      var wg = ctx.createLinearGradient(0, 0, W, H);
      wg.addColorStop(0, rgba([255, 224, 178], 0.10));
      wg.addColorStop(0.5, rgba([255, 224, 178], 0));
      wg.addColorStop(1, rgba(shade(col.bg, -0.5), 0.18));
      ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
    } else {
      var eg = ctx.createLinearGradient(0, 0, 0, H);
      eg.addColorStop(0, rgba([255, 255, 255], 0.05));
      eg.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    }
    if (C.vignette) {
      var v = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
      v.addColorStop(0, rgba(shade(col.bg, -0.6), 0));
      v.addColorStop(1, rgba(shade(col.bg, -0.6), C.lightMode === 'even' ? 0.18 : 0.5));
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  }

  function drawRoof(p) {
    var feltCov = remap(p, 0.10, 0.32);
    var shCov = remap(p, 0.30, 0.76);
    var ridgeCov = remap(p, 0.76, 0.9);
    var finishAmt = remap(p, 0.88, 1);
    bgFill();
    draftingGrid();
    contactShadow();
    deck();
    felt(feltCov);
    shingles(shCov);
    ridgeCap(ridgeCov);
    dripEdge();
    vents(finishAmt);
    lighting(p, finishAmt);
  }

  /* ---- DOM sync ---- */
  function syncDom(p) {
    document.documentElement.style.setProperty('--roof-progress', p.toFixed(4));
    var idx = phaseIndex(p);
    if (idx !== lastPhase) {
      lastPhase = idx;
      var steps = document.querySelectorAll('[data-phase]');
      for (var i = 0; i < steps.length; i++) {
        var si = parseInt(steps[i].getAttribute('data-phase'), 10);
        steps[i].classList.toggle('is-active', si === idx);
        steps[i].classList.toggle('is-done', si < idx);
      }
      var cap = document.querySelector('[data-roof-caption]');
      if (cap) cap.textContent = PHASES[idx].caption;
    }
    var cue = document.querySelector('[data-roof-cue]');
    if (cue) cue.classList.toggle('is-hidden', p > 0.04);
  }

  function readScroll() {
    if (!hero) return 0;
    var total = hero.offsetHeight - window.innerHeight;
    if (total <= 0) return 0;
    return clamp(-hero.getBoundingClientRect().top, 0, total) / total;
  }

  function frame() {
    target = readScroll();
    var k = reduce ? 1 : 0.10;
    shown += (target - shown) * k;
    if (Math.abs(target - shown) < 0.0004) shown = target;
    camX += (camTX - camX) * (reduce ? 1 : 0.08);
    camY += (camTY - camY) * (reduce ? 1 : 0.08);
    drawRoof(shown);
    syncDom(shown);
    if (running) requestAnimationFrame(frame);
  }

  /* ---- mouse parallax + magnetic ---- */
  function bindPointer() {
    if (reduce) return;
    window.addEventListener('pointermove', function (e) {
      var nx = (e.clientX / window.innerWidth) * 2 - 1;
      var ny = (e.clientY / window.innerHeight) * 2 - 1;
      camTX = nx * 30; camTY = ny * 18;
      magnet(e);
    }, { passive: true });
    window.addEventListener('pointerleave', function () { camTX = 0; camTY = 0; });
  }
  var mags = [];
  function bindMagnetic() {
    if (reduce) return;
    mags = [].slice.call(document.querySelectorAll('[data-magnetic]'));
    mags.forEach(function (el) {
      el.addEventListener('pointerleave', function () {
        el.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
        el.style.transform = 'translate(0,0)';
      });
      el.addEventListener('pointerenter', function () { el.style.transition = 'transform 0.1s ease-out'; });
    });
  }
  function magnet(e) {
    for (var i = 0; i < mags.length; i++) {
      var el = mags[i], r = el.getBoundingClientRect();
      var ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      var dx = e.clientX - ex, dy = e.clientY - ey;
      var dist = Math.hypot(dx, dy), reach = Math.max(r.width, r.height) * 1.4 + 60;
      if (dist < reach) el.style.transform = 'translate(' + dx * 0.32 + 'px,' + dy * 0.32 + 'px)';
    }
  }

  /* ---- boot ---- */
  function init() {
    canvas = document.getElementById('roof-canvas');
    hero = document.querySelector('[data-roof-hero]') || document.querySelector('.hero');
    if (!canvas || !hero) return;
    ctx = canvas.getContext('2d');
    reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    layout();
    shown = readScroll();
    var ro;
    window.addEventListener('resize', function () { clearTimeout(ro); ro = setTimeout(function () { layout(); drawRoof(shown); }, 120); });
    bindPointer();
    bindMagnetic();
    running = true;
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
