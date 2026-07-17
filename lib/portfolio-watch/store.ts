/**
 * Persistence for the portfolio-watch feature.
 *
 * Two tables live in the same SQLite file as the rest of the app (see
 * `lib/db.ts`):
 *
 *   - `portfolio_watches`       — active watch rules
 *   - `portfolio_notifications` — history of every alert sent; primary
 *                                  key is the event `id` so it doubles as
 *                                  a dedup surface.
 */

import { getDb } from "@/lib/db";
import type { EventAction, EventCategory, PortfolioEvent } from "./events";

export type WatchKind = "person" | "ticker";
export const ALL_ACTIONS: EventAction[] = ["BUY", "SELL"];

export interface PortfolioWatch {
  id: number;
  kind: WatchKind;
  category: EventCategory | null;   // set for kind='person'
  presetId: string | null;          // set for kind='person'
  ticker: string | null;            // set for kind='ticker'
  actions: EventAction[];
  createdAt: string;
}

export interface StoredNotification {
  eventId: string;
  category: EventCategory;
  presetId: string;
  presetName: string;
  ticker: string | null;
  companyName: string;
  action: EventAction;
  actionLabel: string;
  tradeDate: string | null;
  filingDate: string | null;
  amountLabel: string | null;
  sourceUrl: string | null;
  matchedWatches: string[];  // e.g. ["person:23", "ticker:41"]
  notifiedAt: string;
  telegramOk: boolean | null;
  telegramDetail: string | null;
}

// ---------------------------------------------------------------------------
// Watch CRUD
// ---------------------------------------------------------------------------

export function listWatches(): PortfolioWatch[] {
  const rows = getDb()
    .prepare(
      "SELECT id, kind, category, preset_id, ticker, actions_json, created_at " +
        "FROM portfolio_watches ORDER BY created_at DESC",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWatch);
}

export function findPersonWatch(
  category: EventCategory,
  presetId: string,
): PortfolioWatch | null {
  const row = getDb()
    .prepare(
      "SELECT id, kind, category, preset_id, ticker, actions_json, created_at " +
        "FROM portfolio_watches WHERE kind = 'person' AND category = ? AND preset_id = ?",
    )
    .get(category, presetId) as Record<string, unknown> | undefined;
  return row ? rowToWatch(row) : null;
}

export function findTickerWatch(ticker: string): PortfolioWatch | null {
  const row = getDb()
    .prepare(
      "SELECT id, kind, category, preset_id, ticker, actions_json, created_at " +
        "FROM portfolio_watches WHERE kind = 'ticker' AND ticker = ?",
    )
    .get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
  return row ? rowToWatch(row) : null;
}

/**
 * Add or refresh a watch. Same (kind, category, preset_id, ticker) tuple
 * is upserted (the UNIQUE index keeps it deterministic) and the returned
 * row reflects the final state.
 */
export function upsertPersonWatch(
  category: EventCategory,
  presetId: string,
  actions: EventAction[] = ALL_ACTIONS,
): PortfolioWatch {
  const existing = findPersonWatch(category, presetId);
  if (existing) return updateActions(existing.id, actions);
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      "INSERT INTO portfolio_watches (kind, category, preset_id, ticker, actions_json, created_at) " +
        "VALUES ('person', ?, ?, NULL, ?, ?)",
    )
    .run(category, presetId, JSON.stringify(actions), now);
  return {
    id: Number(info.lastInsertRowid),
    kind: "person",
    category,
    presetId,
    ticker: null,
    actions: [...actions],
    createdAt: now,
  };
}

export function upsertTickerWatch(
  ticker: string,
  actions: EventAction[] = ALL_ACTIONS,
): PortfolioWatch {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  const existing = findTickerWatch(symbol);
  if (existing) return updateActions(existing.id, actions);
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(
      "INSERT INTO portfolio_watches (kind, category, preset_id, ticker, actions_json, created_at) " +
        "VALUES ('ticker', NULL, NULL, ?, ?, ?)",
    )
    .run(symbol, JSON.stringify(actions), now);
  return {
    id: Number(info.lastInsertRowid),
    kind: "ticker",
    category: null,
    presetId: null,
    ticker: symbol,
    actions: [...actions],
    createdAt: now,
  };
}

export function updateActions(id: number, actions: EventAction[]): PortfolioWatch {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE portfolio_watches SET actions_json = ?, created_at = ? WHERE id = ?",
    )
    .run(JSON.stringify(actions), now, id);
  const row = getDb()
    .prepare(
      "SELECT id, kind, category, preset_id, ticker, actions_json, created_at " +
        "FROM portfolio_watches WHERE id = ?",
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Watch ${id} not found`);
  return rowToWatch(row);
}

export function deleteWatch(id: number): boolean {
  const info = getDb()
    .prepare("DELETE FROM portfolio_watches WHERE id = ?")
    .run(id);
  return info.changes > 0;
}

export function deletePersonWatch(
  category: EventCategory,
  presetId: string,
): boolean {
  const info = getDb()
    .prepare(
      "DELETE FROM portfolio_watches WHERE kind = 'person' AND category = ? AND preset_id = ?",
    )
    .run(category, presetId);
  return info.changes > 0;
}

export function deleteTickerWatch(ticker: string): boolean {
  const info = getDb()
    .prepare(
      "DELETE FROM portfolio_watches WHERE kind = 'ticker' AND ticker = ?",
    )
    .run(ticker.toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Notifications: dedup + history
// ---------------------------------------------------------------------------

/**
 * Which of the given event ids have NOT yet been notified. Callers pass
 * a batch to avoid a query per row.
 */
export function pickUnnotifiedEventIds(eventIds: string[]): Set<string> {
  if (eventIds.length === 0) return new Set();
  const placeholders = eventIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT event_id FROM portfolio_notifications WHERE event_id IN (${placeholders})`,
    )
    .all(...eventIds) as Array<{ event_id: string }>;
  const seen = new Set(rows.map((r) => r.event_id));
  return new Set(eventIds.filter((id) => !seen.has(id)));
}

export function recordNotification(
  event: PortfolioEvent,
  matchedWatches: string[],
  telegramOk: boolean | null,
  telegramDetail: string | null,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO portfolio_notifications " +
        "(event_id, category, preset_id, preset_name, ticker, company_name, " +
        " action, action_label, trade_date, filing_date, amount_label, " +
        " source_url, matched_watches_json, notified_at, telegram_ok, telegram_detail) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(event_id) DO NOTHING",
    )
    .run(
      event.id,
      event.category,
      event.presetId,
      event.presetName,
      event.ticker,
      event.companyName,
      event.action,
      event.actionLabel,
      event.tradeDate,
      event.filingDate,
      event.amountLabel,
      event.sourceUrl,
      JSON.stringify(matchedWatches),
      now,
      telegramOk === null ? null : telegramOk ? 1 : 0,
      telegramDetail,
    );
}

export function recentNotifications(limit = 100): StoredNotification[] {
  const rows = getDb()
    .prepare(
      "SELECT event_id, category, preset_id, preset_name, ticker, company_name, " +
        "action, action_label, trade_date, filing_date, amount_label, source_url, " +
        "matched_watches_json, notified_at, telegram_ok, telegram_detail " +
        "FROM portfolio_notifications ORDER BY notified_at DESC LIMIT ?",
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToNotification);
}

export function clearNotifications(): number {
  const info = getDb()
    .prepare("DELETE FROM portfolio_notifications")
    .run();
  return info.changes;
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

function rowToWatch(row: Record<string, unknown>): PortfolioWatch {
  let actions: EventAction[] = [...ALL_ACTIONS];
  const raw = row.actions_json;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as string[];
      actions = parsed.filter(
        (a): a is EventAction => a === "BUY" || a === "SELL",
      );
    } catch {
      /* fall through to default */
    }
  }
  return {
    id: Number(row.id),
    kind: String(row.kind) as WatchKind,
    category: (row.category as EventCategory | null) ?? null,
    presetId: (row.preset_id as string | null) ?? null,
    ticker: (row.ticker as string | null) ?? null,
    actions: actions.length > 0 ? actions : [...ALL_ACTIONS],
    createdAt: String(row.created_at),
  };
}

function rowToNotification(row: Record<string, unknown>): StoredNotification {
  let matched: string[] = [];
  const raw = row.matched_watches_json;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) matched = parsed.map(String);
    } catch {
      /* ignore */
    }
  }
  return {
    eventId: String(row.event_id),
    category: row.category as EventCategory,
    presetId: String(row.preset_id),
    presetName: String(row.preset_name),
    ticker: (row.ticker as string | null) ?? null,
    companyName: String(row.company_name ?? ""),
    action: row.action as EventAction,
    actionLabel: String(row.action_label),
    tradeDate: (row.trade_date as string | null) ?? null,
    filingDate: (row.filing_date as string | null) ?? null,
    amountLabel: (row.amount_label as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    matchedWatches: matched,
    notifiedAt: String(row.notified_at),
    telegramOk:
      row.telegram_ok === null || row.telegram_ok === undefined
        ? null
        : Boolean(row.telegram_ok),
    telegramDetail: (row.telegram_detail as string | null) ?? null,
  };
}
