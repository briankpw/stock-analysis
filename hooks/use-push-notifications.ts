"use client";

/**
 * Client hook for Web Push subscription lifecycle.
 *
 * Manages, for the current browser/PWA install:
 *   * SW readiness — waits for the app's service worker to activate
 *   * Notification permission — asks on demand, exposes current state
 *   * Push subscription — subscribes via PushManager and POSTs the sub
 *     to `/api/push`; unsubscribes symmetrically
 *
 * Also exposes a light *listing* of every device registered with the
 * server so the Bot page can show a "Enabled devices" table.
 *
 * Important: Web Push only works inside a secure context. Browsers count
 * `http://localhost` and `https://…` as secure; `http://192.168.x.x`
 * does NOT and calling `pushManager.subscribe()` there rejects with
 * `NotAllowedError`. The hook surfaces `supported: false` in that case so
 * the UI can render a helpful hint.
 */

import * as React from "react";

export type PermissionState = "default" | "granted" | "denied" | "unsupported";

export interface RegisteredDevice {
  endpoint: string;
  label: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Per-capability breakdown of *why* push may (or may not) be
 * usable. Surfaced to the UI so a user seeing a disabled
 * "Enable" button can immediately tell whether the blocker is
 * their transport (`isSecureContext === false` = you're on
 * HTTP), their platform (`isIosSafariNotPwa` = iOS without
 * "Add to Home Screen"), or something else entirely.
 *
 * The old boolean `supported` was correct but useless for
 * debugging in the wild — five very different problems all
 * collapse into "not supported", so users on mobile hit the
 * wall with no idea what to fix.
 */
export interface PushSupportDiagnostics {
  /** True on HTTPS or localhost. Web Push absolutely requires this. */
  isSecureContext: boolean;
  /** `serviceWorker` in `navigator`. */
  hasServiceWorker: boolean;
  /** `PushManager` in `window`. */
  hasPushManager: boolean;
  /** `Notification` in `window`. */
  hasNotificationApi: boolean;
  /** Best-effort iOS detection from userAgent. */
  isIos: boolean;
  /** True when running as an installed PWA (`display-mode: standalone`). */
  isStandalone: boolean;
  /** iOS in a plain Safari tab — Web Push is unavailable until the
   *  user does Share → Add to Home Screen. */
  isIosSafariNotPwa: boolean;
}

export interface PushResubscribeFailure {
  /** Wall-clock millis when the SW's `pushsubscriptionchange` handler
   *  gave up. */
  at: number;
  /** Short human-readable reason ("keyFetch:401", "upload:403",
   *  network error message). Truncated at 200 chars by the SW. */
  reason: string;
}

/**
 * Snapshot of the SW registrar's own status, written to
 * `caches.open('sw-diag') → '/__sw-register-status'` by
 * `public/sw-register.js`. Surfaced to the diagnostics panel so a
 * user seeing "push doesn't work" can immediately tell whether the
 * SW even registered, and if not — why. The historical failure mode
 * was a silently-empty catch swallowing the reason.
 */
export interface ServiceWorkerRegistrationStatus {
  at: number;
  /**
   *  * `unsupported` — no `serviceWorker` on `navigator`.
   *  * `registering` — register() was called, no result yet.
   *  * `registered` — success (see `phase` for lifecycle state).
   *  * `failed`     — register() rejected (see `reason`).
   */
  state: "unsupported" | "registering" | "registered" | "failed";
  /** Populated on `state === "failed"`. */
  reason?: string;
  /** Populated on `state === "registered"`. */
  scope?: string;
  /** Populated on `state === "registered"` — SW lifecycle phase. */
  phase?: "active" | "installing" | "waiting" | "unknown";
}

export interface PushStatus {
  /** True when the browser/environment can register a push subscription. */
  supported: boolean;
  /** Granular breakdown behind `supported`; useful for a debug panel. */
  diagnostics: PushSupportDiagnostics;
  /** Notification.permission at last check. */
  permission: PermissionState;
  /** True when this browser has an active push subscription. */
  subscribed: boolean;
  /** VAPID public key fetched from the server, base64url. */
  publicKey: string | null;
  /** True until the initial status probe finishes. */
  loading: boolean;
  /** Last user-visible error, or null. */
  error: string | null;
  /** All devices subscribed on the server. */
  devices: RegisteredDevice[];
  /** Number of active subscribers server-side. */
  subscriberCount: number;
  /**
   * Populated when the SW's `pushsubscriptionchange` handler ran and
   * couldn't complete the resubscribe (usually because a fresh SW
   * request to `/api/push` had no auth cookie). When set, the UI
   * should nudge the user to re-open the app and click "Enable
   * notifications" again — otherwise they'll silently stop getting
   * pushes. Written to the SW's `sw-diag` cache by
   * `public/service-worker.js`; cleared when we detect an active
   * subscription on refresh.
   */
  resubscribeFailure: PushResubscribeFailure | null;
  /**
   * Snapshot of `sw-register.js`'s own registration attempt. Lets the
   * diagnostics panel show "SW: active" vs. "SW: failed(reason)"
   * without the user opening devtools. `null` = the registrar hasn't
   * written anything yet (typically the first ~1s after page load,
   * or a browser without the Cache API).
   */
  swRegistration: ServiceWorkerRegistrationStatus | null;
}

interface PushApiResponse {
  configured: boolean;
  publicKey: string;
  subject: string;
  subscriberCount: number;
  subscriptions: RegisteredDevice[];
}

function detectDiagnostics(): PushSupportDiagnostics {
  if (typeof window === "undefined") {
    return {
      isSecureContext: false,
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotificationApi: false,
      isIos: false,
      isStandalone: false,
      isIosSafariNotPwa: false,
    };
  }
  const ua = navigator.userAgent ?? "";
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const isStandalone =
    ("matchMedia" in window &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    // iOS-specific legacy property — TS doesn't know about it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Boolean((navigator as any).standalone);
  return {
    isSecureContext: window.isSecureContext === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotificationApi: "Notification" in window,
    isIos,
    isStandalone,
    isIosSafariNotPwa: isIos && !isStandalone,
  };
}

function detectSupport(diag: PushSupportDiagnostics): boolean {
  // All four capability probes must pass — missing any one means
  // the browser genuinely can't subscribe.
  if (
    !diag.hasServiceWorker ||
    !diag.hasPushManager ||
    !diag.hasNotificationApi ||
    !diag.isSecureContext
  ) {
    return false;
  }
  // iOS 16.4+ has all four APIs even inside a plain Safari tab, but
  // `pushManager.subscribe()` throws unless the app is installed to
  // the Home Screen. Reporting "supported" there would tempt users
  // to tap Enable and see a cryptic NotAllowedError; we instead
  // treat non-PWA iOS as unsupported and route the user to the
  // "Add to Home Screen" hint.
  if (diag.isIosSafariNotPwa) return false;
  return true;
}

function readPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Read the service worker's `pushsubscriptionchange` failure marker
 * from the `sw-diag` cache. Written by
 * `public/service-worker.js` when a background resubscribe fails,
 * consumed by `refresh()` above so the UI can raise a "re-enable
 * notifications" banner. Returns `null` if there's no marker, if the
 * cache isn't available (older browsers / SW disabled), or if the
 * stored blob is malformed.
 */
async function _readPushResubDiagnostic(): Promise<PushResubscribeFailure | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open("sw-diag");
    const res = await cache.match("/__push-resub-failed");
    if (!res) return null;
    const parsed = (await res.json()) as PushResubscribeFailure;
    if (
      parsed &&
      typeof parsed.at === "number" &&
      typeof parsed.reason === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function _clearPushResubDiagnostic(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open("sw-diag");
    await cache.delete("/__push-resub-failed");
  } catch {
    /* ignore — cache API isn't available or the entry is already gone */
  }
}

/**
 * Read the SW registrar's status blob. Written by
 * `public/sw-register.js`; consumed by `refresh()` so the /bot
 * diagnostics panel can render "Service Worker: active|failed(…)".
 */
async function _readSwRegisterStatus(): Promise<ServiceWorkerRegistrationStatus | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open("sw-diag");
    const res = await cache.match("/__sw-register-status");
    if (!res) return null;
    const parsed = (await res.json()) as ServiceWorkerRegistrationStatus;
    if (
      parsed &&
      typeof parsed.at === "number" &&
      typeof parsed.state === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Best-effort human-readable "why is the SW stuck" summary. Called
 * when `navigator.serviceWorker.ready` blows past its 10s deadline in
 * `enable()`. Combines two independent signals so the caller can craft
 * a single actionable error message instead of the historical "check
 * the console yourself":
 *
 *  1. The status blob written by `public/sw-register.js` into
 *     `caches.open('sw-diag')` — reveals whether register() itself
 *     failed and, if so, with what browser error.
 *  2. `navigator.serviceWorker.getRegistrations()` — reveals whether
 *     a registration exists at all and, if so, which lifecycle phase
 *     each of `installing` / `waiting` / `active` is in (a common
 *     stuck state is "installing forever" behind a slow `addAll`).
 *
 * Returns a short sentence starting with a capital letter and ending
 * with a period so the caller can concatenate it into the outer error
 * message without any grammar juggling. Never throws — every failure
 * path collapses to a generic hint.
 */
async function describeSwFailure(): Promise<string> {
  // Registrar-reported status. This is the most useful signal when
  // `register()` itself rejected — the reason string tells the user
  // exactly what the browser said.
  const swReg = await _readSwRegisterStatus();
  if (swReg?.state === "failed") {
    return `SW registration was rejected by the browser: ${swReg.reason ?? "unknown reason"}.`;
  }
  if (swReg?.state === "unsupported") {
    return "This browser doesn't expose navigator.serviceWorker at all — try Chrome/Edge/Firefox/Safari in a real browser tab (not an in-app webview).";
  }

  // Live registration list. When register() succeeded but the SW is
  // stuck mid-lifecycle, this tells us which phase it's in.
  try {
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof navigator.serviceWorker.getRegistrations === "function"
    ) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) {
        // register() may still be pending, but 10s in it's almost
        // always "the register call in sw-register.js hasn't run" —
        // typically because the load event never fired (the page is
        // still fetching a slow subresource) or the CSP blocked
        // /sw-register.js from loading.
        return "No SW registrations found for this origin — /sw-register.js may not have run yet (check the browser console for [sw-register] messages, and verify /sw-register.js is loading successfully in the Network tab).";
      }
      // Report the phase of the first registration in scope. Most
      // apps only have one; if there are more, the first is the one
      // controlling the current page.
      const first = regs[0]!;
      const phase =
        (first.active && "active") ||
        (first.installing && "installing") ||
        (first.waiting && "waiting") ||
        "unknown";
      if (phase === "installing") {
        return "The SW is stuck in the installing phase — usually a slow or hung network fetch inside the install handler (check the SW console under DevTools → Application → Service Workers).";
      }
      if (phase === "waiting") {
        return "A new SW is waiting to activate but an old one still controls the page — reload the tab to activate it.";
      }
      if (phase === "active") {
        // This branch is weird: the SW says it's active but
        // `navigator.serviceWorker.ready` didn't resolve. Usually a
        // race between the SW claiming clients and the promise
        // resolving; reloading fixes it.
        return "The SW reports as active but the browser hasn't linked it to this page yet — reload the tab to complete the handshake.";
      }
      return `SW is registered but in an unexpected phase (${phase}).`;
    }
  } catch (err) {
    // getRegistrations rejected — surface the raw message so the
    // operator has SOMETHING to search for.
    return `Couldn't inspect the SW registrations (${err instanceof Error ? err.message : String(err)}).`;
  }
  return "SW registration state couldn't be determined.";
}

/** URL-safe base64 (VAPID public key) → raw bytes for PushManager. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const EMPTY_DIAGNOSTICS: PushSupportDiagnostics = {
  isSecureContext: false,
  hasServiceWorker: false,
  hasPushManager: false,
  hasNotificationApi: false,
  isIos: false,
  isStandalone: false,
  isIosSafariNotPwa: false,
};

export function usePushNotifications() {
  const [status, setStatus] = React.useState<PushStatus>({
    supported: false,
    diagnostics: EMPTY_DIAGNOSTICS,
    permission: "unsupported",
    subscribed: false,
    publicKey: null,
    loading: true,
    error: null,
    devices: [],
    subscriberCount: 0,
    resubscribeFailure: null,
    swRegistration: null,
  });

  const diagnostics = React.useMemo(() => detectDiagnostics(), []);
  const supported = React.useMemo(
    () => detectSupport(diagnostics),
    [diagnostics],
  );

  const refresh = React.useCallback(async (): Promise<void> => {
    // Registrar status is orthogonal to `supported` — a phone that
    // fails capability probes can still have a stale SW from a prior
    // load, and vice versa a phone that passes probes can have SW
    // registration blocked (CSP, quota, incognito). Read it in both
    // branches so the diagnostics row is always accurate.
    const swRegistration = await _readSwRegisterStatus();
    if (!supported) {
      setStatus((s) => ({
        ...s,
        supported: false,
        diagnostics,
        loading: false,
        permission: readPermission(),
        swRegistration,
      }));
      return;
    }
    try {
      const res = await fetch("/api/push", { cache: "no-store" });
      const body = (await res.json()) as PushApiResponse | { error?: string };
      if (!res.ok || !("publicKey" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : `HTTP ${res.status}`,
        );
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      // Read the SW's resubscribe-failed marker, if any. Cleared as
      // soon as the client sees an active subscription again so the
      // banner disappears the moment the user re-enables.
      const resubscribeFailure = await _readPushResubDiagnostic();
      if (sub !== null && resubscribeFailure !== null) {
        // Best-effort cleanup — the browser is subscribed, so
        // whatever the SW hit last time is now moot. Don't await;
        // failure to delete just means the banner shows one extra
        // page load until the user reloads.
        void _clearPushResubDiagnostic();
      }

      setStatus({
        supported: true,
        diagnostics,
        permission: readPermission(),
        subscribed: sub !== null,
        publicKey: body.publicKey,
        loading: false,
        error: null,
        devices: body.subscriptions,
        subscriberCount: body.subscriberCount,
        resubscribeFailure: sub !== null ? null : resubscribeFailure,
        swRegistration,
      });
    } catch (err) {
      setStatus((s) => ({
        ...s,
        supported,
        diagnostics,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        swRegistration,
      }));
    }
  }, [supported, diagnostics]);

  React.useEffect(() => {
    void refresh();
    // The SW registrar in `public/sw-register.js` writes its status
    // marker after `window.load`, which typically fires AFTER our
    // first `refresh()` mount call. Re-read once at 1.5s so the
    // diagnostics panel picks up the "registered" (or "failed")
    // state without requiring a manual reload. One-shot — subsequent
    // renders don't need this because `refresh()` is exposed to the
    // UI (Test push button, Enable, etc.) and will pick it up.
    const t = window.setTimeout(() => {
      void refresh();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const enable = React.useCallback(async (): Promise<void> => {
    // Give the user actionable feedback for every blocker instead of a
    // generic "not supported". Historically we gated the Enable button
    // on `supported === false`, which meant the user could NEVER trigger
    // the permission prompt themselves — even in cases where our
    // detection was overly conservative (e.g., a fresh iOS PWA that
    // hadn't yet been recognised as standalone, or a browser we mis-
    // classified). Now the button is always clickable and we surface
    // the exact reason it can't proceed here, per capability.
    //
    // Order matters — the FIRST missing capability is the one worth
    // fixing, since the later ones can't matter until the earlier ones
    // are addressed.
    if (!diagnostics.isSecureContext) {
      throw new Error(
        "Web Push requires HTTPS. This page is loaded over an insecure origin. " +
          "Serve the app behind HTTPS (Caddy, Cloudflare Tunnel, ngrok, or a reverse " +
          "proxy) and reopen it on this device.",
      );
    }
    if (!diagnostics.hasNotificationApi) {
      throw new Error(
        "This browser doesn't expose the Notification API. Open the page in Chrome, " +
          "Edge, Firefox, or Safari 16.4+ (not an in-app webview).",
      );
    }
    if (!diagnostics.hasServiceWorker) {
      throw new Error(
        "This browser doesn't support Service Workers. Open the page in Chrome, " +
          "Edge, Firefox, or Safari (not an in-app webview like WeChat or Line).",
      );
    }
    if (!diagnostics.hasPushManager) {
      throw new Error(
        "This browser doesn't expose the Push API (PushManager). Try Chrome, Edge, " +
          "Firefox, or Safari 16.4+.",
      );
    }
    if (diagnostics.isIosSafariNotPwa) {
      throw new Error(
        "On iPhone / iPad, Web Push only works from a PWA installed to the Home Screen. " +
          "Tap the Share icon in Safari → Add to Home Screen → open the app from Home, " +
          "then tap Enable again.",
      );
    }

    // Ask permission first. iOS Safari specifically requires this call
    // to originate from a user gesture (button click), so callers must
    // wire `enable()` to an onClick handler — not a useEffect. The
    // permission prompt only appears when the current state is
    // "default"; if the user previously denied, we surface a clear
    // error pointing them at their browser settings.
    let perm: NotificationPermission = Notification.permission;
    if (perm !== "granted") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      setStatus((s) => ({ ...s, permission: perm as PermissionState }));
      if (perm === "denied") {
        throw new Error(
          "Notifications are blocked for this site. Open your browser settings for " +
            "this site, set Notifications to Allow, then reload this page and tap " +
            "Enable again.",
        );
      }
      // "default" typically means the user dismissed the prompt (e.g.
      // hit the browser-native "not now"). No permission change, but we
      // shouldn't proceed with subscribe either.
      throw new Error("You dismissed the permission prompt. Tap Enable again to retry.");
    }

    // The layout registers /service-worker.js on page load; `.ready`
    // resolves once *any* activated SW is available for this scope.
    //
    // Bound this with a deadline: `navigator.serviceWorker.ready`
    // NEVER rejects on failure — it just stays pending forever when
    // registration was blocked (CSP, quota, storage-disabled
    // incognito, corporate profile restrictions). Historically that
    // wedged `enable()` silently and the user saw the busy spinner
    // spin forever with no error message. 10s is well above the
    // wall-time even a cold register+install+activate takes; longer
    // than that means the SW isn't coming.
    //
    // On timeout, cross-reference the sw-diag cache written by
    // `/sw-register.js` and the live registration list so the error
    // spells out the specific stuck state ("registration failed with
    // reason X" vs "SW is still installing" vs "no registrations at
    // all") — that turns a generic "check the console yourself" into
    // an actionable one-line diagnosis for the user.
    const reg = await Promise.race<ServiceWorkerRegistration>([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration>((_, reject) =>
        setTimeout(async () => {
          const detail = await describeSwFailure();
          reject(
            new Error(
              `Service worker didn't become active within 10s. ${detail} ` +
                `Reload this page — if it persists, unregister the SW via DevTools → ` +
                `Application → Service Workers → Unregister, then reload.`,
            ),
          );
        }, 10_000),
      ),
    ]);

    // Fetch (or re-fetch) the VAPID public key. We could reuse the last
    // status snapshot but the initial subscribe often races the /api/push
    // GET, so an explicit fetch here is cheap and race-free.
    const keyRes = await fetch("/api/push", { cache: "no-store" });
    const keyBody = (await keyRes.json()) as PushApiResponse;
    if (!keyRes.ok || !keyBody.publicKey) {
      throw new Error("Server has no VAPID key configured yet.");
    }

    // Idempotent — if a sub already exists for this browser, PushManager
    // returns the same object. New browsers get a fresh one.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // TS's DOM lib types `applicationServerKey` as `BufferSource` backed
      // by a strict `ArrayBuffer`, but our helper returns `Uint8Array<ArrayBufferLike>`.
      // Cast is safe — PushManager only reads the byte view.
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyBody.publicKey) as BufferSource,
      });
    }

    // Post the subscription to the server, tagging it with a friendly
    // device label so the /bot page's device list is readable.
    const label = describeCurrentDevice();
    const postRes = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "subscribe",
        subscription: sub.toJSON(),
        label,
        userAgent: navigator.userAgent,
      }),
    });
    if (!postRes.ok) {
      const body = await postRes.json().catch(() => ({}));
      throw new Error(body?.error ?? `Server rejected subscription (HTTP ${postRes.status}).`);
    }

    await refresh();
    // Depends on `diagnostics` (each capability probe drives the
    // per-blocker error branches above) rather than the aggregated
    // `supported` boolean — the latter would rebuild the callback
    // whenever any bit changed even though the reads are through
    // the memoised `diagnostics` object.
  }, [diagnostics, refresh]);

  const disable = React.useCallback(async (): Promise<void> => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Best-effort tell the server first — if that fails we'd rather
      // keep the browser sub around for a retry than orphan the row.
      const endpoint = sub.endpoint;
      const postRes = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", endpoint }),
      });
      if (!postRes.ok) {
        const body = await postRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${postRes.status}`);
      }
      await sub.unsubscribe().catch(() => {});
    }
    await refresh();
  }, [supported, refresh]);

  const removeDevice = React.useCallback(
    async (endpoint: string): Promise<void> => {
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", endpoint }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    },
    [refresh],
  );

  const test = React.useCallback(async (): Promise<string> => {
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body?.detail ?? "Test push queued";
  }, []);

  return { status, refresh, enable, disable, removeDevice, test };
}

/**
 * Best-effort friendly device label like "Chrome on macOS" or "Safari
 * (iOS PWA)". Never precise — server-side we treat labels as a hint the
 * user can identify but not as a trust boundary.
 */
function describeCurrentDevice(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform =
    /Android/i.test(ua) ? "Android"
      : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
      : /Macintosh/i.test(ua) ? "macOS"
      : /Windows/i.test(ua) ? "Windows"
      : /Linux/i.test(ua) ? "Linux"
      : "Unknown";
  const browser =
    /Edg\//i.test(ua) ? "Edge"
      : /Chrome\//i.test(ua) ? "Chrome"
      : /Firefox\//i.test(ua) ? "Firefox"
      : /Safari\//i.test(ua) ? "Safari"
      : "Browser";
  const pwa =
    typeof window !== "undefined" &&
    "matchMedia" in window &&
    window.matchMedia("(display-mode: standalone)").matches;
  return pwa ? `${browser} on ${platform} (PWA)` : `${browser} on ${platform}`;
}
