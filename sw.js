const CACHE_VERSION = 'v2';
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

async function handleStaticAsset(event) {
  const request = event.request;
  const cached = await caches.match(request);

  if (cached) {
    fetch(request)
      .then((response) => cacheResponse(request, response))
      .catch(() => undefined);
    return cached;
  }

  try {
    const response = await fetch(request);
    await cacheResponse(request, response);
    return response;
  } catch {
    const fallback = await getOfflineFallback();
    if (fallback) {
      return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function handleNavigation(event) {
  try {
    const response = await fetch(event.request);
    if (!response.ok) {
      throw new Error('Network response not ok');
    }
    await cacheResponse(event.request, response);
    return response;
  } catch {
    const fallback = await getOfflineFallback();
    if (fallback) {
      return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
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

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (staticAssetPaths.includes(requestUrl.pathname)) {
    event.respondWith(handleStaticAsset(event));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});
