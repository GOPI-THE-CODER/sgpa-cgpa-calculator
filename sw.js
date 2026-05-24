const CACHE_VERSION = 'v4';
const CACHE_NAME = `sgpa-cgpa-pwa-${CACHE_VERSION}`;

const scopeUrl = new URL('.', self.location.href);
const staticAssetPaths = [
  new URL('./', scopeUrl).pathname,
  new URL('./index.html', scopeUrl).pathname,
  new URL('./styles.css', scopeUrl).pathname,
  new URL('./script.js', scopeUrl).pathname,
  new URL('./manifest.json', scopeUrl).pathname,
  new URL('./offline.html', scopeUrl).pathname,
  new URL('./icons/icon-192.svg', scopeUrl).pathname,
  new URL('./icons/icon-512.svg', scopeUrl).pathname
];

const OFFLINE_PATH = new URL('./offline.html', scopeUrl).pathname;

self.skipWaiting();
self.clients.claim();

async function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return;
  }

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function getOfflineFallback() {
  return caches.match(OFFLINE_PATH);
}

async function handleNetworkFirst(request) {
  try {
    const response = await fetch(request);

    if (response && response.ok) {
      await cacheResponse(request, response);
    }

    return response;
  } catch {
    const cached = await caches.match(request);

    if (cached) {
      return cached;
    }

    return getOfflineFallback();
  }
}

async function handleCacheFirst(request) {
  const cached = await caches.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      await cacheResponse(request, response);
    }

    return response;
  } catch {
    return getOfflineFallback();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(staticAssetPaths))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (!isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
      })
    );
    return;
  }

  if (requestUrl.pathname === OFFLINE_PATH) {
    event.respondWith(handleCacheFirst(event.request));
    return;
  }

  if (event.request.mode === 'navigate' || requestUrl.pathname === '/') {
    event.respondWith(handleNetworkFirst(event.request));
    return;
  }

  if (staticAssetPaths.includes(requestUrl.pathname)) {
    event.respondWith(handleNetworkFirst(event.request));
    return;
  }

  event.respondWith(handleCacheFirst(event.request));
});
