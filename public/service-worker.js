// The build inserts a version hash and the complete local asset list.
const CACHE = 'filmsamling-__VERSION__';
const ASSETS = __ASSETS__;
const ASSET_URLS = new Set(ASSETS.map((path) => new URL(path, self.registration.scope).href));
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep one previous app cache so another open tab retains its old hashed chunks.
      const keys = (await caches.keys()).filter((key) => key.startsWith('filmsamling-'));
      const previous = keys.filter((key) => key !== CACHE).at(-1);
      await Promise.all(
        keys.filter((key) => key !== CACHE && key !== previous).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Cache only the exact public, same-origin app shell. API, auth and cover uploads never enter a cache.
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.search ||
    request.headers.has('Authorization') ||
    !url.pathname.startsWith('/min-filmsamling/')
  )
    return;
  const navigation = request.mode === 'navigate';
  if (!navigation && !ASSET_URLS.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (navigation) {
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          /* App shell remains available offline. */
        }
        return (
          (await cache.match('/min-filmsamling/index.html')) ||
          new Response('Appen kunne ikke åbnes offline. Prøv igen med forbindelse.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
        );
      }
      // Static files do not vary by Origin; Vite sets Vary: Origin on module responses.
      const saved = await cache.match(request, { ignoreVary: true });
      if (saved) return saved;
      const old = await caches.match(request, { ignoreVary: true });
      if (old) return old;
      try {
        return await fetch(request);
      } catch {
        return new Response('', { status: 503 });
      }
    })(),
  );
});
