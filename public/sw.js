/**
 * Service Worker para Ruta Libre y Ruta Libre Driver
 * Cachea el cascarón de la app y maneja la detección sin conexión.
 */

const CACHE_NAME = 'rutalibre-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json',
  '/manifest-driver.json',
  '/og-image.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Para llamadas a mapas o APIs en tiempo real, priorizar red
  if (
    event.request.url.includes('tile.openstreetmap.org') ||
    event.request.url.includes('router.project-osrm.org') ||
    event.request.url.includes('nominatim.openstreetmap.org') ||
    event.request.url.startsWith('ws')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Si no hay red y se pide página HTML, entregar el index en caché
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
