// Ryujin OS — minimal service worker.
//
// Purpose: meet Chrome's PWA-installability criteria so `beforeinstallprompt`
// fires. Strategy: pass-through fetch, NO caching — Ryujin OS is data-heavy
// and stale UI is worse than slightly slower loads.
//
// On activate, deletes any caches from earlier SW revisions and reloads
// controlled clients so HTML updates ship immediately even when an older
// SW was previously registered.

const VERSION = 'ryujin-os-v2-nocache-2026-05-13';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try { client.navigate(client.url); } catch (_) {}
    }
  })());
});

self.addEventListener('fetch', (event) => {
  // Pass-through. No caching, ever. HTML uses no-store at the edge.
});

// ── Web Push: show the notification, focus/open the app on click ──
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: (event.data && event.data.text && event.data.text()) || '' }; }
  const title = data.title || 'Plus Ultra Field';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/brand/plus-ultra/favicon-mark.png',
    badge: '/brand/plus-ultra/favicon-mark.png',
    tag: data.tag || 'pu-field',
    renotify: true,
    vibrate: [70, 40, 70],
    data: { url: data.url || '/companion.html' },
  };
  event.waitUntil((async () => {
    // If the app is open and visible, its in-app alert (ding/vibrate/toast) covers
    // it; skip the system notification to avoid a double-notify.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(c => c.focused || c.visibilityState === 'visible')) return;
    await self.registration.showNotification(title, opts);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/companion.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) { try { await c.focus(); return; } catch (e) {} }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
