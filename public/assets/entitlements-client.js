// ═══════════════════════════════════════════════════════════════
// Ryujin OS — entitlements client gate
//
// Reads the current tenant's entitlements once per page and locks
// nav icons + layer cards that point at unpurchased pillars or
// tools. Locked elements get .ent-locked, click-to-upgrade hijack,
// and a small badge.
//
// Drop-in: <script src="/assets/entitlements-client.js" defer></script>
// at the top of a panel page. Runs on DOMContentLoaded.
//
// Pillar/tool detection is purely by href pattern so existing panel
// HTMLs don't need data attributes.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const TENANT = (window.__RYUJIN_TENANT__) || (document.documentElement.dataset.tenant) || 'plus-ultra';

  // Saleable pillars only — hq + admin are infra and never lock.
  const SALEABLE_PILLARS = ['marketing', 'sales', 'production', 'service', 'customer', 'finance'];
  const TOOLS = ['proposal', 'estimator', 'doc', 'chat', 'marketing_scheduler'];

  // Map href patterns to (pillar | tool) slug. First match wins.
  // Nav icons + layer cards on dashboards mostly use these patterns.
  function classifyHref(href) {
    if (!href) return null;
    try {
      const path = new URL(href, window.location.origin).pathname;

      // Tools (standalone surfaces) — Phase 2 will add /proposal-tool.html etc.
      if (path === '/proposal-tool.html') return { kind: 'tool', slug: 'proposal' };
      if (path === '/instant-estimator.html' || path === '/estimator-tool.html') return { kind: 'tool', slug: 'estimator' };
      if (path === '/doc-tool.html') return { kind: 'tool', slug: 'doc' };
      if (path === '/chat-tool.html') return { kind: 'tool', slug: 'chat' };
      if (path === '/marketing-tool.html') return { kind: 'tool', slug: 'marketing_scheduler' };

      // Pillar dashboards + their sub-pages: /sales.html, /sales-portal.html, /sales-admin.html, etc.
      // Match by leading segment.
      const m = path.match(/^\/([a-z]+)(?:[-.]|$)/);
      if (!m) return null;
      const head = m[1];
      if (SALEABLE_PILLARS.includes(head)) return { kind: 'pillar', slug: head };

      // /admin-agents.html?focus=sales — pull pillar from query
      if (head === 'admin' && path.includes('agents')) {
        try {
          const focus = new URL(href, window.location.origin).searchParams.get('focus');
          if (focus && SALEABLE_PILLARS.includes(focus)) return { kind: 'pillar', slug: focus };
        } catch {}
      }

      return null;
    } catch {
      return null;
    }
  }

  function injectStyles() {
    if (document.getElementById('ent-locked-styles')) return;
    const css = `
      .ent-locked { position: relative; opacity: 0.5; cursor: not-allowed; }
      .ent-locked:hover { transform: none !important; }
      .ent-locked::after, .ent-locked .layer-card-corner { display: none !important; }
      .ent-lock-badge {
        position: absolute; top: 6px; right: 6px; z-index: 5;
        font-family: 'Share Tech Mono', monospace;
        font-size: 0.55em; letter-spacing: 1.5px; text-transform: uppercase;
        padding: 2px 7px; border-radius: 9px;
        background: rgba(251, 191, 36, 0.15); color: #fbbf24;
        border: 1px solid rgba(251, 191, 36, 0.3);
        pointer-events: none;
      }
      .nav-icon.ent-locked .ent-lock-badge {
        top: 2px; right: 2px;
        font-size: 0.45em; padding: 1px 4px; letter-spacing: 1px;
      }
    `;
    const tag = document.createElement('style');
    tag.id = 'ent-locked-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function lockElement(el, slug, kind) {
    if (el.classList.contains('ent-locked')) return;
    el.classList.add('ent-locked');
    el.setAttribute('data-locked-' + kind, slug);
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('title', `Locked — upgrade to unlock ${slug}`);

    // Hijack click → upgrade page
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.location.href = `/upgrade.html?want=${encodeURIComponent(kind + ':' + slug)}`;
    }, { capture: true });

    // Add a small lock badge (skip nav-icons that are too tight — keep theirs minimal)
    const badge = document.createElement('span');
    badge.className = 'ent-lock-badge';
    badge.textContent = '🔒';
    el.appendChild(badge);
  }

  async function fetchEntitlements() {
    try {
      const r = await fetch('/api/entitlements', { headers: { 'x-tenant-id': TENANT } });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  function applyLocks(ent) {
    if (!ent) return;
    const ownedPillars = new Set(ent.pillars || []);
    const ownedTools = new Set(ent.tools || []);

    const candidates = document.querySelectorAll('a.nav-icon, a.layer-card');
    candidates.forEach((a) => {
      const cls = classifyHref(a.getAttribute('href'));
      if (!cls) return;
      if (cls.kind === 'pillar' && !ownedPillars.has(cls.slug)) lockElement(a, cls.slug, 'pillar');
      if (cls.kind === 'tool' && !ownedTools.has(cls.slug)) lockElement(a, cls.slug, 'tool');
    });
  }

  async function init() {
    injectStyles();
    const ent = await fetchEntitlements();
    if (!ent) return; // fail-open: if we can't fetch, don't lock anything (pre-migration safe)
    applyLocks(ent);
    // Re-apply when DOM mutates (panels render layer-cards async sometimes)
    const mo = new MutationObserver(() => applyLocks(ent));
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
