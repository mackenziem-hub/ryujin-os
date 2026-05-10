// Finance toolbar — cross-tools nav for finance panel pages
(function() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  function init() {
    const TOOLS = [
      { slug: '',            href: '/finance.html',             label: 'Overview' },
      { slug: 'receivables', href: '/finance-receivables.html', label: 'Receivables' },
      { slug: 'payables',    href: '/finance-payables.html',    label: 'Payables' },
      { slug: 'payments',    href: '/finance-payments.html',    label: 'Payments' },
      { slug: 'pl',          href: '/finance-pl.html',          label: 'P&L' },
      { slug: 'admin',       href: '/finance-admin.html',       label: 'Admin' },
      { slug: 'advanced',    href: '/finance-advanced.html',    label: 'Advanced' }
    ];
    const path = window.location.pathname;
    let activeSlug = '';
    if (path === '/finance.html' || path === '/finance') activeSlug = '';
    else { const m = path.match(/finance-([a-z-]+)\.html/); if (m) activeSlug = m[1]; }

    if (!document.getElementById('fin-toolbar-css')) {
      const style = document.createElement('style');
      style.id = 'fin-toolbar-css';
      style.textContent = `
        html{scroll-behavior:smooth}
        a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--cyan,#22d3ee);outline-offset:2px;border-radius:6px}
        .fin-toolbar{background:rgba(8,12,24,0.6);border:1px solid var(--glass-border, rgba(34,211,238,0.16));border-radius:12px;padding:6px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:4px;position:relative;overflow:hidden;backdrop-filter:blur(8px)}
        .fin-toolbar::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan,#22d3ee) 50%,transparent);opacity:0.4}
        .fin-tab{padding:6px 12px;border-radius:8px;cursor:pointer;text-decoration:none;font-family:'Orbitron',monospace;font-size:0.65em;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-dim, rgba(160,190,230,0.55));font-weight:600;transition:all 0.18s;border:1px solid transparent;white-space:nowrap}
        .fin-tab:hover{color:var(--text,#d0daf0);background:rgba(34,211,238,0.06);border-color:rgba(34,211,238,0.15)}
        .fin-tab.active{color:var(--gold,#fbbf24);background:linear-gradient(135deg,rgba(251,191,36,0.12),rgba(34,211,238,0.06));border-color:rgba(251,191,36,0.4);box-shadow:0 0 8px rgba(251,191,36,0.2)}
        .fin-tab.active::before{content:'· ';color:var(--gold,#fbbf24)}
      `;
      document.head.appendChild(style);
    }
    const toolbar = document.createElement('nav');
    toolbar.className = 'fin-toolbar';
    toolbar.setAttribute('aria-label', 'Finance tools');
    toolbar.innerHTML = TOOLS.map(t => `<a class="fin-tab ${t.slug === activeSlug ? 'active' : ''}" href="${t.href}">${t.label}</a>`).join('');
    const header = document.querySelector('.hq-header');
    if (header && header.parentNode) {
      const banner = document.getElementById('banner-slot');
      const anchor = banner || header;
      if (anchor.nextSibling) anchor.parentNode.insertBefore(toolbar, anchor.nextSibling);
      else anchor.parentNode.appendChild(toolbar);
    } else {
      const main = document.querySelector('main') || document.body;
      main.insertBefore(toolbar, main.firstChild);
    }
  }
})();
