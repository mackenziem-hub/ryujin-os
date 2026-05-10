// ═══════════════════════════════════════════════════════════════
// PANEL HERO — auto-inject the per-panel hero banner above the
// .hq-header on dashboard pages. Detects panel slug from path.
// ═══════════════════════════════════════════════════════════════

(function() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const path = window.location.pathname;
    // Only fire on the panel DASHBOARD pages (e.g. /sales.html, not /sales-portal.html)
    const m = path.match(/^\/(sales|service|customer|finance|marketing|production)\.html$/);
    if (!m) return;
    const slug = m[1];

    const heroPath = `/assets/panels/${slug}-hero.png`;

    // CSS once
    if (!document.getElementById('panel-hero-css')) {
      const style = document.createElement('style');
      style.id = 'panel-hero-css';
      style.textContent = `
        .panel-hero{
          position:relative;width:100%;height:200px;
          margin:-8px 0 16px;border-radius:14px;overflow:hidden;
          background:#0a0e1a center/cover no-repeat;
          border:1px solid var(--glass-border, rgba(34,211,238,0.16));
        }
        .panel-hero::after{
          content:'';position:absolute;inset:0;
          background:linear-gradient(180deg,rgba(6,10,20,0) 40%,rgba(6,10,20,0.85) 100%),
                     linear-gradient(90deg,rgba(6,10,20,0.4) 0%,rgba(6,10,20,0) 50%);
          pointer-events:none;
        }
        .panel-hero::before{
          content:'';position:absolute;top:0;left:0;right:0;height:2px;
          background:linear-gradient(90deg,transparent,var(--cyan,#22d3ee) 30%,var(--purple,#7c3aed) 70%,transparent);
          opacity:0.7;z-index:2;
        }
        @media(max-width:768px){.panel-hero{height:140px}}
      `;
      document.head.appendChild(style);
    }

    // Probe for image presence — graceful fallback if not generated yet
    const probe = new Image();
    probe.onload = function() {
      const hero = document.createElement('div');
      hero.className = 'panel-hero';
      hero.style.backgroundImage = `url('${heroPath}')`;
      const main = document.querySelector('main.main') || document.querySelector('main');
      const header = document.querySelector('.hq-header');
      if (main && header) {
        main.insertBefore(hero, header);
      }
    };
    probe.onerror = function() { /* asset missing — silently skip */ };
    probe.src = heroPath;
  }
})();
