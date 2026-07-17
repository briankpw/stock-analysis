/**
 * Stock-watch engine.
 *
 * On each tick we:
 *   1. Load every active `stock_watches` row (one per ticker).
 *   2. Resolve any missing CIKs via SEC's ticker map.
 *   3. Fetch the most recent Form 4/4A/5 filings at each issuer's CIK.
 *   4. Filter to transactions matching the watch's BUY/SELL preferences.
 *   5. Filter to events NOT already in `stock_notifications` (dedup).
 *   6. Send Telegram + persist history.
 *
 * The tick is exposed as an ordinary async function so both the worker
 * loop and a manual "Run stock tick now" button can invoke it.
 */

import { notifyStockInsiderBatch } from "@/lib/bot/notifier";
import { getState, setState, tryLockTick } from "@/lib/bot/store";
import {
  fetchIssuerInsiderTransactions,
  type IssuerInsiderTransaction,
} from "./sec-issuer";
import {
  listStockWatches,
  pickUnnotifiedStockEventIds,
  recordStockNotification,
  setStockWatchCik,
  type StockWatch,
} from "./store";
import { resolveTickerCik } from "./ticker-cik";
import { runInTransaction } from "@/lib/db";

export const STOCK_STATE_KEYS = {
  LAST_TICK_AT: "stock.last_tick_at",
  LAST_TICK_STATUS: "stock.last_tick_status",
} as const;

export interface StockTickReport {
  ok: boolean;
  ranAt: string;
  watchCount: number;
  tickersProbed: number;
  transactionsSeen: number;
  transactionsMatched: number;
  notifiesSent: number;
  errors: string[];
}

/**
 * Load a watch's CIK from the row, or resolve it lazily via SEC's
 * ticker map and persist it back to the row for next tick.
 */
async function ensureCik(watch: StockWatch): Promise<string | null> {
  if (watch.cik) return watch.cik;
  try {
    const hit = await resolveTickerCik(watch.ticker);
    if (!hit) return null;
    setStockWatchCik(watch.ticker, hit.cik);
    return hit.cik;
  } catch {
    return null;
  }
}

// Cap Telegram spam. With per-ticker grouping enabled below, this caps
// the number of "batch" messages per tick — one per watched ticker with
// new insider activity. Each batch itself caps how many rows it renders
// (see `notifyStockInsiderBatch`), so the effective volume of events
// surfaced per tick is much higher than before.
const MAX_TELEGRAM_PER_TICK = 15;

export async function runStockTick(): Promise<StockTickReport> {
  const ranAt = new Date().toISOString();
  const report: StockTickReport = {
    ok: true,
    ranAt,
    watchCount: 0,
    tickersProbed: 0,
    transactionsSeen: 0,
    transactionsMatched: 0,
    notifiesSent: 0,
    errors: [],
  };

  const release = tryLockTick("stock");
  if (!release) {
    report.ok = false;
    report.errors.push("Another stock tick is already running.");
    return report;
  }
  try {
    return await runStockTickBody(ranAt, report);
  } finally {
    release();
  }
}

async function runStockTickBody(
  ranAt: string,
  report: StockTickReport,
): Promise<StockTickReport> {
  const watches = listStockWatches();
  report.watchCount = watches.length;
  if (watches.length === 0) {
    persistStatus(ranAt, report);
    return report;
  }

  const allTx: Array<{ tx: IssuerInsiderTransaction; watch: StockWatch }> = [];
  for (const w of watches) {
    const cik = await ensureCik(w);
    if (!cik) {
      report.errors.push(`${w.ticker}: SEC does not recognise this ticker`);
      continue;
    }
    try {
      const rep = await fetchIssuerInsiderTransactions(cik, w.ticker, 20);
      report.tickersProbed += 1;
      for (const tx of rep.transactions) allTx.push({ tx, watch: w });
    } catch (err) {
      report.errors.push(
        `${w.ticker}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  report.transactionsSeen = allTx.length;

  // Filter to actions the user actually wants (BUY / SELL).
  const eligible = allTx.filter(({ tx, watch }) => {
    if (tx.action === "OTHER") return false;
    return watch.actions.includes(tx.action);
  });
  report.transactionsMatched = eligible.length;

  // Dedup against notification history.
  const unnotified = pickUnnotifiedStockEventIds(
    eligible.map(({ tx }) => tx.eventId),
  );

  // Bucket unnotified transactions by ticker so multiple Form 4s filed
  // at the same issuer on the same tick collapse into a single Telegram
  // message. Preserves the arrival order within each ticker bucket.
  const byTicker = new Map<string, IssuerInsiderTransaction[]>();
  for (const { tx } of eligible) {
    if (!unnotified.has(tx.eventId)) continue;
    const list = byTicker.get(tx.ticker) ?? [];
    list.push(tx);
    byTicker.set(tx.ticker, list);
  }

  let sentBatches = 0;
  for (const [ticker, txs] of byTicker) {
    if (txs.length === 0) continue;

    let telegramOk: boolean | null = null;
    let telegramDetail: string | null = null;
    if (sentBatches < MAX_TELEGRAM_PER_TICK) {
      const res = await notifyStockInsiderBatch(ticker, txs);
      telegramOk = res.ok;
      telegramDetail = res.detail;
      if (res.ok) {
        sentBatches += 1;
        report.notifiesSent += 1;
      } else {
        report.errors.push(`telegram(${ticker} x${txs.length}): ${res.detail}`);
      }
    } else {
      telegramDetail = "skipped: per-tick cap reached";
    }

    // Persist a dedup row per transaction so the individual events won't
    // re-fire on the next tick, regardless of whether Telegram accepted
    // the batch (matches the old per-event behaviour). Batch inserts in
    // one transaction to avoid N WAL fsyncs on a busy tick.
    runInTransaction(() => {
      for (const tx of txs) {
        recordStockNotification(tx, telegramOk, telegramDetail);
      }
    });
  }

  persistStatus(ranAt, report);
  return report;
}

function persistStatus(ranAt: string, report: StockTickReport): void {
  setState(STOCK_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(STOCK_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    watchCount: report.watchCount,
    tickersProbed: report.tickersProbed,
    transactionsSeen: report.transactionsSeen,
    transactionsMatched: report.transactionsMatched,
    notifiesSent: report.notifiesSent,
    errors: report.errors,
  });
}

export interface StockTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    watchCount: number;
    tickersProbed: number;
    transactionsSeen: number;
    transactionsMatched: number;
    notifiesSent: number;
    errors: string[];
  } | null;
}

export function getStockTickState(): StockTickState {
  return {
    lastTickAt: getState<string | null>(STOCK_STATE_KEYS.LAST_TICK_AT, null),
    lastTickStatus: getState(STOCK_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}
