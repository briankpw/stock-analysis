/**
 * Shared "is this event recent enough to alert on?" gate.
 *
 * Every notification pipeline (news / stock insider / portfolio) fetches
 * a rolling backlog from upstream on each tick, and those sources
 * occasionally surface stale rows for the first time:
 *
 *   * Yahoo re-syndicates old headlines when a wire service picks them up
 *     again, so the same story from 3 weeks ago can appear as "new".
 *   * SEC posts late Form 4 amendments (`4/A`) whose transactionDate
 *     is months in the past.
 *   * House Clerk PTRs land 30–45 days after the trade — the disclosure
 *     is fresh but the underlying trade isn't.
 *
 * Without a floor, users get pinged about ancient activity they no
 * longer consider actionable. This module supplies a single per-tick
 * age check every engine can call before it hands anything to the
 * notifier.
 *
 * Configuration:
 *
 *   * `BOT_NOTIFY_MAX_AGE_DAYS` env var (default 2 = today + yesterday
 *     in UTC).  0 or negative disables the gate entirely.
 *
 * Semantics:
 *
 *   * Callers pass the most-relevant date they have. `null` / undefined
 *     / unparseable strings pass the gate (we don't drop events whose
 *     date we couldn't decode — better a rare noisy alert than a silent
 *     miss).
 *   * The gate is *inclusive* on the cutoff instant, so an event dated
 *     exactly `now - maxAgeDays * 24h` is still considered recent.
 */

import { settings } from "../config";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when `ts` is within the configured recency window (or when we
 * can't tell). Pass an ISO-8601 timestamp *or* a bare `YYYY-MM-DD` date
 * string; both parse cleanly through the JS `Date` constructor.
 */
export function isEventRecent(
  ts: string | null | undefined,
  maxAgeDays: number = settings.bot.notifyMaxAgeDays,
): boolean {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return true;
  if (!ts) return true;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return true;
  const cutoff = Date.now() - maxAgeDays * DAY_MS;
  return t >= cutoff;
}

/**
 * Pick the "when did this actually happen" timestamp for a portfolio
 * event. For 13F filings the report period is the quarter-end (always
 * stale) so we intentionally prefer the filing date; otherwise the
 * trade date is the most faithful signal and filing date is the safety
 * net for rows that didn't carry one.
 */
export function portfolioEventDate(event: {
  category: "people" | "politicians" | "funds";
  tradeDate: string | null;
  filingDate: string | null;
}): string | null {
  if (event.category === "funds") return event.filingDate ?? event.tradeDate;
  return event.tradeDate ?? event.filingDate;
}
