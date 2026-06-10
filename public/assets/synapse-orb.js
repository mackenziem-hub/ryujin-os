// Ryujin OS — Synapse Orb
// Canvas neural-network avatar: nodes + firing connections. Replaces the
// dragon-eye orb. Zero idle cost: a single static frame is drawn when idle;
// the rAF loop only runs in 'thinking' / 'speaking' states. Reduced motion
// keeps it permanently static.
(function () {
  'use strict';

  const REDUCED = typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CYAN = [34, 211, 238];
  const VIOLET = [124, 58, 237];

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function create(host, opts) {
    opts = opts || {};
    const size = opts.size || 46;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.className = 'synapse-orb';
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const R = size / 2;
    const nodeCount = size >= 100 ? 34 : 18;

    // Nodes scattered inside the circle, each with a slow orbital drift.
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R * 0.78;
      nodes.push({
        bx: R + Math.cos(a) * r,
        by: R + Math.sin(a) * r,
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 0.8,
        amp: 1 + Math.random() * (size / 30),
        x: 0, y: 0,
      });
    }
    // Edges: connect each node to its 2 nearest neighbours.
    const edges = [];
    const seen = new Set();
    nodes.forEach((n, i) => {
      const dists = nodes.map((m, j) => ({ j, d: i === j ? Infinity : (n.bx - m.bx) ** 2 + (n.by - m.by) ** 2 }))
        .sort((a, b) => a.d - b.d).slice(0, 2);
      dists.forEach(({ j }) => {
        const key = Math.min(i, j) + '-' + Math.max(i, j);
        if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
      });
    });
    // Pulses travelling along edges while active.
    const pulses = [];

    let state = 'idle';
    let raf = 0;
    let t = 0;

    function position(time) {
      for (const n of nodes) {
        n.x = n.bx + Math.cos(time * n.sp + n.ph) * n.amp;
        n.y = n.by + Math.sin(time * n.sp * 0.8 + n.ph) * n.amp;
      }
    }

    function draw(time, active) {
      position(time);
      ctx.clearRect(0, 0, size, size);

      // Containing ring + soft core glow
      const g = ctx.createRadialGradient(R, R * 0.8, 0, R, R, R);
      g.addColorStop(0, rgba(CYAN, 0.10));
      g.addColorStop(1, 'rgba(6,12,24,0.9)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba(CYAN, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Edges
      ctx.lineWidth = Math.max(0.6, size / 90);
      for (const [a, b] of edges) {
        ctx.strokeStyle = rgba(CYAN, 0.18);
        ctx.beginPath();
        ctx.moveTo(nodes[a].x, nodes[a].y);
        ctx.lineTo(nodes[b].x, nodes[b].y);
        ctx.stroke();
      }

      // Pulses (firing synapses)
      if (active) {
        const rate = state === 'speaking' ? 0.25 : 0.1;
        if (Math.random() < rate && pulses.length < edges.length) {
          pulses.push({ e: (Math.random() * edges.length) | 0, p: 0, sp: 0.02 + Math.random() * 0.03 });
        }
        for (let i = pulses.length - 1; i >= 0; i--) {
          const pu = pulses[i];
          pu.p += pu.sp * (state === 'speaking' ? 1.6 : 1);
          if (pu.p >= 1) { pulses.splice(i, 1); continue; }
          const [a, b] = edges[pu.e];
          const x = nodes[a].x + (nodes[b].x - nodes[a].x) * pu.p;
          const y = nodes[a].y + (nodes[b].y - nodes[a].y) * pu.p;
          const col = state === 'thinking' ? VIOLET : CYAN;
          ctx.fillStyle = rgba(col, 0.9);
          ctx.beginPath(); ctx.arc(x, y, Math.max(1, size / 46), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba(col, 0.25);
          ctx.beginPath(); ctx.arc(x, y, Math.max(2, size / 20), 0, Math.PI * 2); ctx.fill();
        }
      }

      // Nodes
      const nodeR = Math.max(0.9, size / 55);
      for (const n of nodes) {
        ctx.fillStyle = rgba(CYAN, 0.85);
        ctx.beginPath(); ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2); ctx.fill();
      }
    }

    function loop() {
      t += 0.016;
      draw(t, true);
      raf = requestAnimationFrame(loop);
    }

    function setState(next) {
      if (next === state) return;
      state = next;
      cancelAnimationFrame(raf); raf = 0;
      pulses.length = 0;
      if (state !== 'idle' && !REDUCED && !document.body.classList.contains('perf-lite')) {
        raf = requestAnimationFrame(loop);
      } else {
        draw(t, false); // settle to a clean static frame
      }
    }

    draw(0, false); // initial static frame

    return {
      setState,
      destroy() { cancelAnimationFrame(raf); canvas.remove(); },
    };
  }

  window.SynapseOrb = { create };
})();
