/**
 * Portfolio-watch engine.
 *
 * On each tick we:
 *   1. Load every active watch (person + ticker).
 *   2. Fetch the underlying report for each preset we need — reports are
 *      cached in `lib/portfolios.ts` so this is cheap when nothing has
 *      changed.
 *   3. Flatten reports to `PortfolioEvent`s.
 *   4. Match events against watches (buy/sell filters applied).
 *   5. Filter events that are already in `portfolio_notifications` (dedup).
 *   6. Send Telegram + persist history.
 *
 * The tick is exposed as an ordinary async function so both the worker
 * loop and the /api/bot "Run portfolio tick now" button can call it.
 */

import {
  fetchFund13F,
  fetchPersonInsiderReport,
  fetchPoliticianTrades,
  findFundPreset,
  findPersonPreset,
  findPoliticianPreset,
  DataSourceUnavailableError,
  type FundReport,
  type PersonReport,
  type PoliticianReport,
} from "@/lib/portfolios";
import { listPresets } from "@/lib/portfolios";
import { notifyPortfolioEvent } from "@/lib/bot/notifier";
import { getState, setState } from "@/lib/bot/store";
import type {
  EventAction,
  EventCategory,
  PortfolioEvent,
} from "./events";
import {
  fundEvents,
  insiderEvents,
  politicianEvents,
} from "./events";
import {
  listWatches,
  pickUnnotifiedEventIds,
  recordNotification,
  type PortfolioWatch,
} from "./store";

export const PORTFOLIO_STATE_KEYS = {
  LAST_TICK_AT: "portfolio.last_tick_at",
  LAST_TICK_STATUS: "portfolio.last_tick_status",
} as const;

export interface PortfolioTickReport {
  ok: boolean;
  ranAt: string;
  watchCount: number;
  presetsProbed: number;
  eventsSeen: number;
  eventsMatched: number;
  notifiesSent: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Target expansion — figure out which presets we need to fetch reports for
// based on the current set of watches.
// ---------------------------------------------------------------------------

interface Target {
  category: EventCategory;
  presetId: string;
}

function collectTargets(watches: PortfolioWatch[]): Target[] {
  const seen = new Map<string, Target>();
  const add = (t: Target) => {
    const key = `${t.category}:${t.presetId}`;
    if (!seen.has(key)) seen.set(key, t);
  };

  const hasTickerWatch = watches.some((w) => w.kind === "ticker");

  // Person watches → fetch that specific preset only.
  for (const w of watches) {
    if (w.kind === "person" && w.category && w.presetId) {
      add({ category: w.category, presetId: w.presetId });
    }
  }

  // Ticker watches → we don't know which preset traded a given ticker,
  // so probe every preset the user has (built-in + custom) in every
  // category that matters. Funds are quarterly so we still include them
  // (a matching ticker watch will fire on a new 13F containing the
  // symbol). This is O(all presets) per tick — cache saves us.
  if (hasTickerWatch) {
    const index = listPresets();
    for (const p of index.people) add({ category: "people", presetId: p.id });
    for (const p of index.politicians) add({ category: "politicians", presetId: p.id });
    for (const p of index.funds) add({ category: "funds", presetId: p.id });
  }

  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Watch matching — decide which watch rule(s) an event fires
// ---------------------------------------------------------------------------

function matchWatches(
  event: PortfolioEvent,
  watches: PortfolioWatch[],
): PortfolioWatch[] {
  const out: PortfolioWatch[] = [];
  for (const w of watches) {
    if (!w.actions.includes(event.action as EventAction)) continue;
    if (w.kind === "person") {
      if (
        w.category === event.category &&
        w.presetId === event.presetId
      ) {
        out.push(w);
      }
    } else if (w.kind === "ticker") {
      if (event.ticker && event.ticker.toUpperCase() === w.ticker) {
        out.push(w);
      }
    }
  }
  return out;
}

function describeWatches(watches: PortfolioWatch[]): string {
  if (watches.length === 0) return "unmatched";
  return watches
    .map((w) =>
      w.kind === "person"
        ? `person: ${w.category}/${w.presetId}`
        : `ticker: ${w.ticker}`,
    )
    .join(" + ");
}

// ---------------------------------------------------------------------------
// Report fetch (one target)
// ---------------------------------------------------------------------------

async function fetchEventsFor(target: Target): Promise<PortfolioEvent[]> {
  if (target.category === "politicians") {
    if (!findPoliticianPreset(target.presetId)) return [];
    const report: PoliticianReport = await fetchPoliticianTrades(target.presetId);
    return politicianEvents(report);
  }
  if (target.category === "people") {
    if (!findPersonPreset(target.presetId)) return [];
    const report: PersonReport = await fetchPersonInsiderReport(target.presetId);
    return insiderEvents(report);
  }
  // funds
  if (!findFundPreset(target.presetId)) return [];
  const report: FundReport = await fetchFund13F(target.presetId);
  return fundEvents(report);
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

export async function runPortfolioTick(): Promise<PortfolioTickReport> {
  const ranAt = new Date().toISOString();
  const report: PortfolioTickReport = {
    ok: true,
    ranAt,
    watchCount: 0,
    presetsProbed: 0,
    eventsSeen: 0,
    eventsMatched: 0,
    notifiesSent: 0,
    errors: [],
  };

  const watches = listWatches();
  report.watchCount = watches.length;
  if (watches.length === 0) {
    persistStatus(ranAt, report);
    return report;
  }

  const targets = collectTargets(watches);
  report.presetsProbed = targets.length;

  const allEvents: PortfolioEvent[] = [];
  for (const t of targets) {
    try {
      const evts = await fetchEventsFor(t);
      allEvents.push(...evts);
    } catch (err) {
      const source = `${t.category}/${t.presetId}`;
      if (err instanceof DataSourceUnavailableError) {
        report.errors.push(`${source}: source unreachable (${err.lastStatus})`);
      } else {
        report.errors.push(
          `${source}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  report.eventsSeen = allEvents.length;

  // Match + dedupe.
  interface Match {
    event: PortfolioEvent;
    watches: PortfolioWatch[];
  }
  const matches: Match[] = [];
  for (const evt of allEvents) {
    const hit = matchWatches(evt, watches);
    if (hit.length > 0) matches.push({ event: evt, watches: hit });
  }
  report.eventsMatched = matches.length;

  const unnotified = pickUnnotifiedEventIds(matches.map((m) => m.event.id));

  // Cap the number of Telegram messages per tick so a huge PTR batch on
  // first run doesn't flood the chat. The rest survive in the events
  // list (uncached, they'll re-appear next tick) so nothing is silently
  // lost — but we'll persist the dedup rows for skipped ones to avoid
  // sending them next tick either. Trade-off tuned for reliability.
  const MAX_TELEGRAM_PER_TICK = 20;
  let sentCount = 0;

  for (const { event, watches: matched } of matches) {
    if (!unnotified.has(event.id)) continue;

    let telegramOk: boolean | null = null;
    let telegramDetail: string | null = null;
    if (sentCount < MAX_TELEGRAM_PER_TICK) {
      const res = await notifyPortfolioEvent(event, describeWatches(matched));
      telegramOk = res.ok;
      telegramDetail = res.detail;
      if (res.ok) {
        sentCount += 1;
        report.notifiesSent += 1;
      } else {
        report.errors.push(`telegram(${event.id}): ${res.detail}`);
      }
    } else {
      telegramDetail = "skipped: per-tick cap reached";
    }

    recordNotification(
      event,
      matched.map((w) =>
        w.kind === "person"
          ? `person:${w.id}`
          : `ticker:${w.id}`,
      ),
      telegramOk,
      telegramDetail,
    );
  }

  persistStatus(ranAt, report);
  return report;
}

function persistStatus(ranAt: string, report: PortfolioTickReport): void {
  setState(PORTFOLIO_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(PORTFOLIO_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    watchCount: report.watchCount,
    presetsProbed: report.presetsProbed,
    eventsSeen: report.eventsSeen,
    eventsMatched: report.eventsMatched,
    notifiesSent: report.notifiesSent,
    errors: report.errors,
  });
}

export interface PortfolioTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    watchCount: number;
    presetsProbed: number;
    eventsSeen: number;
    eventsMatched: number;
    notifiesSent: number;
    errors: string[];
  } | null;
}

export function getPortfolioTickState(): PortfolioTickState {
  return {
    lastTickAt: getState<string | null>(PORTFOLIO_STATE_KEYS.LAST_TICK_AT, null),
    lastTickStatus: getState(PORTFOLIO_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}
