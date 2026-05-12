// Ryujin portal — shared mobile tabbar.
//
// Drop-in: <script src="/assets/portal-tabbar.js" defer></script>
//
// Injects the same bottom nav onto every destination (portal-mobile,
// production-jobs, messages, admin-activity, administration, etc.) so
// the user feels like they're navigating one app instead of falling
// into separate admin pages. Active tab is detected from pathname.
//
// Safe to include on any page — it only renders on viewports < 768px,
// and adds body padding-bottom so it doesn't cover content. Idempotent:
// won't double-inject if the page already has one.

(function () {
  // Skip if already present (covers portal-mobile.html which ships its own
  // tabbar inline with the FAB-style mic). Avoids duplicate nav.
  if (document.querySelector('.tabbar.ry-portal-tabbar') || document.querySelector('nav.tabbar')) return;

  // Skip on wide viewports — desktop admin doesn't need this.
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  const TABS = [
    { key: 'today',    label: 'Today',    href: '/portal-mobile.html',
      svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>' },
    { key: 'jobs',     label: 'Jobs',     href: '/production-jobs.html',
      svg: '<path d="M3 12 12 4l9 8"/><path d="M5 10v10h14V10"/>' },
    { key: 'messages', label: 'Messages', href: '/messages.html',
      svg: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { key: 'activity', label: 'Activity', href: '/admin-activity.html',
      svg: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>' },
    { key: 'admin',    label: 'Admin',    href: '/administration.html',
      svg: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
  ];

  function activeKey() {
    const p = location.pathname.toLowerCase();
    if (p.endsWith('/portal-mobile.html') || p === '/' || p === '/portal') return 'today';
    if (p.includes('production-jobs') || p.includes('production-workorders') || p.includes('production-tickets')) return 'jobs';
    if (p.includes('messages')) return 'messages';
    if (p.includes('admin-activity')) return 'activity';
    if (p.includes('administration') || p.includes('admin.html') || p.includes('admin-')) return 'admin';
    return null;
  }

  function inject() {
    if (!isMobile()) return;
    if (document.querySelector('.ry-portal-tabbar')) return;

    const css = `
      :root { --ry-cream: #f5ecd9; }
      .ry-portal-tabbar {
        position: fixed; left: 0; right: 0; bottom: 0;
        padding: 8px 10px calc(8px + env(safe-area-inset-bottom)) 10px;
        background: rgba(10,14,26,0.92);
        border-top: 1px solid rgba(255,255,255,0.08);
        backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
        z-index: 9999;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
      }
      .ry-portal-tabbar-inner {
        max-width: 480px; margin: 0 auto;
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 0;
      }
      .ry-portal-tabbar a {
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 6px 0 2px;
        color: rgba(255,255,255,0.55); text-decoration: none;
        font-size: 0.7em; font-weight: 500; letter-spacing: 0.2px;
        -webkit-tap-highlight-color: transparent;
      }
      .ry-portal-tabbar a svg {
        width: 22px; height: 22px; stroke: currentColor; fill: none;
        stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round;
      }
      .ry-portal-tabbar a.active { color: var(--ry-cream); }
      body.has-ry-tabbar { padding-bottom: calc(64px + env(safe-area-inset-bottom)) !important; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const active = activeKey();
    const nav = document.createElement('nav');
    nav.className = 'ry-portal-tabbar';
    nav.setAttribute('aria-label', 'Portal navigation');
    nav.innerHTML = `
      <div class="ry-portal-tabbar-inner">
        ${TABS.map(t => `
          <a href="${t.href}" data-tab="${t.key}" class="${active === t.key ? 'active' : ''}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${t.svg}</svg>
            <span>${t.label}</span>
          </a>
        `).join('')}
      </div>
    `;
    document.body.appendChild(nav);
    document.body.classList.add('has-ry-tabbar');
  }

  // Run once on load; also re-check on resize (rare orientation flip etc.)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      document.querySelector('.ry-portal-tabbar')?.remove();
      document.body.classList.remove('has-ry-tabbar');
    } else {
      inject();
    }
  });
})();
