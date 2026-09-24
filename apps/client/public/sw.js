/* Offline shell (P2a): cache app shell + fonts only — data stays live from
   the API so a stuck network NEVER shows stale queue positions as truth. */
const CACHE = 'lp-client-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // network only — truth lives there
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/'))),
  );
});
