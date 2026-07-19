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
  });

  const diagnostics = React.useMemo(() => detectDiagnostics(), []);
  const supported = React.useMemo(
    () => detectSupport(diagnostics),
    [diagnostics],
  );

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!supported) {
      setStatus((s) => ({
        ...s,
        supported: false,
        diagnostics,
        loading: false,
        permission: readPermission(),
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
      });
    } catch (err) {
      setStatus((s) => ({
        ...s,
        supported,
        diagnostics,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [supported, diagnostics]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = React.useCallback(async (): Promise<void> => {
    if (!supported) {
      throw new Error("Push notifications aren't supported in this browser.");
    }

    // Ask permission first. iOS Safari specifically requires this call
    // to originate from a user gesture (button click), so callers must
    // wire `enable()` to an onClick handler — not a useEffect.
    let perm: NotificationPermission = Notification.permission;
    if (perm !== "granted") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      setStatus((s) => ({ ...s, permission: perm as PermissionState }));
      throw new Error("Notification permission denied.");
    }

    // The layout registers /service-worker.js on page load; `.ready`
    // resolves once *any* activated SW is available for this scope.
    const reg = await navigator.serviceWorker.ready;

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
  }, [supported, refresh]);

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
