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
} as const;


// ---- Tick concurrency guard ------------------------------------------------
//
// Multiple in-flight ticks (worker loop + UI "Run now" button + another
// browser tab hammering the same endpoint) would double-fetch external
// APIs and can send duplicate Telegram alerts. We serialize them via a
// per-process mutex map. It's intentionally *in-memory* so a crashed
// process doesn't leave a stale DB lock behind that has to be cleared
// manually; the trade-off is that concurrency between UI and worker
// processes isn't prevented (they don't share memory). For this app's
// scale that's acceptable — the DB-level dedup rows keep behaviour
// correct even if two ticks somehow overlap.

const _tickLocks = new Set<string>();

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
  if (_tickLocks.has(name)) return null;
  _tickLocks.add(name);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _tickLocks.delete(name);
  };
}
