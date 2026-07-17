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
  const subs = listPushSubscriptions();
  if (subs.length === 0) {
    return { sent: 0, failed: 0, pruned: 0, detail: "no subscribers" };
  }

  const keys = await getVapidKeys();
  const webpush = await loadWebPush();
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);

  const body = JSON.stringify(payload);
  const delivered: string[] = [];
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const failReasons: string[] = [];

  // Fan out in parallel — most push services accept POSTs concurrently
  // and this keeps a tick with N subscribers roughly O(1) in wall time.
  const results = await Promise.all(
    subs.map(async (s) => {
      const target: WebPushSubscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webpush.sendNotification(target, body, {
          TTL: 3600,
          urgency: "normal",
        });
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
        // row so we don't waste a POST every tick.
        const stale = status === 404 || status === 410;
        return {
          ok: false as const,
          endpoint: s.endpoint,
          status,
          message,
          stale,
        };
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
