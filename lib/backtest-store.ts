/**
 * Persistence layer for the signal backtest history.
 *
 * See `lib/db.ts` v16 for the schema. This module is the single
 * source of truth for how backtest runs are inserted, listed, read,
 * and pruned — API routes go through here, never through raw SQL.
 *
 * ## Retention
 *
 * The `backtest_runs` table can grow without bound if users run many
 * long-period backtests (each `result_json` blob is tens to hundreds
 * of KB). To keep the DB file predictable we cap history at
 * `MAX_HISTORY_ROWS` (currently 100) and auto-purge the oldest rows
 * on every insert. That number is deliberately generous:
 *
 *   * Typical user runs a handful of backtests per week — a 100-row
 *     cap ≈ months of history.
 *   * Even at the max blob size (~250KB) that's ~25MB total, tiny
 *     relative to the other tables (portfolios, news, notifications).
 *
 * The cap is exposed as a constant so a future config-driven override
 * is a one-line change.
 *
 * ## API shape
 *
 * `saveRun` mirrors what the `/api/signal/backtest` route already
 * returns to clients — it takes the same top-level fields plus the
 * raw `BacktestResult` blob and persists them in one INSERT. Reads
 * come in two shapes:
 *
 *   * `listRuns` — summary rows (no result blob), for the history
 *     list. Fast, cheap; sorted newest-first.
 *   * `getRun` — one full row including the blob. Used when the user
 *     opens a past run.
 */

import { getDb } from "./db";
import type {
  BacktestConfig,
  BacktestResult,
  BacktestStrategy,
  ExecutionTiming,
} from "./signal-backtest";

/**
 * Maximum number of backtest runs kept per DB. See the module header
 * comment for the reasoning behind this specific number.
 */
export const MAX_HISTORY_ROWS = 100;

export type BacktestPeriod = "6mo" | "1y" | "2y" | "5y" | "10y" | "max";

/**
 * Summary row surfaced by `listRuns`. Everything the history list
 * needs to render without pulling the full result blob.
 */
export interface BacktestRunSummary {
  id: number;
  ticker: string;
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  period: BacktestPeriod;
  startingCash: number;
  label: string;
  totalReturn: number;
  buyHoldReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  winRate: number | null;
  firstBarAt: string;
  lastBarAt: string;
  createdAt: string;
}

/**
 * Full row shape — includes the config + result blob so a saved
 * page load can re-render everything the original run showed.
 */
export interface BacktestRunFull extends BacktestRunSummary {
  config: BacktestConfig;
  result: BacktestResult;
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface SaveRunInput {
  ticker: string;
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  period: BacktestPeriod;
  startingCash: number;
  /** Optional human label. Auto-generated when omitted. */
  label?: string;
  firstBarAt: string;
  lastBarAt: string;
  config: BacktestConfig;
  result: BacktestResult;
}

export function saveRun(input: SaveRunInput): BacktestRunSummary {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("ticker is required");
  const label =
    (input.label ?? "").trim() ||
    autoLabel(ticker, input.strategy, input.period);
  const now = new Date().toISOString();
  const db = getDb();
  return db.transaction((): BacktestRunSummary => {
    const info = db
      .prepare(
        "INSERT INTO backtest_runs (" +
          "ticker, strategy, execution, period, starting_cash, label, " +
          "config_json, result_json, total_return, buy_hold_return, " +
          "max_drawdown, trade_count, win_rate, first_bar_at, last_bar_at, " +
          "created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        ticker,
        input.strategy,
        input.execution,
        input.period,
        input.startingCash,
        label,
        JSON.stringify(input.config),
        JSON.stringify(input.result),
        input.result.metrics.totalReturn,
        input.result.metrics.buyHoldReturn,
        input.result.metrics.maxDrawdown,
        input.result.metrics.tradeCount,
        input.result.metrics.winRate,
        input.firstBarAt,
        input.lastBarAt,
        now,
      );
    const id = Number(info.lastInsertRowid);

    // Prune to the cap. We keep the newest N rows (by created_at DESC,
    // id DESC as a tiebreaker for rows landing in the same millisecond)
    // and drop everything past that. DELETE-by-subselect is a single
    // SQL statement so the whole "insert + prune" pair stays atomic
    // within the surrounding transaction.
    db.prepare(
      "DELETE FROM backtest_runs WHERE id IN (" +
        "SELECT id FROM backtest_runs " +
        "ORDER BY created_at DESC, id DESC " +
        "LIMIT -1 OFFSET ?" +
        ")",
    ).run(MAX_HISTORY_ROWS);

    return {
      id,
      ticker,
      strategy: input.strategy,
      execution: input.execution,
      period: input.period,
      startingCash: input.startingCash,
      label,
      totalReturn: input.result.metrics.totalReturn,
      buyHoldReturn: input.result.metrics.buyHoldReturn,
      maxDrawdown: input.result.metrics.maxDrawdown,
      tradeCount: input.result.metrics.tradeCount,
      winRate: input.result.metrics.winRate,
      firstBarAt: input.firstBarAt,
      lastBarAt: input.lastBarAt,
      createdAt: now,
    };
  })();
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List up to `limit` most-recent runs. When `ticker` is provided,
 * scope to that symbol only (case-insensitive — we normalise before
 * comparing). Reads don't include the large `result_json` blob so
 * the history list stays fast on decades of runs.
 */
export function listRuns(opts?: {
  ticker?: string;
  limit?: number;
}): BacktestRunSummary[] {
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 50));
  const ticker = opts?.ticker ? opts.ticker.trim().toUpperCase() : null;
  const rows = ticker
    ? (getDb()
        .prepare(
          "SELECT id, ticker, strategy, execution, period, starting_cash, " +
            "label, total_return, buy_hold_return, max_drawdown, " +
            "trade_count, win_rate, first_bar_at, last_bar_at, created_at " +
            "FROM backtest_runs WHERE ticker = ? " +
            "ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(ticker, limit) as BacktestRowRaw[])
    : (getDb()
        .prepare(
          "SELECT id, ticker, strategy, execution, period, starting_cash, " +
            "label, total_return, buy_hold_return, max_drawdown, " +
            "trade_count, win_rate, first_bar_at, last_bar_at, created_at " +
            "FROM backtest_runs " +
            "ORDER BY created_at DESC, id DESC LIMIT ?",
        )
        .all(limit) as BacktestRowRaw[]);
  return rows.map(rowToSummary);
}

/**
 * Load one run with its full config + result blobs, or `null` when
 * the id doesn't exist. Corrupt JSON in the DB throws — that's
 * intentional; the caller should surface a clear 500 rather than
 * silently returning an "empty" run.
 */
export function getRun(id: number): BacktestRunFull | null {
  const row = getDb()
    .prepare(
      "SELECT id, ticker, strategy, execution, period, starting_cash, " +
        "label, config_json, result_json, total_return, buy_hold_return, " +
        "max_drawdown, trade_count, win_rate, first_bar_at, last_bar_at, " +
        "created_at " +
        "FROM backtest_runs WHERE id = ?",
    )
    .get(id) as (BacktestRowRaw & {
      config_json: string;
      result_json: string;
    }) | undefined;
  if (!row) return null;
  return {
    ...rowToSummary(row),
    config: JSON.parse(row.config_json) as BacktestConfig,
    result: JSON.parse(row.result_json) as BacktestResult,
  };
}

/** Hard-delete one run. No-op when the id doesn't exist. */
export function deleteRun(id: number): void {
  getDb().prepare("DELETE FROM backtest_runs WHERE id = ?").run(id);
}

/** Wipe every row. Used by the "clear history" button. */
export function clearHistory(): number {
  const info = getDb().prepare("DELETE FROM backtest_runs").run();
  return info.changes;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BacktestRowRaw {
  id: number;
  ticker: string;
  strategy: string;
  execution: string;
  period: string;
  starting_cash: number;
  label: string;
  total_return: number;
  buy_hold_return: number;
  max_drawdown: number;
  trade_count: number;
  win_rate: number | null;
  first_bar_at: string;
  last_bar_at: string;
  created_at: string;
}

function rowToSummary(r: BacktestRowRaw): BacktestRunSummary {
  return {
    id: r.id,
    ticker: r.ticker,
    strategy: r.strategy as BacktestStrategy,
    execution: r.execution as ExecutionTiming,
    period: r.period as BacktestPeriod,
    startingCash: r.starting_cash,
    label: r.label,
    totalReturn: r.total_return,
    buyHoldReturn: r.buy_hold_return,
    maxDrawdown: r.max_drawdown,
    tradeCount: r.trade_count,
    winRate: r.win_rate,
    firstBarAt: r.first_bar_at,
    lastBarAt: r.last_bar_at,
    createdAt: r.created_at,
  };
}

function autoLabel(
  ticker: string,
  strategy: BacktestStrategy,
  period: BacktestPeriod,
): string {
  // Kept short enough to fit in the history list without truncation.
  // If we add more strategies these labels should stay 8 chars or less
  // — the row layout budget assumes it.
  const shortStrategy: Record<BacktestStrategy, string> = {
    technical: "Tech",
    resonance: "Resonance",
    master: "Master",
    sma_cross: "SMA-X",
    ema_cross: "EMA-X",
    macd_cross: "MACD-X",
    rsi_reversion: "RSI-Rev",
    kdj_cross: "KDJ-X",
    bbands_reversion: "BB-Rev",
    sr_bounce: "S/R",
  };
  return `${ticker} · ${shortStrategy[strategy]} · ${period}`;
}
