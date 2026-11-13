// Offline support and fast repeat visits. The version is stamped on every deploy.
const VERSION = '__BUILD__';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const IMG = 'img-v1';
const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'src/app.js', 'src/chains.js', 'src/data.js', 'src/search.js', 'src/units.js', 'src/pictures.js',
  'src/i18n.js', 'src/hours.js', 'src/list.js', 'src/translate.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];
const IMG_HOSTS = ['images.openfoodfacts.org', 'static.ah.nl', 'raw.githubusercontent.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Answer from the cache straight away and refresh it in the background.
async function staleWhileRevalidate(req, cacheName, key = req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  const fresh = fetch(req).then((r) => { if (r.ok) cache.put(key, r.clone()); return r; }).catch(() => hit);
  return hit || fresh;
}
async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const r = await fetch(req);
    if (r.ok) cache.put(key, r.clone());
    return r;
  } catch {
    return (await cache.match(key)) || Response.error();
  }
}
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/data/offers.json')) {
      e.respondWith(networkFirst(req, DATA, url.origin + url.pathname));
    } else if (url.pathname.includes('/data/')) {
      e.respondWith(staleWhileRevalidate(req, DATA, url.origin + url.pathname));
    } else if (req.mode === 'navigate') {
      e.respondWith(staleWhileRevalidate(req, SHELL, new URL('index.html', self.registration.scope).href));
    } else {
      e.respondWith(staleWhileRevalidate(req, SHELL, url.origin + url.pathname));
    }
  } else if (req.destination === 'image' && IMG_HOSTS.includes(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req, IMG).finally(() => trim(IMG, 600)));
  }
});

// Tapping a deal alert opens the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((wins) => {
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.focus().then(() => w.navigate(target)) : self.clients.openWindow(target);
  }));
});
