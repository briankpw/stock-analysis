/**
 * Web Push (RFC 8291 / VAPID) dispatcher.
 *
 * Design goals:
 *  * Zero-config for self-hosters — if the VAPID env vars are unset we
 *    auto-generate a key pair on first boot and persist it in `bot_state`.
 *    An operator who wants a fixed pair (e.g. for a horizontally scaled
 *    fleet) can supply VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars.
 *  * Sends fan out over EVERY stored subscription. Failures with 404/410
 *    (Gone/NotFound) auto-prune the offending row so the DB doesn't fill
 *    up with dead endpoints from users who uninstalled the PWA.
 *  * The runtime dependency (`web-push`) is required lazily via a dynamic
 *    import so the module can be safely imported by browser code paths
 *    (e.g. type-only re-exports) without dragging Node-only bindings into
 *    the client bundle. Not strictly necessary today but a cheap hedge.
 */

import type { PushSubscription as WebPushSubscription } from "web-push";

import { getState, setStateIfAbsent } from "./store";
import { runInTransaction } from "../db";
import {
  listPushSubscriptions,
  markPushDelivered,
  removePushSubscription,
} from "./push-store";

const STATE_KEYS = {
  VAPID_PUBLIC: "push.vapid.public",
  VAPID_PRIVATE: "push.vapid.private",
} as const;

const DEFAULT_SUBJECT = "mailto:noreply@stock-analysis.local";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Load VAPID credentials, falling back through:
 *   1. env vars (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)
 *   2. persisted keys in `bot_state`
 *   3. freshly generated pair, then persisted for next boot
 *
 * The subject must be a mailto:/https: URL — the RFC requires it. If the
 * operator sets a bogus one, `web-push` will 400 on send.
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  const envSubject = process.env.VAPID_SUBJECT?.trim() || DEFAULT_SUBJECT;

  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv, subject: envSubject };
  }

  const storedPub = getState<string | null>(STATE_KEYS.VAPID_PUBLIC, null);
  const storedPriv = getState<string | null>(STATE_KEYS.VAPID_PRIVATE, null);
  if (storedPub && storedPriv) {
    return { publicKey: storedPub, privateKey: storedPriv, subject: envSubject };
  }

  // First-boot key generation. We MUST NOT let two processes (UI +
  // worker) racing on cold start each generate their own pair and then
  // upsert — the loser would keep a stale pair in memory while the DB
  // canonicalises to the winner's, and subscriptions minted against
  // the loser's public key would fail forever with 401 from the push
  // service (which stores the applicationServerKey the browser saw at
  // subscribe time).
  //
  // Instead: generate a candidate, insert-if-absent both rows inside a
  // single SQLite transaction, and then trust the returned canonical
  // values. `setStateIfAbsent` is a compare-and-set that never
  // overwrites, so whoever writes first wins and every caller returns
  // the same pair.
  const webpush = await loadWebPush();
  const candidate = webpush.generateVAPIDKeys();
  const canonical = runInTransaction(() => ({
    publicKey: setStateIfAbsent(STATE_KEYS.VAPID_PUBLIC, candidate.publicKey),
    privateKey: setStateIfAbsent(STATE_KEYS.VAPID_PRIVATE, candidate.privateKey),
  }));
  return {
    publicKey: canonical.publicKey,
    privateKey: canonical.privateKey,
    subject: envSubject,
  };
}

/** True whenever we can sign a push — always, after first boot. */
export function webPushConfigured(): boolean {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return true;
  const storedPub = getState<string | null>(STATE_KEYS.VAPID_PUBLIC, null);
  const storedPriv = getState<string | null>(STATE_KEYS.VAPID_PRIVATE, null);
  return Boolean(storedPub && storedPriv);
}

// ---------------------------------------------------------------------------
// Endpoint allow-list — SSRF guard for /api/push subscribe
// ---------------------------------------------------------------------------

/**
 * Known Web Push service hosts.
 *
 * An entry that starts with "." means "any subdomain suffix of this
 * host"; anything else is an exact-match hostname. This list is
 * intentionally small — it covers every browser/OS that ships a real
 * push service today (Chrome/Chromium, Edge Chromium, Firefox, Safari
 * 16.4+, Windows PWAs). If a new push service is added we add its host
 * here; we do NOT accept arbitrary user-supplied URLs.
 *
 * Why this list matters — SSRF context
 * ------------------------------------
 * Without allow-listing, the POST /api/push endpoint accepts any URL
 * as a "push endpoint" and the server then dutifully POSTs
 * authenticated alert payloads (VAPID-signed) to it on every tick.
 * A visitor to a self-hosted instance (recall: `AUTH_ENABLED` defaults
 * to false) could therefore register:
 *   * `http://169.254.169.254/latest/meta-data/…` — AWS/GCP cloud
 *      metadata endpoint (credential exfil in a cloud deploy).
 *   * `http://127.0.0.1:6379/…` — talk to an internal Redis/other TCP
 *      service that happens to accept POST-shaped bytes.
 *   * `http://10.0.0.10/…` — reach any RFC1918 neighbour on the LAN.
 *   * `http://attacker.com/collect` — turn our server into a
 *      denial-of-service beacon or a request-signal exfil channel.
 * The allow-list + IP-literal reject below eliminates all four in a
 * single validation step at the ingress boundary.
 */
const ALLOWED_PUSH_HOST_SUFFIXES: readonly string[] = [
  // Google FCM — Chrome / Chromium / Edge Chromium / Android
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.googleapis.com",
  // Mozilla — Firefox desktop + Android
  "updates.push.services.mozilla.com",
  "autopush.services.mozilla.com",
  ".push.services.mozilla.com",
  // Apple — Safari 16.4+ Web Push
  "web.push.apple.com",
  // Microsoft WNS — Edge Legacy + native Windows PWAs
  ".notify.windows.com",
];

export interface PushEndpointValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a browser-supplied push endpoint URL. Rejects anything that
 * isn't (a) a well-formed HTTPS URL to (b) a hostname on our known
 * push-service allow-list, with (c) no IP literal in the hostname
 * (which would bypass the allow-list via DNS rebinding or a raw
 * private-range address).
 *
 * Returns a structured result so the caller can render the reject
 * reason for operators — the endpoint string itself is potentially
 * attacker-controlled, so DO NOT echo it back in the HTTP response
 * body.
 */
export function validatePushEndpoint(raw: string): PushEndpointValidation {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `only https:// is allowed (got ${url.protocol})` };
  }
  const host = url.hostname.toLowerCase();
  if (host.length === 0) {
    return { ok: false, reason: "missing hostname" };
  }
  // Any bare IP literal is out — real push services are always
  // addressed via DNS, and this closes SSRF against cloud metadata
  // (169.254.*), loopback (127.*, ::1), link-local (169.254.*, fe80::/10)
  // and every RFC1918 range in one check.
  if (isIpAddress(host)) {
    return { ok: false, reason: "IP-literal hostnames are not allowed" };
  }
  const matches = ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => {
    if (suffix.startsWith(".")) {
      // Suffix match — but require at least one non-empty label in
      // front so ".push.services.mozilla.com" doesn't accidentally
      // match "push.services.mozilla.com" (which is also fine, but
      // then it would need an explicit entry above).
      return host.length > suffix.length && host.endsWith(suffix);
    }
    return host === suffix;
  });
  if (!matches) {
    return { ok: false, reason: "host is not a recognised push service" };
  }
  return { ok: true };
}

/**
 * `true` for any hostname that is actually an IP address literal.
 * URLs quote IPv6 in square brackets but `URL.hostname` already strips
 * them, so IPv6 arrives here as the raw address string (which always
 * contains a colon — a legal DNS label never does).
 */
function isIpAddress(host: string): boolean {
  // IPv4 — four dot-separated groups of 1–3 digits. We don't bother
  // checking each group is ≤255 because the URL parser has already
  // normalised the address (invalid IPv4 fails at `new URL(...)`).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 — the only legal DNS name containing a colon is a punycode
  // artefact we don't need to worry about; treat any colon as IPv6.
  if (host.includes(":")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Payload shape received by the service worker
// ---------------------------------------------------------------------------

export interface WebPushPayload {
  /** Notification title (bold on Android; primary line on iOS). */
  title: string;
  /** One-to-three-line notification body. Plain text; the SW renders it. */
  body: string;
  /**
   * Notification tag — Android / iOS collapse notifications sharing the
   * same tag into a single row. We use it to keep bursts tidy: e.g. all
   * "AAPL news" alerts share `tag: "news:AAPL"` so a busy day for one
   * ticker doesn't stack ten notifications on the lock screen.
   */
  tag: string;
  /** Absolute or app-relative URL opened by the SW on notificationclick. */
  url: string;
  /** Optional data passed straight through to the SW. */
  data?: Record<string, unknown>;
}

export interface WebPushBatchResult {
  sent: number;
  failed: number;
  pruned: number;
  detail: string;
}

/**
 * Send `payload` to every stored subscription. Prunes rows that the push
 * service permanently rejects (404 / 410).
 */
export async function sendWebPushBatch(
  payload: WebPushPayload,
): Promise<WebPushBatchResult> {
  const rawSubs = listPushSubscriptions();
  if (rawSubs.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, detail: "no subscribers" };
  }

  // Defense-in-depth against legacy DB rows created *before* the
  // ingress-side allow-list was added — if such a row snuck in when
  // /api/push was still permissive, re-validate here and prune it
  // instead of sending our VAPID-signed payload to whatever
  // (potentially attacker-controlled) URL it points at. Auto-prune
  // rather than skip so the DB self-heals on the first tick after
  // upgrade.
  let legacyPruned = 0;
  const subs: typeof rawSubs = [];
  for (const s of rawSubs) {
    const check = validatePushEndpoint(s.endpoint);
    if (check.ok) {
      subs.push(s);
      continue;
    }
    console.warn(
      `[webpush] pruning legacy subscription with untrusted endpoint (${check.reason})`,
    );
    removePushSubscription(s.endpoint);
    legacyPruned += 1;
  }
  if (subs.length === 0) {
    return {
      sent: 0,
      failed: 0,
      pruned: legacyPruned,
      detail:
        legacyPruned > 0
          ? `no valid subscribers (pruned ${legacyPruned} untrusted)`
          : "no subscribers",
    };
  }

  const keys = await getVapidKeys();
  const webpush = await loadWebPush();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const body = JSON.stringify(payload);
  const delivered: string[] = [];
  let sent = 0;
  let failed = 0;
  let pruned = legacyPruned;
  const failReasons: string[] = [];

  // Fan out in parallel — most push services accept POSTs concurrently
  // and this keeps a tick with N subscribers roughly O(1) in wall time.
  //
  // Per-subscriber hard deadline: `web-push` uses raw `https.request`
  // under the hood with no default timeout, so a single push service
  // that accepts our TCP connection but never sends a response body
  // (real observed failure mode on FCM edge nodes during regional
  // outages) would otherwise wedge the entire notifier tick for the
  // Node default idle-timeout, which is effectively forever from a
  // bot-worker perspective. Racing each send against a 15 s deadline
  // caps the worst case at "one send timed out" rather than "no ticks
  // for the next hour". Timeouts are treated as `failed` but NOT as
  // `stale` — the subscription might be fine on the next tick.
  const PER_SUBSCRIBER_TIMEOUT_MS = 15_000;
  const results = await Promise.all(
    subs.map(async (s) => {
      const target: WebPushSubscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error("webpush: send timed out")),
          PER_SUBSCRIBER_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([
          webpush.sendNotification(target, body, {
            TTL: 3600,
            // `high` is what interactive alerts (chat, mail) use; it tells
            // the push service (FCM / APNs / Mozilla) to deliver the payload
            // immediately rather than deferring for battery. Required for
            // iOS PWA pushes to actually pop as a banner.
            urgency: "high",
          }),
          timeoutPromise,
        ]);
        return { ok: true as const, endpoint: s.endpoint };
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode ?? 0)
            : 0;
        const message =
          err && typeof err === "object" && "body" in err
            ? String((err as { body?: unknown }).body ?? "").slice(0, 120)
            : err instanceof Error
              ? err.message
              : String(err);
        // 404 (Not Found) and 410 (Gone) are permanent — the browser
        // uninstalled the SW or the user revoked permission. Drop the
        // row so we don't waste a POST every tick. Timeouts (status
        // stays 0, message includes "timed out") are treated as
        // transient — we keep the subscription so the next tick can
        // retry once the push service recovers.
        const stale = status === 404 || status === 410;
        return {
          ok: false as const,
          endpoint: s.endpoint,
          status,
          message,
          stale,
        };
      } finally {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      }
    }),
  );

  for (const r of results) {
    if (r.ok) {
      sent += 1;
      delivered.push(r.endpoint);
    } else {
      failed += 1;
      if (r.stale) {
        removePushSubscription(r.endpoint);
        pruned += 1;
      }
      failReasons.push(`${r.status || "err"}: ${r.message}`);
    }
  }

  markPushDelivered(delivered);

  const detail = failed === 0
    ? `sent to ${sent} device(s)`
    : `sent to ${sent}, ${failed} failed${pruned ? ` (${pruned} pruned)` : ""} — ${failReasons.slice(0, 3).join(" · ")}`;

  return { sent, failed, pruned, detail };
}

// ---------------------------------------------------------------------------
// Lazy loader — see file header for rationale.
// ---------------------------------------------------------------------------

type WebPushModule = typeof import("web-push");

let _module: WebPushModule | null = null;
async function loadWebPush(): Promise<WebPushModule> {
  if (_module) return _module;
  const mod = (await import("web-push")) as WebPushModule | { default: WebPushModule };
  _module = "default" in mod ? mod.default : (mod as WebPushModule);
  return _module;
}
