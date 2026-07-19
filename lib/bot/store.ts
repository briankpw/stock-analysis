/**
 * Bot persistence — lightweight wrappers over the shared `getDb()`
 * connection. All calls are synchronous (SQLite via better-sqlite3).
 *
 * Historically also held the strategy-signal history (`signals` table)
 * and per-strategy dedup (`strategy_last_bar` table) used by the
 * removed SMA/RSI/MACD strategy tick. Those tables are left in place
 * for backward-compatibility with existing DBs, but nothing in the
 * app writes to or reads from them any more — see the comment in
 * `lib/bot/engine.ts` for the rationale.
 */

import { getDb } from "../db";

// ---- Generic JSON key/value store -----------------------------------------
export function getState<T>(key: string, fallback: T): T {
  const row = getDb()
    .prepare("SELECT value FROM bot_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setState<T>(key: string, value: T): void {
  const now = new Date().toISOString();
  getDb().prepare(
    "INSERT INTO bot_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, JSON.stringify(value), now);
}

/**
 * Write `value` under `key` ONLY if no row exists yet. Returns the value
 * that ended up in the DB — either the one we just wrote, or whatever was
 * there already if another caller beat us to it.
 *
 * Semantically equivalent to a compare-and-swap for the "initialize-once"
 * case. Used for VAPID keys and any other secret that must survive a
 * cold-start race between the UI process and the worker process without
 * ending up with two callers holding divergent values.
 */
export function setStateIfAbsent<T>(key: string, value: T): T {
  const now = new Date().toISOString();
  // `INSERT OR IGNORE` skips the row when the PRIMARY KEY already exists —
  // that's what makes this atomic under concurrent writers.
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)",
    )
    .run(key, JSON.stringify(value), now);
  const row = getDb()
    .prepare("SELECT value FROM bot_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return value; // Shouldn't happen — we just inserted or it was there.
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return value;
  }
}

// State-key catalogue used by the worker loop + Bot control endpoint.
//
// `LAST_TICK_AT` used to be the strategy-tick heartbeat; after the
// strategy path was retired we repurposed it as the *worker-loop*
// heartbeat (written at the end of each full cycle in `runForever`),
// so the UI's "Last tick" indicator keeps its meaning without any
// migration.
export const STATE_KEYS = {
  ENABLED: "bot.enabled",
  LAST_TICK_AT: "bot.last_tick_at",
  /** ISO timestamp of the last successful retention prune. Used by
   *  `lib/bot/retention.ts` to enforce the once-per-day gate. */
  LAST_RETENTION_PRUNE_AT: "bot.last_retention_prune_at",
  /** ISO timestamp of the last successful SQLite hot-backup. Used
   *  by `lib/bot/backup.ts` to enforce its once-per-day gate. */
  LAST_BACKUP_AT: "bot.last_backup_at",
} as const;


// ---- Tick concurrency guard ------------------------------------------------
//
// Multiple in-flight ticks (worker loop + UI "Run now" button + another
// browser tab hammering the same endpoint) would double-fetch external
// APIs and can send duplicate Telegram alerts. Backed by the SQLite
// `bot_locks` table (v12 migration) so the guard survives across
// processes — the worker container and the UI container are two
// separate Node processes and the previous in-memory mutex only
// serialised WITHIN one of them.
//
// An in-memory `Set` still tracks locks acquired by THIS process so a
// crashed acquire path can't leak. On process crash the DB row is
// abandoned but auto-expires (`expires_at`); the next caller reads
// the expired row and takes it, avoiding the "manual DB cleanup"
// footgun.
//
// Concurrency contract:
//   * `INSERT` uses `OR IGNORE` — the SQLite writer lock makes this
//     an atomic compare-and-swap on the primary key.
//   * On lock acquisition we first purge any expired rows for the
//     same name, then attempt the insert. If insert returns
//     `changes: 0`, someone else holds a live lock and we return
//     null.
//   * Release deletes the row so the next tick can grab it
//     immediately (no waiting for the TTL to expire).

/**
 * How long a tick lock is valid before it's considered stale and
 * eligible for takeover. 15 minutes covers even the slowest
 * portfolios tick (a full politician-catalogue scan across dozens
 * of PDFs), and is short enough that a crashed worker recovers
 * within one poll cycle rather than requiring a restart.
 */
const TICK_LOCK_TTL_MS = 15 * 60 * 1000;

const _localTickLocks = new Set<string>();

/**
 * Try to acquire an exclusive lock for `name`. Returns a release function
 * on success and `null` if another caller already holds the lock.
 *
 * Usage:
 *
 *   const release = tryLockTick("technical");
 *   if (!release) return { ok: false, error: "tick already running" };
 *   try { await runBody(); } finally { release(); }
 */
export function tryLockTick(name: string): (() => void) | null {
  // Fast local-cache check — a process already holding this lock
  // shouldn't re-enter the DB round-trip.
  if (_localTickLocks.has(name)) return null;

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + TICK_LOCK_TTL_MS).toISOString();
  const db = getDb();

  // Purge any expired lock for this name so a crashed peer doesn't
  // block us forever. Same statement is safe when there's nothing to
  // delete.
  db.prepare("DELETE FROM bot_locks WHERE name = ? AND expires_at <= ?")
    .run(name, nowIso);

  // Atomic acquire — succeeds ONLY if the row didn't already exist.
  const info = db
    .prepare(
      "INSERT OR IGNORE INTO bot_locks (name, acquired_at, expires_at) VALUES (?, ?, ?)",
    )
    .run(name, nowIso, expiresIso);
  if (info.changes === 0) return null;

  _localTickLocks.add(name);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _localTickLocks.delete(name);
    try {
      db.prepare("DELETE FROM bot_locks WHERE name = ?").run(name);
    } catch (err) {
      // Don't throw from a release callback — a failed unlock will
      // auto-expire after TICK_LOCK_TTL_MS anyway. Log so ops
      // notice a chronic issue.
      // eslint-disable-next-line no-console
      console.error(`[bot.store] failed to release tick lock '${name}':`, err);
    }
  };
}
