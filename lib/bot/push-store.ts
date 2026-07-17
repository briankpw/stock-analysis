/**
 * Persistence for Web Push (RFC 8291) subscriptions.
 *
 * One row per (endpoint) — endpoints are globally unique per browser
 * install, so this doubles as our device identifier. When a user installs
 * the PWA on their iPhone home screen and enables notifications, the
 * browser hands us a subscription object; we persist it here and the
 * worker later signs pushes to that endpoint with the app's VAPID keys.
 */

import { getDb } from "../db";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UpsertOptions {
  label?: string | null;
  userAgent?: string | null;
}

/**
 * Insert a subscription, or refresh its keys if a row already exists for
 * this endpoint. Endpoints can outlive their crypto keys (push services
 * occasionally rotate them via `pushsubscriptionchange`), so an upsert is
 * the right semantic.
 */
export function upsertPushSubscription(
  sub: PushSubscriptionInput,
  opts: UpsertOptions = {},
): StoredPushSubscription {
  const now = new Date().toISOString();
  const label = opts.label ?? null;
  const userAgent = opts.userAgent ?? null;

  getDb()
    .prepare(
      `INSERT INTO push_subscriptions
         (endpoint, p256dh, auth, label, user_agent, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         label = COALESCE(excluded.label, push_subscriptions.label),
         user_agent = COALESCE(excluded.user_agent, push_subscriptions.user_agent)`,
    )
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, label, userAgent, now);

  const row = getDb()
    .prepare(
      `SELECT endpoint, p256dh, auth, label, user_agent, created_at, last_used_at
         FROM push_subscriptions WHERE endpoint = ?`,
    )
    .get(sub.endpoint) as StoredPushSubscriptionRow;
  return rowToSub(row);
}

/** Remove a subscription by endpoint. Idempotent — returns rows deleted. */
export function removePushSubscription(endpoint: string): number {
  return getDb()
    .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`)
    .run(endpoint).changes;
}

/** List all live subscriptions, newest first. */
export function listPushSubscriptions(): StoredPushSubscription[] {
  const rows = getDb()
    .prepare(
      `SELECT endpoint, p256dh, auth, label, user_agent, created_at, last_used_at
         FROM push_subscriptions
         ORDER BY created_at DESC`,
    )
    .all() as StoredPushSubscriptionRow[];
  return rows.map(rowToSub);
}

/** True when at least one device has opted in. */
export function pushSubscriberCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`)
    .get() as { n: number };
  return row.n;
}

/** Bump `last_used_at` for a batch of endpoints after a successful send. */
export function markPushDelivered(endpoints: string[]): void {
  if (endpoints.length === 0) return;
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    `UPDATE push_subscriptions SET last_used_at = ? WHERE endpoint = ?`,
  );
  const tx = getDb().transaction((eps: string[]) => {
    for (const ep of eps) stmt.run(now, ep);
  });
  tx(endpoints);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface StoredPushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
}

function rowToSub(row: StoredPushSubscriptionRow): StoredPushSubscription {
  return {
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    label: row.label,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
