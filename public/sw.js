// Ryujin OS — minimal service worker.
//
// Sole purpose right now: meet Chrome's PWA-installability criteria so
// the `beforeinstallprompt` event fires on Android Chrome (and desktop
// Chrome/Edge). Without a registered service worker, Chrome refuses to
// surface the native "Install app" dialog and our in-app install button
// silently falls back to the manual-steps modal.
//
// Strategy: pass-through fetch. We don't cache anything yet — Ryujin OS
// is data-heavy and stale UI would be worse than slightly slower loads.
// When we want offline-tolerance later we'll add a cache shell here.

const VERSION = 'ryujin-os-v1';

self.addEventListener('install', (event) => {
  // No precaching — just take over fast.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through. No caching. This is intentional — Chrome only requires
  // a non-empty fetch handler, not an offline shell.
  // (Listener exists so Lighthouse's installability check passes.)
});
