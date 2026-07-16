// Minimal service worker for offline shell caching. Kept intentionally small
// because Next.js already sets sensible caching headers on its assets \u2014
// this SW is mainly here so Chrome recognises the app as installable.

const CACHE_NAME = "key-stock-v1";
const ASSETS = ["/", "/overview"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

// Network-first for HTML/API (fresh data), cache-first for static assets.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  // Never intercept API calls; they need to hit the server.
  if (url.pathname.startsWith("/api/")) return;

  // HTML pages: network, fall back to cache.
  if (req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? new Response("Offline", { status: 503 }))),
    );
    return;
  }

  // Static asset: cache-first.
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ??
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }),
    ),
  );
});
