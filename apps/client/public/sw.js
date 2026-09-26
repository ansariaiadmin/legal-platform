/* Offline shell: caches the app shell only. Data always comes live from the
   API, so a poor connection never shows an outdated queue position. */
const CACHE = 'lp-client-v2';
const BASE = '/portal';
const SHELL = [`${BASE}/`, `${BASE}/manifest.webmanifest`, `${BASE}/icon.svg`];

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
  if (url.pathname.startsWith('/api/')) return; // always from the network
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match(`${BASE}/`))),
  );
});
