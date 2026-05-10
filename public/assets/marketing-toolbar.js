// ═══════════════════════════════════════════════════════════════
// MARKETING TOOLBAR — single source of truth for the cross-tools nav
// strip. Every marketing-* page loads this; it self-injects below the
// .hq-header and auto-highlights the active page.
//
// Usage:
//   <script src="/assets/marketing-toolbar.js" defer></script>
// ═══════════════════════════════════════════════════════════════

(function() {
  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    const TOOLS = [
      { slug: '',                  href: '/marketing.html',                  label: 'Overview' },
      { slug: 'brands',            href: '/marketing-brands.html',           label: 'Brands' },
      { slug: 'creatives',         href: '/marketing-creatives.html',        label: 'Creatives' },
      { slug: 'schedule',          href: '/marketing-schedule.html',         label: 'Schedule' },
      { slug: 'content-calendar',  href: '/marketing-content-calendar.html', label: 'Calendar' },
      { slug: 'capture',           href: '/marketing-capture.html',          label: 'Capture' },
      { slug: 'leads',             href: '/marketing-leads.html',            label: 'Leads' },
      { slug: 'ads',               href: '/marketing-ads.html',              label: 'Ads' },
      { slug: 'campaign',          href: '/marketing-campaign.html',         label: 'Campaigns' },
      { slug: 'strategy',          href: '/marketing-strategy.html',         label: 'Strategy' },
      { slug: 'admin',             href: '/marketing-admin.html',            label: 'Admin' },
      { slug: 'advanced',          href: '/marketing-advanced.html',         label: 'Advanced' }
    ];

    // Detect active page from path
    const path = window.location.pathname;
    let activeSlug = '';
    if (path === '/marketing.html' || path === '/marketing') {
      activeSlug = '';
    } else {
      const m = path.match(/marketing-([a-z-]+)\.html/);
      if (m) activeSlug = m[1];
    }

    // Inject CSS once
    if (!document.getElementById('mkt-toolbar-css')) {
      const style = document.createElement('style');
      style.id = 'mkt-toolbar-css';
      style.textContent = `
        /* Cross-page polish — focus rings, smooth scroll, link consistency */
        html{scroll-behavior:smooth}
        a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
          outline:2px solid var(--cyan,#22d3ee);outline-offset:2px;border-radius:6px;
        }
        .mkt-toolbar{
          background:rgba(8,12,24,0.6);border:1px solid var(--glass-border, rgba(34,211,238,0.16));
          border-radius:12px;padding:6px;margin-bottom:14px;
          display:flex;flex-wrap:wrap;gap:4px;position:relative;overflow:hidden;
          backdrop-filter:blur(8px);
        }
        .mkt-toolbar::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,var(--cyan,#22d3ee) 50%,transparent);
          opacity:0.4;
        }
        .mkt-tab{
          padding:6px 12px;border-radius:8px;cursor:pointer;text-decoration:none;
          font-family:'Orbitron',monospace;font-size:0.65em;letter-spacing:1.4px;
          text-transform:uppercase;color:var(--text-dim, rgba(160,190,230,0.55));
          font-weight:600;transition:all 0.18s;border:1px solid transparent;
          white-space:nowrap;
        }
        .mkt-tab:hover{
          color:var(--text,#d0daf0);background:rgba(34,211,238,0.06);
          border-color:rgba(34,211,238,0.15);
        }
        .mkt-tab.active{
          color:var(--cyan,#22d3ee);
          background:linear-gradient(135deg,rgba(34,211,238,0.14),rgba(124,58,237,0.08));
          border-color:rgba(34,211,238,0.4);
          box-shadow:0 0 8px rgba(34,211,238,0.2);
        }
        .mkt-tab.active::before{content:'· ';color:var(--cyan,#22d3ee)}
        @media(max-width:600px){
          .mkt-toolbar{padding:4px;gap:3px}
          .mkt-tab{padding:5px 9px;font-size:0.6em;letter-spacing:1.2px}
        }
      `;
      document.head.appendChild(style);
    }

    // Build the toolbar
    const toolbar = document.createElement('nav');
    toolbar.className = 'mkt-toolbar';
    toolbar.setAttribute('aria-label', 'Marketing tools');
    toolbar.innerHTML = TOOLS.map(t => `
      <a class="mkt-tab ${t.slug === activeSlug ? 'active' : ''}" href="${t.href}">${t.label}</a>
    `).join('');

    // Insert below the .hq-header — fall back to top of <main> if not found
    const header = document.querySelector('.hq-header');
    if (header && header.parentNode) {
      // Insert AFTER the banner-slot if it exists, otherwise after the header
      const bannerSlot = document.getElementById('banner-slot');
      const anchor = bannerSlot || header;
      if (anchor.nextSibling) anchor.parentNode.insertBefore(toolbar, anchor.nextSibling);
      else anchor.parentNode.appendChild(toolbar);
    } else {
      const main = document.querySelector('main') || document.body;
      main.insertBefore(toolbar, main.firstChild);
    }
  }
})();
