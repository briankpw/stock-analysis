/**
 * Bot persistence — lightweight wrappers over the shared `getDb()`
 * connection. All calls are synchronous (SQLite via better-sqlite3).
 */

import { getDb } from "../db";
import type { Signal, StrategyKey } from "./strategy";

export interface StoredSignal {
  id: number;
  ticker: string;
  strategy: string;
  type: "BUY" | "SELL" | "HOLD";
  price: number | null;
  reason: string;
  barTs: string | null;
  createdAt: string;
  notified: boolean;
}

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

export const STATE_KEYS = {
  ENABLED: "bot.enabled",
  ACTIVE_STRATEGIES: "bot.active_strategies",
  LAST_TICK_AT: "bot.last_tick_at",
  LAST_TICK_STATUS: "bot.last_tick_status",
} as const;


// ---- Deduplication: only alert once per (ticker, strategy, bar_ts) --------
export function shouldNotify(ticker: string, signal: Signal): boolean {
  if (signal.type === "HOLD" || signal.barTs === null) return false;
  const row = getDb()
    .prepare(
      "SELECT bar_ts FROM strategy_last_bar WHERE ticker = ? AND strategy = ?",
    )
    .get(ticker, signal.strategy) as { bar_ts: string } | undefined;
  if (!row) return true;
  return row.bar_ts !== signal.barTs;
}

export function markNotified(ticker: string, signal: Signal): void {
  if (signal.barTs === null) return;
  getDb().prepare(
    "INSERT INTO strategy_last_bar (ticker, strategy, bar_ts) VALUES (?, ?, ?) " +
      "ON CONFLICT(ticker, strategy) DO UPDATE SET bar_ts = excluded.bar_ts",
  ).run(ticker, signal.strategy, signal.barTs);
}


// ---- Signal history --------------------------------------------------------
export function recordSignal(
  ticker: string,
  signal: Signal,
  opts: { notified: boolean },
): number {
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      "INSERT INTO signals (ticker, strategy, type, price, reason, bar_ts, created_at, notified) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      ticker,
      signal.strategy,
      signal.type,
      signal.price,
      signal.reason,
      signal.barTs,
      now,
      opts.notified ? 1 : 0,
    );
  return Number(info.lastInsertRowid);
}

export function recentSignals(ticker: string | null, limit = 100): StoredSignal[] {
  const rows = ticker
    ? (getDb()
        .prepare(
          "SELECT id, ticker, strategy, type, price, reason, bar_ts, created_at, notified FROM signals WHERE ticker = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(ticker, limit) as Array<Record<string, unknown>>)
    : (getDb()
        .prepare(
          "SELECT id, ticker, strategy, type, price, reason, bar_ts, created_at, notified FROM signals ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit) as Array<Record<string, unknown>>);

  return rows.map((r) => ({
    id: Number(r.id),
    ticker: String(r.ticker),
    strategy: String(r.strategy),
    type: r.type as StoredSignal["type"],
    price: r.price === null ? null : Number(r.price),
    reason: String(r.reason),
    barTs: r.bar_ts === null ? null : String(r.bar_ts),
    createdAt: String(r.created_at),
    notified: Boolean(r.notified),
  }));
}

export function clearHistory(ticker?: string): number {
  const stmt = ticker
    ? getDb().prepare("DELETE FROM signals WHERE ticker = ?").run(ticker)
    : getDb().prepare("DELETE FROM signals").run();
  return stmt.changes;
}


export const DEFAULT_ACTIVE_STRATEGIES: StrategyKey[] = [
  "sma_crossover",
  "rsi_reversion",
  "macd_cross",
];


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
 *   const release = tryLockTick("bot");
 *   if (!release) return { ok: false, error: "tick already running" };
 *   try { await runTickBody(); } finally { release(); }
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
