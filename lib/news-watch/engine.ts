/**
 * News-watch engine.
 *
 * On each tick we:
 *   1. Load every active news subscription (per ticker).
 *   2. Fetch the current Yahoo headlines for each.
 *   3. Score every item and upsert into `news_items` — the return value
 *      of `upsertNewsItem` tells us which links we hadn't seen before.
 *   4. For newly-inserted items, filter to those published AFTER the
 *      subscription's `created_at` (so first-time subscribers don't get
 *      spammed with historical headlines) AND absent from
 *      `news_notifications` (final dedup layer).
 *   5. Send Telegram + persist history.
 *
 * The tick is exposed as an ordinary async function so both the worker
 * loop and a manual "Run news tick now" button can invoke it.
 */

import { fetchNews, RateLimitedError } from "@/lib/data";
import { notifyNewsBatch } from "@/lib/bot/notifier";
import { getState, setState, tryLockTick } from "@/lib/bot/store";
import {
  impactFromScore,
  labelFromScore,
  scoreText,
} from "@/lib/sentiment";
import {
  listNewsSubscriptions,
  newsEventId,
  pickUnnotifiedNewsEventIds,
  recordNewsNotification,
  upsertNewsItems,
  type NewsItemInput,
  type NewsSubscription,
} from "./store";
import { runInTransaction } from "@/lib/db";

export const NEWS_STATE_KEYS = {
  LAST_TICK_AT: "news.last_tick_at",
  LAST_TICK_STATUS: "news.last_tick_status",
} as const;

export interface NewsTickReport {
  ok: boolean;
  ranAt: string;
  subscriptionCount: number;
  tickersProbed: number;
  itemsSeen: number;
  itemsNew: number;
  notifiesSent: number;
  errors: string[];
}

// Cap Telegram spam. With per-ticker grouping (below) this caps the
// number of "batch" messages per tick — one per subscribed ticker that
// picked up new headlines. Each batch itself caps how many headlines it
// renders (see `notifyNewsBatch`), so a bursty news day for a single
// ticker still fits in one message.
const MAX_TELEGRAM_PER_TICK = 15;

/**
 * Fetch + score Yahoo headlines for a ticker and hand back the
 * normalized `NewsItemInput` list. Rate-limit errors are swallowed
 * (caller decides how to surface).
 */
async function fetchScoredNews(
  ticker: string,
  limit = 25,
): Promise<NewsItemInput[]> {
  const raw = await fetchNews(ticker, limit);
  return raw.map((r) => {
    const combined = `${r.title}. ${r.summary}`.trim();
    const score = scoreText(combined);
    return {
      ticker,
      link: r.link,
      title: r.title,
      publisher: r.publisher || null,
      summary: r.summary || null,
      publishedAt: r.publishedAt,
      score: Math.round(score * 1000) / 1000,
      label: labelFromScore(score),
      impact: impactFromScore(score),
    };
  });
}

/**
 * Silent-seed the accumulated news for a ticker when a subscription
 * is first created. Upserts every current headline into `news_items`
 * without touching `news_notifications`, so `runNewsTick` treats the
 * whole batch as "seen" from tick #1.
 */
export async function seedNewsHistory(
  ticker: string,
): Promise<{ inserted: number; total: number }> {
  const t = ticker.trim().toUpperCase();
  if (!t) return { inserted: 0, total: 0 };
  try {
    const scored = await fetchScoredNews(t, 25);
    const { insertedItems } = upsertNewsItems(scored);
    return { inserted: insertedItems.length, total: scored.length };
  } catch (err) {
    if (err instanceof RateLimitedError) {
      // Skip silently — the next tick will try again.
      return { inserted: 0, total: 0 };
    }
    throw err;
  }
}

export async function runNewsTick(): Promise<NewsTickReport> {
  const ranAt = new Date().toISOString();
  const report: NewsTickReport = {
    ok: true,
    ranAt,
    subscriptionCount: 0,
    tickersProbed: 0,
    itemsSeen: 0,
    itemsNew: 0,
    notifiesSent: 0,
    errors: [],
  };

  const release = tryLockTick("news");
  if (!release) {
    report.ok = false;
    report.errors.push("Another news tick is already running.");
    return report;
  }
  try {
    return await runNewsTickBody(ranAt, report);
  } finally {
    release();
  }
}

async function runNewsTickBody(
  ranAt: string,
  report: NewsTickReport,
): Promise<NewsTickReport> {
  const subs = listNewsSubscriptions();
  report.subscriptionCount = subs.length;
  if (subs.length === 0) {
    persistStatus(ranAt, report);
    return report;
  }

  interface Candidate {
    item: NewsItemInput;
    subscription: NewsSubscription;
  }
  const candidates: Candidate[] = [];

  for (const sub of subs) {
    try {
      const scored = await fetchScoredNews(sub.ticker, 25);
      report.tickersProbed += 1;
      report.itemsSeen += scored.length;
      const { insertedItems } = upsertNewsItems(scored);
      report.itemsNew += insertedItems.length;
      for (const item of insertedItems) {
        // Only notify items published AFTER the subscription was
        // created. Prevents backfill spam if Yahoo suddenly starts
        // returning older headlines.
        if (item.publishedAt < sub.createdAt) continue;
        candidates.push({ item, subscription: sub });
      }
    } catch (err) {
      const detail = err instanceof RateLimitedError ? "rate-limited" : err instanceof Error ? err.message : String(err);
      report.errors.push(`${sub.ticker}: ${detail}`);
    }
  }

  // Final dedup — event id maps 1:1 with the (ticker, link) tuple, so
  // this only fires when a caller has already Telegram'd it via a
  // manual tick.
  const eventIds = candidates.map((c) => newsEventId(c.item.ticker, c.item.link));
  const unnotified = pickUnnotifiedNewsEventIds(eventIds);

  // Bucket unnotified headlines by ticker so a busy news day for AAPL
  // collapses to a single grouped Telegram message instead of one per
  // headline. Order within each bucket follows the fetch order (Yahoo
  // returns newest first).
  const byTicker = new Map<string, NewsItemInput[]>();
  for (const { item } of candidates) {
    const eid = newsEventId(item.ticker, item.link);
    if (!unnotified.has(eid)) continue;
    const list = byTicker.get(item.ticker) ?? [];
    list.push(item);
    byTicker.set(item.ticker, list);
  }

  let sentBatches = 0;
  for (const [ticker, items] of byTicker) {
    if (items.length === 0) continue;

    let telegramOk: boolean | null = null;
    let telegramDetail: string | null = null;
    if (sentBatches < MAX_TELEGRAM_PER_TICK) {
      const res = await notifyNewsBatch(ticker, items);
      telegramOk = res.ok;
      telegramDetail = res.detail;
      if (res.ok) {
        sentBatches += 1;
        report.notifiesSent += 1;
      } else {
        report.errors.push(`telegram(${ticker} x${items.length}): ${res.detail}`);
      }
    } else {
      telegramDetail = "skipped: per-tick cap reached";
    }

    // Record dedup per headline regardless of the batch outcome — this
    // mirrors the old per-event behaviour where skipped sends still
    // wrote a history row so we don't re-fire on the next tick. One
    // transaction per ticker bucket keeps this cheap under news floods.
    runInTransaction(() => {
      for (const item of items) {
        recordNewsNotification(item, telegramOk, telegramDetail);
      }
    });
  }

  persistStatus(ranAt, report);
  return report;
}

function persistStatus(ranAt: string, report: NewsTickReport): void {
  setState(NEWS_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(NEWS_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    subscriptionCount: report.subscriptionCount,
    tickersProbed: report.tickersProbed,
    itemsSeen: report.itemsSeen,
    itemsNew: report.itemsNew,
    notifiesSent: report.notifiesSent,
    errors: report.errors,
  });
}

export interface NewsTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    subscriptionCount: number;
    tickersProbed: number;
    itemsSeen: number;
    itemsNew: number;
    notifiesSent: number;
    errors: string[];
  } | null;
}

export function getNewsTickState(): NewsTickState {
  return {
    lastTickAt: getState<string | null>(NEWS_STATE_KEYS.LAST_TICK_AT, null),
    lastTickStatus: getState(NEWS_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}
