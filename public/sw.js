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
