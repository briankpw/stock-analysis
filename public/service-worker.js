// Service worker: (1) offline shell caching so Chrome/Safari accept the
// app as installable, (2) Web Push receiver — renders server-sent
// notifications on the OS notification centre and reopens the app when
// tapped.
//
// CACHE_NAME MUST change whenever the SW behaviour changes so browsers
// pick up the new script; the old cache is dropped on activate. The
// version string below is REWRITTEN automatically by
// `scripts/bump-service-worker.mjs` (invoked as `prebuild` in
// package.json) to a hash of the rest of this file, so any SW edit
// forces a fresh cache without an explicit manual bump. Manual edits
// to CACHE_NAME are still supported (e.g. to force a re-cache when
// only assets under `/public` change), but the auto-hash keeps
// happy-path deployments correct.
const CACHE_NAME = "key-stock-b4660e697d"; // auto-managed by scripts/bump-service-worker.mjs
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

// Fetch strategy is tightly scoped so the SW *only* short-circuits things
// it truly knows are immutable. Everything else is passed through to
// network — the caching cost of that is negligible for a same-origin
// app, and the wrong strategy for any Next.js request breaks the
// entire client-side router.
//
// Retro
// -----
// A previous version of this handler classified requests as "HTML if
// Accept includes text/html, otherwise cache-first static asset".
// That silently broke Next.js App Router client-side navigation:
//
//   1. Tap `<Link href="/signal">` in the sidebar.
//   2. Next.js issues an RSC fetch: GET /signal with
//      `Accept: text/x-component` (NOT text/html) and RSC=1 header.
//   3. Old handler: Accept doesn't include text/html → falls through
//      to cache-first branch → `caches.match(GET /signal)` returns
//      the previously-cached HTML response for that URL.
//   4. Client router receives HTML where it expected an RSC binary
//      payload → parses garbage → the client-side navigation fails
//      silently → the browser falls back to a full-page anchor nav.
//   5. On some Android Chrome PWA versions the fallback anchor nav
//      is routed to a new browser tab because the router-controlled
//      scope handoff never happened, which is exactly the "tapping
//      the sidebar opens a new tab" bug users hit.
//
// Additionally, the first RSC fetch for a URL got cached AS IF it
// were a static asset, so a later full page load for the same URL
// served the RSC binary instead of the HTML shell.
//
// The current handler fixes both by:
//   * Ignoring EVERY navigation-like request (top-level HTML,
//     `sec-fetch-mode: navigate`, and any request that carries an
//     RSC-like `Accept` or the Next.js `RSC` / `Next-Router-Prefetch`
//     headers). These go straight to the network; failures fall
//     back to the cached shell only for the outermost HTML case.
//   * Cache-first only for genuinely immutable Next.js build
//     artifacts (`/_next/static/*`, `/icons/*`, and the app shell
//     entries we pre-seed on install). These are content-hashed and
//     never change under a fixed URL, so aggressive caching is safe.
//   * Everything else (dynamic fonts, one-off images, misc GETs)
//     is passed straight through to the network without cache
//     intermediation — no wrong-shape response can ever be returned.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  // Same-origin only. Cross-origin fetches (fonts from Google
  // Fonts, tracking, etc.) shouldn't even touch this handler — we
  // couldn't safely cache them under the same-origin CSP anyway.
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls; they need to hit the server every
  // time and are already served fresh.
  if (url.pathname.startsWith("/api/")) return;

  // ---- Navigation / RSC — always network, no cache-read ---------
  //
  // "Navigation-like" is anything that:
  //   * The browser flags as a top-level navigation
  //     (`sec-fetch-mode: navigate`), OR
  //   * The Next.js client router issues to fetch an RSC payload —
  //     detected by the `RSC` request header, or the `Accept:
  //     text/x-component` header, or the prefetch header set by
  //     `<Link prefetch>`.
  //
  // For these we ALWAYS go to the network. If the network fails
  // AND it's a top-level HTML navigation, we fall back to the
  // cached "/" shell so the app boots offline. RSC failures are
  // NOT satisfied from cache — a stale RSC response would still
  // break routing; instead we let the fetch reject and Next.js
  // falls back to a full navigation.
  const acceptHeader = req.headers.get("accept") || "";
  const isRsc =
    req.headers.get("rsc") === "1" ||
    req.headers.get("next-router-prefetch") === "1" ||
    req.headers.get("next-router-state-tree") !== null ||
    acceptHeader.includes("text/x-component");
  const isNavigation =
    req.mode === "navigate" ||
    req.headers.get("sec-fetch-mode") === "navigate" ||
    acceptHeader.includes("text/html");

  if (isRsc) {
    // Straight passthrough. The whole point is to NOT intercept —
    // otherwise a cache miss vs. a network response race can hand
    // the router the wrong payload type. `event.respondWith(fetch(req))`
    // is functionally identical to letting the event pass through,
    // but explicit is nicer to grep for.
    event.respondWith(fetch(req));
    return;
  }

  if (isNavigation) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache the fresh navigation response so offline reloads
          // still boot the app. Restrict to opaque-safe responses —
          // a redirect or 3xx `res.type === "opaqueredirect"`
          // shouldn't poison the cache.
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(req, clone))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then(
              (cached) =>
                cached ??
                caches.match("/") ??
                new Response("Offline", { status: 503 }),
            ),
        ),
    );
    return;
  }

  // ---- Immutable build artifacts — cache-first -----------------
  //
  // These are the ONLY paths where cache-first is safe: their
  // filenames are content-hashed (`/_next/static/…`) or otherwise
  // known-immutable (icons pinned by the manifest). A stale copy
  // is either byte-identical to the fresh one, or the URL has
  // rotated on the deploy so no request matches the stale key.
  const isImmutable =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";
  if (isImmutable) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ??
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") {
              const clone = res.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(req, clone))
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (dynamic images, misc GETs) — passthrough. No
  // cache read, no cache write. Prevents the "wrong-shape cached
  // response" class of bug we hit above.
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

  // Diagnostic: visible in the SW console under DevTools →
  // Application → Service workers → key-stock. If pushes arrive but no
  // toast appears, the log line still fires here — that pinpoints the
  // problem to the OS notification stack (Focus Assist, DND, etc.) rather
  // than the server / subscription.
  try {
    // eslint-disable-next-line no-console
    console.log("[sw] push received", {
      hasData: Boolean(event.data),
      title: payload.title,
      tag: payload.tag,
    });
  } catch (_) {}

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
    // Windows in particular treats notifications without this flag as
    // "transient" and skips the on-screen toast whenever the target app
    // is currently focused — the notification only appears in the Action
    // Center. Keeping the banner sticky forces the OS to actually pop it
    // and matches how a real chat / mail client behaves. Users can still
    // dismiss it manually.
    requireInteraction: true,
    // Explicitly non-silent (some UAs default `silent` to true when
    // `requireInteraction` is set from a background context).
    silent: false,
    // Vibration pattern (Android; ignored on desktop/iOS).
    vibrate: [180, 80, 180],
    timestamp: Date.now(),
    // Attach the raw payload so notificationclick can read the target URL.
    data: {
      url: payload.url || "/",
      ...(payload.data || {}),
    },
  };

  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .then(() => {
        try {
          // eslint-disable-next-line no-console
          console.log("[sw] showNotification ok", title);
        } catch (_) {}
      })
      .catch((err) => {
        try {
          // eslint-disable-next-line no-console
          console.error("[sw] showNotification failed", err);
        } catch (_) {}
      }),
  );
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
// fails we drop a marker into the SW cache so `/bot` can surface a
// re-enable banner on the next page load — otherwise the user just
// silently stops getting notifications with no way to diagnose it.
//
// Special key `sw-diag:/__push-resub-failed` (a synthetic URL — never
// actually fetched) holds a JSON blob with the timestamp and reason.
// `hooks/use-push-notifications.ts` reads it and can also delete it
// once the user has re-subscribed.
async function _writePushResubDiagnostic(reason) {
  try {
    const cache = await caches.open("sw-diag");
    await cache.put(
      "/__push-resub-failed",
      new Response(
        JSON.stringify({ at: Date.now(), reason: String(reason).slice(0, 200) }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  } catch (_) {
    // Cache write itself failed — nothing we can do at this layer.
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keyRes = await fetch("/api/push", { cache: "no-store" });
        if (!keyRes.ok) {
          // Most common cause: auth is enabled and this SW request
          // has no session cookie (a fresh SW request bypasses the
          // normal cookie flow). Drop a marker so the /bot page can
          // tell the user to re-open the app + click "Enable
          // notifications" again.
          await _writePushResubDiagnostic(
            "keyFetch:" + keyRes.status + " " + keyRes.statusText,
          );
          return;
        }
        const info = await keyRes.json();
        const key = urlBase64ToUint8Array(info.publicKey);
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        const upRes = await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "subscribe",
            subscription: sub.toJSON(),
          }),
        });
        if (!upRes.ok) {
          await _writePushResubDiagnostic(
            "upload:" + upRes.status + " " + upRes.statusText,
          );
        }
      } catch (err) {
        await _writePushResubDiagnostic(err && err.message ? err.message : String(err));
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
