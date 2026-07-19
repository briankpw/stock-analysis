/**
 * Retention prune tick — periodic cleanup of tables that accumulate
 * rows indefinitely.
 *
 * Every notification / event table in the app keeps rows forever
 * because:
 *   1. `event_id`-keyed dedup tables use the primary key to skip
 *      already-seen upstream events, so we can't just wipe by date.
 *   2. The `/bot` history views read from the same tables.
 *
 * On a hot install those tables were still small (~thousands of
 * rows), but the audit flagged that they'd cross into "slow index
 * scans + growing WAL" territory after ~1 year of continuous
 * uptime — especially on a laptop deployment where the DB file
 * lives on eMMC.
 *
 * This tick keeps only the most recent `RETENTION_DAYS` of history
 * per table. Older rows are dropped in a single transaction so
 * SQLite's WAL doesn't grow proportionally to the delete size. The
 * dedup contract is unaffected because the events those old rows
 * represented are older than every recency filter the notification
 * engines use (`BOT_NOTIFY_MAX_AGE_DAYS`, default 7 days) — so even
 * if the same event resurfaced after a prune, it'd be filtered out
 * as "too old" before the dedup check runs.
 *
 * Scheduled from `lib/bot/engine.ts` alongside the other ticks, but
 * only actually runs once per day (rate-limited via
 * `STATE_KEYS.LAST_RETENTION_PRUNE_AT`) — no reason to touch the DB
 * every minute for something this coarse.
 */

import { getDb, runInTransaction } from "../db";
import { tryLockTick, getState, setState, STATE_KEYS } from "./store";

/**
 * Rows older than this are eligible for deletion. Kept generous
 * (90 days) so the /bot history views stay meaningful for
 * quarterly reviews. See file header for why this doesn't affect
 * the notification dedup contract.
 */
const RETENTION_DAYS = 90;

/**
 * Minimum interval between prune runs. `null` on first boot means
 * "run immediately once", then every 24h thereafter.
 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The tables + timestamp columns we prune. Kept as data (not
 * repeated `execSQL` calls) so a new notification channel just needs
 * one entry here.
 */
const PRUNE_TARGETS: Array<{ table: string; column: string }> = [
  { table: "portfolio_notifications", column: "notified_at" },
  { table: "stock_notifications", column: "notified_at" },
  { table: "news_notifications", column: "notified_at" },
  // `news_items` isn't strictly a notification history table but
  // it's the biggest write-many-read-many table in the app and the
  // News page only shows the last ~4 weeks anyway; anything older
  // is dead weight.
  { table: "news_items", column: "first_seen_at" },
];

export interface RetentionTickReport {
  ranAt: string;
  /** True when we skipped because the daily interval hasn't elapsed. */
  skippedNotDue: boolean;
  /** True when another prune was already running (unlikely — locked). */
  skippedLocked: boolean;
  /** Rows deleted per table. */
  deleted: Record<string, number>;
  /** Any table-level failures we swallowed. */
  errors: string[];
}

/**
 * Bot-worker entrypoint. Idempotent — safe to call every tick; the
 * once-per-day gate is enforced here rather than requiring the
 * caller to compute it.
 */
export async function runRetentionTick(): Promise<RetentionTickReport> {
  const ranAt = new Date().toISOString();
  const empty: Omit<RetentionTickReport, "ranAt"> = {
    skippedNotDue: false,
    skippedLocked: false,
    deleted: {},
    errors: [],
  };

  // Once-per-day gate. Reading state is cheap; we do it before
  // acquiring the lock so we don't burn a DB write on the vast
  // majority of ticks that are just going to skip.
  const lastAtIso = getState<string | null>(
    STATE_KEYS.LAST_RETENTION_PRUNE_AT,
    null,
  );
  const lastAtMs = lastAtIso ? new Date(lastAtIso).getTime() : 0;
  if (lastAtMs && Date.now() - lastAtMs < PRUNE_INTERVAL_MS) {
    return { ranAt, ...empty, skippedNotDue: true };
  }

  const release = tryLockTick("retention-prune");
  if (!release) return { ranAt, ...empty, skippedLocked: true };

  const deleted: Record<string, number> = {};
  const errors: string[] = [];
  const cutoffIso = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    // Wrap all deletes in one transaction — a single WAL fsync per
    // run rather than N. `runInTransaction` is a thin wrapper
    // around `db.transaction()` that rethrows so we can surface
    // errors below.
    runInTransaction(() => {
      const db = getDb();
      for (const { table, column } of PRUNE_TARGETS) {
        try {
          // Table + column names are compile-time constants in this
          // module — never mixed with user input — so string
          // concatenation is safe here. `cutoffIso` is bound as a
          // parameter so no SQL injection surface either.
          const stmt = db.prepare(
            `DELETE FROM ${table} WHERE ${column} < ?`,
          );
          const info = stmt.run(cutoffIso);
          deleted[table] = info.changes ?? 0;
        } catch (err) {
          errors.push(
            `${table}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
          );
        }
      }
    });
    setState(STATE_KEYS.LAST_RETENTION_PRUNE_AT, new Date().toISOString());
    return { ranAt, skippedNotDue: false, skippedLocked: false, deleted, errors };
  } finally {
    release();
  }
}
