/**
 * Persistence for the stock-watch feature (insider transactions at a
 * specific ticker). Two tables in the shared SQLite file:
 *
 *   - `stock_watches`        — active per-ticker watch rules
 *   - `stock_notifications`  — history of every alert sent; primary
 *                              key is the deterministic event id, so
 *                              inserts are also the dedup surface.
 */

import { getDb } from "@/lib/db";
import type { IssuerInsiderTransaction } from "./sec-issuer";

export type WatchAction = "BUY" | "SELL";
export const ALL_ACTIONS: WatchAction[] = ["BUY", "SELL"];

export interface StockWatch {
  ticker: string;
  cik: string | null;
  actions: WatchAction[];
  createdAt: string;
}

export interface StoredStockNotification {
  eventId: string;
  ticker: string;
  issuerCik: string | null;
  issuerName: string | null;
  reporterName: string;
  reporterCik: string | null;
  reporterRelation: string | null;
  action: WatchAction | "OTHER";
  actionLabel: string;
  shares: number | null;
  pricePerShare: number | null;
  tradeDate: string | null;
  filingDate: string | null;
  sourceUrl: string | null;
  notifiedAt: string;
  telegramOk: boolean | null;
  telegramDetail: string | null;
}

// ---------------------------------------------------------------------------
// Watch CRUD
// ---------------------------------------------------------------------------

export function listStockWatches(): StockWatch[] {
  const rows = getDb()
    .prepare(
      "SELECT ticker, cik, actions_json, created_at " +
        "FROM stock_watches ORDER BY created_at DESC",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWatch);
}

export function findStockWatch(ticker: string): StockWatch | null {
  const row = getDb()
    .prepare(
      "SELECT ticker, cik, actions_json, created_at " +
        "FROM stock_watches WHERE ticker = ?",
    )
    .get(ticker.trim().toUpperCase()) as Record<string, unknown> | undefined;
  return row ? rowToWatch(row) : null;
}

/**
 * Add or refresh a watch. Passing a fresh `cik` (e.g. after resolving
 * it from SEC's ticker map) upserts it too — useful when the initial
 * save happened before resolution finished.
 */
export function upsertStockWatch(
  ticker: string,
  actions: WatchAction[] = ALL_ACTIONS,
  cik: string | null = null,
): StockWatch {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  const now = new Date().toISOString();
  const existing = findStockWatch(symbol);
  const nextActions = actions.length > 0 ? actions : [...ALL_ACTIONS];
  const nextCik = cik ?? existing?.cik ?? null;
  if (existing) {
    getDb()
      .prepare(
        "UPDATE stock_watches SET cik = ?, actions_json = ? WHERE ticker = ?",
      )
      .run(nextCik, JSON.stringify(nextActions), symbol);
  } else {
    getDb()
      .prepare(
        "INSERT INTO stock_watches (ticker, cik, actions_json, created_at) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(symbol, nextCik, JSON.stringify(nextActions), now);
  }
  return {
    ticker: symbol,
    cik: nextCik,
    actions: [...nextActions],
    createdAt: existing?.createdAt ?? now,
  };
}

export function setStockWatchCik(ticker: string, cik: string): void {
  getDb()
    .prepare("UPDATE stock_watches SET cik = ? WHERE ticker = ?")
    .run(cik, ticker.trim().toUpperCase());
}

export function deleteStockWatch(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM stock_watches WHERE ticker = ?")
    .run(ticker.trim().toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Notifications: dedup + history
// ---------------------------------------------------------------------------

export function pickUnnotifiedStockEventIds(eventIds: string[]): Set<string> {
  if (eventIds.length === 0) return new Set();
  const placeholders = eventIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT event_id FROM stock_notifications WHERE event_id IN (${placeholders})`,
    )
    .all(...eventIds) as Array<{ event_id: string }>;
  const seen = new Set(rows.map((r) => r.event_id));
  return new Set(eventIds.filter((id) => !seen.has(id)));
}

export function recordStockNotification(
  tx: IssuerInsiderTransaction,
  telegramOk: boolean | null,
  telegramDetail: string | null,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO stock_notifications " +
        "(event_id, ticker, issuer_cik, issuer_name, reporter_name, reporter_cik, " +
        " reporter_relation, action, action_label, shares, price_per_share, " +
        " trade_date, filing_date, source_url, notified_at, telegram_ok, telegram_detail) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(event_id) DO NOTHING",
    )
    .run(
      tx.eventId,
      tx.ticker,
      tx.issuerCik,
      tx.issuerName,
      tx.reporterName,
      tx.reporterCik,
      tx.reporterRelation,
      tx.action,
      tx.actionLabel,
      Number.isFinite(tx.shares) ? tx.shares : null,
      tx.pricePerShare,
      tx.transactionDate,
      tx.filingDate,
      tx.filingUrl,
      now,
      telegramOk === null ? null : telegramOk ? 1 : 0,
      telegramDetail,
    );
}

export function recentStockNotifications(
  limit = 100,
): StoredStockNotification[] {
  const rows = getDb()
    .prepare(
      "SELECT event_id, ticker, issuer_cik, issuer_name, reporter_name, reporter_cik, " +
        "reporter_relation, action, action_label, shares, price_per_share, trade_date, " +
        "filing_date, source_url, notified_at, telegram_ok, telegram_detail " +
        "FROM stock_notifications ORDER BY notified_at DESC LIMIT ?",
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToNotification);
}

export function clearStockNotifications(): number {
  const info = getDb().prepare("DELETE FROM stock_notifications").run();
  return info.changes;
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

function rowToWatch(row: Record<string, unknown>): StockWatch {
  let actions: WatchAction[] = [...ALL_ACTIONS];
  const raw = row.actions_json;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as string[];
      actions = parsed.filter(
        (a): a is WatchAction => a === "BUY" || a === "SELL",
      );
    } catch {
      /* fall through to default */
    }
  }
  return {
    ticker: String(row.ticker),
    cik: (row.cik as string | null) ?? null,
    actions: actions.length > 0 ? actions : [...ALL_ACTIONS],
    createdAt: String(row.created_at),
  };
}

function rowToNotification(row: Record<string, unknown>): StoredStockNotification {
  const rawAction = String(row.action);
  const action: WatchAction | "OTHER" =
    rawAction === "BUY" || rawAction === "SELL" ? rawAction : "OTHER";
  return {
    eventId: String(row.event_id),
    ticker: String(row.ticker),
    issuerCik: (row.issuer_cik as string | null) ?? null,
    issuerName: (row.issuer_name as string | null) ?? null,
    reporterName: String(row.reporter_name),
    reporterCik: (row.reporter_cik as string | null) ?? null,
    reporterRelation: (row.reporter_relation as string | null) ?? null,
    action,
    actionLabel: String(row.action_label),
    shares:
      row.shares === null || row.shares === undefined
        ? null
        : Number(row.shares),
    pricePerShare:
      row.price_per_share === null || row.price_per_share === undefined
        ? null
        : Number(row.price_per_share),
    tradeDate: (row.trade_date as string | null) ?? null,
    filingDate: (row.filing_date as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    notifiedAt: String(row.notified_at),
    telegramOk:
      row.telegram_ok === null || row.telegram_ok === undefined
        ? null
        : Boolean(row.telegram_ok),
    telegramDetail: (row.telegram_detail as string | null) ?? null,
  };
}
