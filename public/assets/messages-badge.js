// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Messages unread badge poller.
//
// Drop on any admin/portal page. Polls /api/messages?box=unread
// every 30s and updates:
//   - any element with [data-messages-badge] (shows unread count,
//     hidden when 0)
//   - document.title prefix "(N) ..." when unread > 0
//
// Requires ryujin_token in localStorage. Silently no-ops without
// one (the page will already be bouncing to /login.html via the
// portal auth client).
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const POLL_MS = 30 * 1000;

  function token() {
    return localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token');
  }

  async function fetchUnreadCount() {
    const tok = token();
    if (!tok) return null;
    try {
      const r = await fetch('/api/messages?box=unread&limit=1', {
        headers: { 'Authorization': 'Bearer ' + tok, 'x-tenant-id': 'plus-ultra' }
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.stats?.unread ?? (data.messages?.length || 0);
    } catch { return null; }
  }

  const baseTitle = document.title;
  function paint(count) {
    const els = document.querySelectorAll('[data-messages-badge]');
    els.forEach(el => {
      if (!count || count <= 0) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
        el.textContent = count > 99 ? '99+' : String(count);
      }
    });
    // Title prefix
    document.title = (count && count > 0) ? `(${count}) ${baseTitle}` : baseTitle;
  }

  async function tick() {
    const c = await fetchUnreadCount();
    if (c != null) paint(c);
  }

  // Run once on load + every POLL_MS thereafter.
  // Also re-run when the tab regains focus, since long-idle counts go stale.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else {
    tick();
  }
  setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
})();
