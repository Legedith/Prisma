const CACHE_VERSION = 'prisma-floor-lens-v4';
const RUNTIME_CACHE = 'prisma-floor-lens-runtime-v4';
const APP_SHELL = ['./', './index.html', './404.html', './styles.css', './upgrade.css', './app.js', './segmentation-worker.js', './manifest.webmanifest', './tiles.json', './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/icon-maskable-512.png', './app-parts/part-00.b64', './app-parts/part-01.b64', './app-parts/part-02.b64', './app-parts/part-03.b64', './app-parts/part-04.b64', './app-parts/part-05.b64', './app-parts/part-06.b64', './app-parts/part-07.b64', './app-parts/part-08.b64', './assets/thumbs/aj-1046.jpg', './assets/thumbs/aj-1047.jpg', './assets/thumbs/aj-1048.jpg', './assets/thumbs/aj-1059.jpg', './assets/thumbs/aj-1137.jpg', './assets/thumbs/aj-1181.jpg', './assets/thumbs/aj-1182.jpg', './assets/thumbs/antique-flower.jpg', './assets/thumbs/chex-flur.jpg', './assets/thumbs/daisy-aqua.jpg', './assets/thumbs/donato.jpg', './assets/thumbs/feather-multy.jpg', './assets/thumbs/lily-multi.jpg', './assets/thumbs/lily-white.jpg', './assets/thumbs/vinca-aqua.jpg', './assets/thumbs/vinca-azul.jpg', './assets/thumbs/vinca-titanium.jpg', './assets/thumbs/vinca-verde.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => ![CACHE_VERSION, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallback) return caches.match(fallback, { ignoreSearch: true });
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  const freshCode = /\.(?:js|css|html|webmanifest|b64)$/.test(url.pathname);
  if (freshCode) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response?.ok) {
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }))
  );
});
