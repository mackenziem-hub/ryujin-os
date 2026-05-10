// ═══════════════════════════════════════════════════════════════
// PRODUCTION TOOLBAR — cross-tools nav strip + a11y polish for production-* pages.
// Parallel to /assets/marketing-toolbar.js.
// ═══════════════════════════════════════════════════════════════

(function() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function init() {
    const TOOLS = [
      { slug: '',            href: '/production.html',              label: 'Overview' },
      { slug: 'workorders',  href: '/production-workorders.html',   label: 'Workorders' },
      { slug: 'paysheet',    href: '/production-paysheet.html',     label: 'Paysheets' },
      { slug: 'jobs',        href: '/production-jobs.html',         label: 'Jobs' },
      { slug: 'materials',   href: '/production-materials.html',    label: 'Materials' },
      { slug: 'calendar',    href: '/production-calendar.html',     label: 'Calendar' },
      { slug: 'schedule',    href: '/production-schedule.html',     label: 'Schedule' },
      { slug: 'tickets',     href: '/production-tickets.html',      label: 'Tickets' },
      { slug: 'admin',       href: '/production-admin.html',        label: 'Admin' },
      { slug: 'advanced',    href: '/production-advanced.html',     label: 'Advanced' },
      { slug: 'post',        href: '/post-production.html',         label: 'Post-Prod' }
    ];

    const path = window.location.pathname;
    let activeSlug = '';
    if (path === '/production.html' || path === '/production') {
      activeSlug = '';
    } else if (path.startsWith('/post-production')) {
      activeSlug = 'post';
    } else {
      const m = path.match(/production-([a-z-]+)\.html/);
      if (m) activeSlug = m[1];
    }

    if (!document.getElementById('prod-toolbar-css')) {
      const style = document.createElement('style');
      style.id = 'prod-toolbar-css';
      style.textContent = `
        html{scroll-behavior:smooth}
        a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
          outline:2px solid var(--cyan,#22d3ee);outline-offset:2px;border-radius:6px;
        }
        .prod-toolbar{
          background:rgba(8,12,24,0.6);border:1px solid var(--glass-border, rgba(34,211,238,0.16));
          border-radius:12px;padding:6px;margin-bottom:14px;
          display:flex;flex-wrap:wrap;gap:4px;position:relative;overflow:hidden;
          backdrop-filter:blur(8px);
        }
        .prod-toolbar::before{
          content:'';position:absolute;top:0;left:0;right:0;height:1px;
          background:linear-gradient(90deg,transparent,var(--cyan,#22d3ee) 50%,transparent);opacity:0.4;
        }
        .prod-tab{
          padding:6px 12px;border-radius:8px;cursor:pointer;text-decoration:none;
          font-family:'Orbitron',monospace;font-size:0.65em;letter-spacing:1.4px;
          text-transform:uppercase;color:var(--text-dim, rgba(160,190,230,0.55));
          font-weight:600;transition:all 0.18s;border:1px solid transparent;white-space:nowrap;
        }
        .prod-tab:hover{color:var(--text,#d0daf0);background:rgba(34,211,238,0.06);border-color:rgba(34,211,238,0.15)}
        .prod-tab.active{
          color:var(--cyan,#22d3ee);
          background:linear-gradient(135deg,rgba(34,211,238,0.14),rgba(124,58,237,0.08));
          border-color:rgba(34,211,238,0.4);box-shadow:0 0 8px rgba(34,211,238,0.2);
        }
        .prod-tab.active::before{content:'· ';color:var(--cyan,#22d3ee)}
        @media(max-width:600px){.prod-toolbar{padding:4px;gap:3px}.prod-tab{padding:5px 9px;font-size:0.6em;letter-spacing:1.2px}}
      `;
      document.head.appendChild(style);
    }

    const toolbar = document.createElement('nav');
    toolbar.className = 'prod-toolbar';
    toolbar.setAttribute('aria-label', 'Production tools');
    toolbar.innerHTML = TOOLS.map(t => `
      <a class="prod-tab ${t.slug === activeSlug ? 'active' : ''}" href="${t.href}">${t.label}</a>
    `).join('');

    const header = document.querySelector('.hq-header');
    if (header && header.parentNode) {
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
