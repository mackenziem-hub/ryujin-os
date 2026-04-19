// ────────────────────────────────────────────────────────────────────
// Ryujin Production Nav — unified cross-nav bar for tools inside the
// Production sector. Inject a pill row at the top of WO / Materials /
// Calendar / Pay Sheet so users can flip between them in one click.
//
// Usage: include this script at the bottom of any production tool page
// after the main topbar has rendered. It finds a `#ry-prod-nav-mount`
// element (or auto-inserts after the first .topbar) and fills it.
// Set `data-active="wo" | "materials" | "calendar" | "paysheet"` on the
// <body> or the mount element to highlight the current page.
// ────────────────────────────────────────────────────────────────────
(function(){
  const TOOLS = [
    { id: 'wo',        label: 'WORK ORDERS', href: 'production-workorders.html', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="15" y2="11"/></svg>' },
    { id: 'calendar',  label: 'CALENDAR',    href: 'production-calendar.html',   icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' },
    { id: 'materials', label: 'MATERIALS',   href: 'production-materials.html',  icon: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' },
    { id: 'paysheet',  label: 'PAY SHEETS',  href: 'production-paysheet.html',   icon: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>' },
    { id: 'jobs',      label: 'ACTIVE JOBS', href: 'production-jobs.html',       icon: '<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>' }
  ];

  const CSS = `
  #ry-prod-nav{position:fixed;top:74px;left:12px;right:12px;z-index:18;display:flex;gap:8px;padding:8px 10px;background:rgba(14,22,40,0.82);border:1px solid rgba(251,146,60,0.2);border-radius:12px;backdrop-filter:blur(16px);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  #ry-prod-nav::-webkit-scrollbar{display:none}
  #ry-prod-nav a{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(6,10,20,0.6);border:1px solid rgba(251,146,60,0.18);border-radius:9px;color:rgba(200,220,255,0.7);font-family:'Orbitron',sans-serif;font-size:0.66em;font-weight:700;letter-spacing:1.5px;text-decoration:none;white-space:nowrap;transition:all 0.2s;flex-shrink:0}
  #ry-prod-nav a:hover{border-color:rgba(251,146,60,0.5);color:#fb923c;background:rgba(251,146,60,0.08)}
  #ry-prod-nav a.on{background:linear-gradient(135deg,rgba(251,146,60,0.25),rgba(251,146,60,0.08));border-color:#fb923c;color:#fb923c;box-shadow:0 0 14px rgba(251,146,60,0.2)}
  #ry-prod-nav a svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
  #ry-prod-nav .spacer{flex:1;min-width:0}
  #ry-prod-nav a.hub{border-color:rgba(34,211,238,0.3);color:#22d3ee}
  #ry-prod-nav a.hub:hover{background:rgba(34,211,238,0.08);border-color:#22d3ee}
  /* Push the page content down so the fixed nav doesn't cover it */
  body.ry-prod-offset .main, body.ry-prod-offset .app > .main { margin-top: 52px; }
  body.ry-prod-offset .app { grid-template-rows: 56px 52px 1fr !important; }

  @media (max-width: 700px) {
    #ry-prod-nav{top:68px;padding:6px;gap:5px}
    #ry-prod-nav a{padding:7px 10px;font-size:0.58em;letter-spacing:1px}
    #ry-prod-nav a svg{width:11px;height:11px}
    body.ry-prod-offset .main, body.ry-prod-offset .app > .main { margin-top: 44px; }
  }
  `;

  function inject(){
    if (document.getElementById('ry-prod-nav')) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const nav = document.createElement('nav');
    nav.id = 'ry-prod-nav';
    const active = document.body.getAttribute('data-prod-tool') ||
                   TOOLS.find(t => location.pathname.endsWith(t.href))?.id || '';
    nav.innerHTML = TOOLS.map(t => `
      <a href="${t.href}" class="${t.id === active ? 'on' : ''}">${t.icon}${t.label}</a>
    `).join('') + '<span class="spacer"></span>' +
      `<a href="production.html" class="hub"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>BACK TO PRODUCTION</a>` +
      `<a href="command-center.html" class="hub"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>MAIN MENU</a>`;

    document.body.appendChild(nav);
    document.body.classList.add('ry-prod-offset');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
