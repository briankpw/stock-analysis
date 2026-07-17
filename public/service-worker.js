// Service worker: (1) offline shell caching so Chrome/Safari accept the
// app as installable, (2) Web Push receiver — renders server-sent
// notifications on the OS notification centre and reopens the app when
// tapped.
//
// Bump CACHE_NAME whenever the SW behaviour changes so browsers pick up
// the new script; the old cache is dropped on activate.
const CACHE_NAME = "key-stock-v2";
const ASSETS = ["/", "/overview"];

// Fallback rendering used when a push arrives without a JSON payload
// (e.g. a browser "test push" from DevTools) — we still want something
// on screen instead of the browser's opaque default.
const FALLBACK_TITLE = "Stock Analysis";
const FALLBACK_BODY = "You have new activity.";
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/icon-192.png";

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

// ---------------------------------------------------------------------------
// Web Push receiver
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  // Parse whatever the server sent. `web-push` encodes the payload as JSON
  // when we pass a string, so a well-formed alert always parses cleanly;
  // treat parse failures as "renderable but content unknown" so the user
  // still sees *something*.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      const text = event.data.text?.() ?? "";
      payload = { title: FALLBACK_TITLE, body: text || FALLBACK_BODY };
    }
  }

  const title = payload.title || FALLBACK_TITLE;
  const options = {
    body: payload.body || FALLBACK_BODY,
    icon: payload.icon || ICON,
    badge: payload.badge || BADGE,
    // `tag` collapses notifications with the same key into a single row
    // on both Android and iOS — used server-side to group by ticker /
    // category. `renotify` re-triggers vibration/sound on tag collision.
    tag: payload.tag || "stock-analysis",
    renotify: true,
    // Attach the raw payload so notificationclick can read the target URL.
    data: {
      url: payload.url || "/",
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Focus an existing PWA/tab if we can, otherwise open a new one.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const origin = self.location.origin;
        for (const client of clients) {
          try {
            const u = new URL(client.url);
            if (u.origin === origin && "focus" in client) {
              client.focus();
              if ("navigate" in client && typeof client.navigate === "function") {
                return client.navigate(target).catch(() => {});
              }
              return;
            }
          } catch (_) {}
        }
        return self.clients.openWindow(target);
      }),
  );
});

// Some browsers rotate the crypto keys behind an existing subscription
// (per RFC 8291 §5). When that happens the browser fires this event and
// the SW is expected to resubscribe + inform the server. If either step
// fails we drop the whole subscription so the /bot UI's "Enable" button
// can re-establish it from scratch.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch("/api/push", { cache: "no-store" });
        if (!keyRes.ok) return;
        const info = await keyRes.json();
        const key = urlBase64ToUint8Array(info.publicKey);
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            subscription: sub.toJSON(),
          }),
        });
      } catch (_) {
        // Give up quietly — the user can re-enable from the Bot page.
      }
    })(),
  );
});

// VAPID public keys arrive as URL-safe base64 strings; the browser's
// PushManager wants a raw Uint8Array. Standard trick from the MDN docs.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = self.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
