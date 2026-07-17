/**
 * Persistence for the news-watch feature.
 *
 * Three tables in the shared SQLite file:
 *
 *   - `news_items`         — accumulated headlines (dedup by ticker+link)
 *   - `news_subscriptions` — active per-ticker subscriptions
 *   - `news_notifications` — history of every Telegram push (also
 *                            doubles as a dedup surface — primary key
 *                            is a deterministic event id).
 */

import { getDb } from "@/lib/db";
import type { ImpactLabel, SentimentLabel } from "@/lib/sentiment";

// ---------------------------------------------------------------------------
// news_items
// ---------------------------------------------------------------------------

export interface NewsItemInput {
  ticker: string;
  link: string;
  title: string;
  publisher: string | null;
  summary: string | null;
  publishedAt: string;
  score: number | null;
  label: SentimentLabel | null;
  impact: ImpactLabel | null;
}

export interface StoredNewsItem extends NewsItemInput {
  id: number;
  firstSeenAt: string;
}

/**
 * Upsert one item. Returns whether it was newly inserted (i.e. we had
 * never seen this (ticker, link) tuple before). Callers use this to
 * decide whether to send a Telegram notification.
 */
export function upsertNewsItem(input: NewsItemInput): { inserted: boolean } {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker || !input.link) return { inserted: false };
  const now = new Date().toISOString();

  // Try INSERT OR IGNORE — .changes tells us whether a row was actually
  // added (i.e. the (ticker, link) tuple was new).
  const info = getDb()
    .prepare(
      "INSERT OR IGNORE INTO news_items " +
        "(ticker, link, title, publisher, summary, published_at, score, label, impact, first_seen_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      ticker,
      input.link,
      input.title,
      input.publisher,
      input.summary,
      input.publishedAt,
      input.score,
      input.label,
      input.impact,
      now,
    );

  if (info.changes > 0) return { inserted: true };

  // Row already exists — refresh mutable fields (score can change if
  // the model updates; title very occasionally gets a small edit).
  getDb()
    .prepare(
      "UPDATE news_items SET title = ?, publisher = COALESCE(?, publisher), " +
        "summary = COALESCE(?, summary), score = COALESCE(?, score), " +
        "label = COALESCE(?, label), impact = COALESCE(?, impact) " +
        "WHERE ticker = ? AND link = ?",
    )
    .run(
      input.title,
      input.publisher,
      input.summary,
      input.score,
      input.label,
      input.impact,
      ticker,
      input.link,
    );
  return { inserted: false };
}

/**
 * Batch upsert convenience — returns the subset of inputs that were
 * newly inserted (i.e. rows the caller should consider notifying about).
 */
export function upsertNewsItems(
  items: NewsItemInput[],
): { insertedItems: NewsItemInput[] } {
  const inserted: NewsItemInput[] = [];
  const tx = getDb().transaction((rows: NewsItemInput[]) => {
    for (const r of rows) {
      const { inserted: isNew } = upsertNewsItem(r);
      if (isNew) inserted.push(r);
    }
  });
  tx(items);
  return { insertedItems: inserted };
}

/**
 * Most-recent-first headlines for a ticker. Sorted by `published_at`
 * descending. The News page uses this to render its accumulated list.
 */
export function recentNewsItems(
  ticker: string,
  limit = 200,
): StoredNewsItem[] {
  const t = ticker.trim().toUpperCase();
  const rows = getDb()
    .prepare(
      "SELECT id, ticker, link, title, publisher, summary, published_at, " +
        "score, label, impact, first_seen_at " +
        "FROM news_items WHERE ticker = ? ORDER BY published_at DESC LIMIT ?",
    )
    .all(t, limit) as Array<Record<string, unknown>>;
  return rows.map(rowToItem);
}

export function newsItemCount(ticker: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM news_items WHERE ticker = ?")
    .get(ticker.trim().toUpperCase()) as { n: number };
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// news_subscriptions
// ---------------------------------------------------------------------------

export interface NewsSubscription {
  ticker: string;
  createdAt: string;
}

export function listNewsSubscriptions(): NewsSubscription[] {
  const rows = getDb()
    .prepare(
      "SELECT ticker, created_at FROM news_subscriptions ORDER BY created_at DESC",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ticker: String(r.ticker),
    createdAt: String(r.created_at),
  }));
}

export function findNewsSubscription(ticker: string): NewsSubscription | null {
  const row = getDb()
    .prepare(
      "SELECT ticker, created_at FROM news_subscriptions WHERE ticker = ?",
    )
    .get(ticker.trim().toUpperCase()) as Record<string, unknown> | undefined;
  return row
    ? { ticker: String(row.ticker), createdAt: String(row.created_at) }
    : null;
}

/**
 * INSERT OR IGNORE — if the row already exists we don't touch
 * `created_at`, so `since …` on the UI stays accurate.
 */
export function upsertNewsSubscription(ticker: string): NewsSubscription {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) throw new Error("Ticker is required");
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO news_subscriptions (ticker, created_at) VALUES (?, ?)",
    )
    .run(symbol, now);
  return findNewsSubscription(symbol) ?? { ticker: symbol, createdAt: now };
}

export function deleteNewsSubscription(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM news_subscriptions WHERE ticker = ?")
    .run(ticker.trim().toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// news_notifications
// ---------------------------------------------------------------------------

export interface StoredNewsNotification {
  eventId: string;
  ticker: string;
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string;
  score: number | null;
  label: SentimentLabel | null;
  notifiedAt: string;
  telegramOk: boolean | null;
  telegramDetail: string | null;
}

export function newsEventId(ticker: string, link: string): string {
  return `news:${ticker.trim().toUpperCase()}:${link}`;
}

export function pickUnnotifiedNewsEventIds(
  eventIds: string[],
): Set<string> {
  if (eventIds.length === 0) return new Set();
  const placeholders = eventIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT event_id FROM news_notifications WHERE event_id IN (${placeholders})`,
    )
    .all(...eventIds) as Array<{ event_id: string }>;
  const seen = new Set(rows.map((r) => r.event_id));
  return new Set(eventIds.filter((id) => !seen.has(id)));
}

export function recordNewsNotification(
  item: NewsItemInput,
  telegramOk: boolean | null,
  telegramDetail: string | null,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO news_notifications " +
        "(event_id, ticker, title, publisher, link, published_at, score, label, " +
        " notified_at, telegram_ok, telegram_detail) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(event_id) DO NOTHING",
    )
    .run(
      newsEventId(item.ticker, item.link),
      item.ticker.trim().toUpperCase(),
      item.title,
      item.publisher,
      item.link,
      item.publishedAt,
      item.score,
      item.label,
      now,
      telegramOk === null ? null : telegramOk ? 1 : 0,
      telegramDetail,
    );
}

export function recentNewsNotifications(
  limit = 100,
): StoredNewsNotification[] {
  const rows = getDb()
    .prepare(
      "SELECT event_id, ticker, title, publisher, link, published_at, score, label, " +
        "notified_at, telegram_ok, telegram_detail " +
        "FROM news_notifications ORDER BY notified_at DESC LIMIT ?",
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map(rowToNotification);
}

export function clearNewsNotifications(): number {
  const info = getDb().prepare("DELETE FROM news_notifications").run();
  return info.changes;
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

function rowToItem(row: Record<string, unknown>): StoredNewsItem {
  const rawLabel = row.label;
  const rawImpact = row.impact;
  return {
    id: Number(row.id),
    ticker: String(row.ticker),
    link: String(row.link),
    title: String(row.title),
    publisher: (row.publisher as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    publishedAt: String(row.published_at),
    score:
      row.score === null || row.score === undefined ? null : Number(row.score),
    label: normalizeLabel(rawLabel),
    impact: normalizeImpact(rawImpact),
    firstSeenAt: String(row.first_seen_at),
  };
}

function rowToNotification(row: Record<string, unknown>): StoredNewsNotification {
  return {
    eventId: String(row.event_id),
    ticker: String(row.ticker),
    title: String(row.title),
    publisher: (row.publisher as string | null) ?? null,
    link: String(row.link),
    publishedAt: String(row.published_at),
    score:
      row.score === null || row.score === undefined ? null : Number(row.score),
    label: normalizeLabel(row.label),
    notifiedAt: String(row.notified_at),
    telegramOk:
      row.telegram_ok === null || row.telegram_ok === undefined
        ? null
        : Boolean(row.telegram_ok),
    telegramDetail: (row.telegram_detail as string | null) ?? null,
  };
}

function normalizeLabel(raw: unknown): SentimentLabel | null {
  if (raw === "bullish" || raw === "bearish" || raw === "neutral") return raw;
  return null;
}

function normalizeImpact(raw: unknown): ImpactLabel | null {
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return null;
}
