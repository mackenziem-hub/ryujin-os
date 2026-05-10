// Customer toolbar — cross-tools nav for customer panel pages
(function() {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  function init() {
    const TOOLS = [
      { slug: '',          href: '/customer.html',           label: 'Overview' },
      { slug: 'list',      href: '/customer-list.html',      label: 'List' },
      { slug: 'reviews',   href: '/customer-reviews.html',   label: 'Reviews' },
      { slug: 'referrals', href: '/customer-referrals.html', label: 'Referrals' },
      { slug: 'admin',     href: '/customer-admin.html',     label: 'Admin' },
      { slug: 'advanced',  href: '/customer-advanced.html',  label: 'Advanced' }
    ];
    const path = window.location.pathname;
    let activeSlug = '';
    if (path === '/customer.html' || path === '/customer') activeSlug = '';
    else { const m = path.match(/customer-([a-z-]+)\.html/); if (m) activeSlug = m[1]; }

    if (!document.getElementById('cust-toolbar-css')) {
      const style = document.createElement('style');
      style.id = 'cust-toolbar-css';
      style.textContent = `
        html{scroll-behavior:smooth}
        a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--cyan,#22d3ee);outline-offset:2px;border-radius:6px}
        .cust-toolbar{background:rgba(8,12,24,0.6);border:1px solid var(--glass-border, rgba(34,211,238,0.16));border-radius:12px;padding:6px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:4px;position:relative;overflow:hidden;backdrop-filter:blur(8px)}
        .cust-toolbar::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan,#22d3ee) 50%,transparent);opacity:0.4}
        .cust-tab{padding:6px 12px;border-radius:8px;cursor:pointer;text-decoration:none;font-family:'Orbitron',monospace;font-size:0.65em;letter-spacing:1.4px;text-transform:uppercase;color:var(--text-dim, rgba(160,190,230,0.55));font-weight:600;transition:all 0.18s;border:1px solid transparent;white-space:nowrap}
        .cust-tab:hover{color:var(--text,#d0daf0);background:rgba(34,211,238,0.06);border-color:rgba(34,211,238,0.15)}
        .cust-tab.active{color:var(--cyan,#22d3ee);background:linear-gradient(135deg,rgba(34,211,238,0.14),rgba(124,58,237,0.08));border-color:rgba(34,211,238,0.4);box-shadow:0 0 8px rgba(34,211,238,0.2)}
        .cust-tab.active::before{content:'· ';color:var(--cyan,#22d3ee)}
      `;
      document.head.appendChild(style);
    }
    const toolbar = document.createElement('nav');
    toolbar.className = 'cust-toolbar';
    toolbar.setAttribute('aria-label', 'Customer tools');
    toolbar.innerHTML = TOOLS.map(t => `<a class="cust-tab ${t.slug === activeSlug ? 'active' : ''}" href="${t.href}">${t.label}</a>`).join('');
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
