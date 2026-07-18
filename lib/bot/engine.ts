/**
 * Bot orchestration — one "tick" fetches history, evaluates every
 * enabled strategy, records signals + fires Telegram alerts.
 *
 * The worker process (`worker.mjs`) calls `runForever()`; the UI's
 * "Run a single tick" button calls `runTick()`.
 */

import { settings } from "../config";
import { fetchHistory } from "../data";
import type { Signal } from "./strategy";
import { STRATEGIES, type StrategyKey } from "./strategy";
import {
  DEFAULT_ACTIVE_STRATEGIES,
  markNotified,
  recordSignal,
  setState,
  STATE_KEYS,
  shouldNotify,
  getState,
  tryLockTick,
} from "./store";
import { notifySignalsBatch } from "./notifier";
import { runPortfolioTick } from "../portfolio-watch/engine";
import { runStockTick } from "../stock-watch/engine";
import { runNewsTick } from "../news-watch/engine";
import { runTechnicalTick } from "../technical-watch/engine";
import { runResonanceTick } from "../resonance-watch/engine";
import { runPortfolioRiskTick } from "../portfolio-risk/engine";

export interface TickReport {
  ok: boolean;
  ticker: string;
  ranAt: string;
  strategies: string[];
  signalsFired: number;
  notifiesSent: number;
  errors: string[];
}

export async function runTick(ticker: string): Promise<TickReport> {
  const report: TickReport = {
    ok: true,
    ticker,
    ranAt: new Date().toISOString(),
    strategies: [],
    signalsFired: 0,
    notifiesSent: 0,
    errors: [],
  };

  // Refuse overlapping ticks so a UI "Run now" click during the worker's
  // 15-min loop doesn't double-fetch Yahoo or double-send Telegram.
  const release = tryLockTick(`bot:${ticker}`);
  if (!release) {
    report.ok = false;
    report.errors.push("Another tick is already running for this ticker.");
    return report;
  }
  try {
    return await runTickBody(ticker, report);
  } finally {
    release();
  }
}

async function runTickBody(
  ticker: string,
  report: TickReport,
): Promise<TickReport> {
  const bars = await fetchHistory(
    ticker,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  ).catch((err: unknown) => {
    report.ok = false;
    report.errors.push(`history fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });

  if (bars.length === 0) {
    return report;
  }

  const active = getState<StrategyKey[]>(STATE_KEYS.ACTIVE_STRATEGIES, DEFAULT_ACTIVE_STRATEGIES);
  report.strategies = active;

  // First pass: run every strategy, classify each output into either
  // "notify-eligible" (fresh BUY/SELL for this bar) or "record only"
  // (HOLD, or a duplicate we already notified on this bar). We defer
  // Telegram sends so we can batch same-ticker signals into one message
  // — sending N separate notifications for N strategies firing at once
  // is exactly the kind of spam we want to avoid.
  const notifyBuffer: Array<{ key: StrategyKey; signal: Signal }> = [];
  const recordOnly: Array<{ signal: Signal }> = [];

  for (const key of active) {
    const fn = STRATEGIES[key];
    if (!fn) continue;
    let signal: Signal;
    try {
      signal = fn(bars);
    } catch (err) {
      report.errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (signal.type === "HOLD") continue;
    report.signalsFired += 1;
    if (shouldNotify(ticker, signal)) {
      notifyBuffer.push({ key, signal });
    } else {
      recordOnly.push({ signal });
    }
  }

  // Duplicates: persist without notifying (they were already delivered
  // on this bar).
  for (const { signal } of recordOnly) {
    recordSignal(ticker, signal, { notified: false });
  }

  // Fresh signals: send ONE Telegram message covering the whole batch,
  // then mark each individual signal as notified in the store. If the
  // batched send fails we still record the signals (with `notified:false`)
  // so shouldNotify() won't fire them again next tick after Telegram
  // recovers — the same behaviour as the previous per-signal path.
  if (notifyBuffer.length > 0) {
    const signals = notifyBuffer.map((n) => n.signal);
    const res = await notifySignalsBatch(ticker, signals);
    if (res.ok) {
      report.notifiesSent += 1;
      for (const { signal } of notifyBuffer) {
        recordSignal(ticker, signal, { notified: true });
        markNotified(ticker, signal);
      }
    } else {
      report.errors.push(`notify(batch:${notifyBuffer.map((n) => n.key).join(",")}): ${res.detail}`);
      for (const { signal } of notifyBuffer) {
        recordSignal(ticker, signal, { notified: false });
      }
    }
  }

  setState(STATE_KEYS.LAST_TICK_AT, report.ranAt);
  setState(STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.ok,
    ticker,
    signalsFired: report.signalsFired,
    notifiesSent: report.notifiesSent,
    errors: report.errors,
  });
  return report;
}


/**
 * Long-running loop used by the worker process. Sleeps
 * `BOT_POLL_INTERVAL_SECONDS` between ticks and swallows any per-tick error
 * so a transient Yahoo failure never brings the loop down.
 */
export async function runForever(ticker: string): Promise<void> {
  const interval = Math.max(60, settings.bot.pollIntervalSeconds) * 1000;
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      // eslint-disable-next-line no-console
      console.log("[worker] shutdown signal received; exiting after current tick");
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    const enabled = getState<boolean>(STATE_KEYS.ENABLED, true);
    if (enabled) {
      try {
        const report = await runTick(ticker);
        // eslint-disable-next-line no-console
        console.log(
          `[worker] tick ${report.ranAt} — ` +
            `signals=${report.signalsFired} notified=${report.notifiesSent} errors=${report.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] tick threw:", err);
      }
      // Portfolio-watch tick runs on the same cadence as the strategy
      // tick. Underlying report fetches are cached (portfolios TTL ~6h),
      // so this is cheap when nothing has changed.
      try {
        const pt = await runPortfolioTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] portfolio-tick ${pt.ranAt} — ` +
            `watches=${pt.watchCount} probed=${pt.presetsProbed} events=${pt.eventsSeen} ` +
            `matched=${pt.eventsMatched} notified=${pt.notifiesSent} errors=${pt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] portfolio-tick threw:", err);
      }
      // Stock-watch tick — per-ticker insider transaction alerts.
      // Independent from the portfolio one so a bad watch on either
      // side can't stall the other.
      try {
        const st = await runStockTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] stock-tick ${st.ranAt} — ` +
            `watches=${st.watchCount} probed=${st.tickersProbed} tx=${st.transactionsSeen} ` +
            `matched=${st.transactionsMatched} notified=${st.notifiesSent} errors=${st.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] stock-tick threw:", err);
      }
      // News-watch tick — subscribed tickers get Telegram on any new
      // headline. Also silently accumulates the DB history that the
      // News page reads back to the user.
      try {
        const nt = await runNewsTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] news-tick ${nt.ranAt} — ` +
            `subs=${nt.subscriptionCount} probed=${nt.tickersProbed} items=${nt.itemsSeen} ` +
            `new=${nt.itemsNew} notified=${nt.notifiesSent} errors=${nt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] news-tick threw:", err);
      }
      // Technical-signal alerts — per-ticker rules for scheduled
      // daily digests and on-change notifications. Independent of the
      // strategy/insider/news ticks so a bad rule can't stall them.
      try {
        const tt = await runTechnicalTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] technical-tick ${tt.ranAt} — ` +
            `alerts=${tt.alertCount} evaluated=${tt.tickersEvaluated} ` +
            `digests=${tt.digestsSent} changes=${tt.changesSent} errors=${tt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] technical-tick threw:", err);
      }
      // 6-Signal Resonance alerts — parallel to the technical-signal
      // path but driven off the resonance strategy. Isolated in its
      // own try so a bad rule doesn't cascade into either preceding
      // channel.
      try {
        const rt = await runResonanceTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] resonance-tick ${rt.ranAt} — ` +
            `alerts=${rt.alertCount} evaluated=${rt.tickersEvaluated} ` +
            `digests=${rt.digestsSent} changes=${rt.changesSent} errors=${rt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] resonance-tick threw:", err);
      }
      // Portfolio delisting / bankruptcy risk — walks every symbol
      // the client asked to monitor and fires a push when a fresh
      // critical/high signal emerges. Isolated so a Yahoo Finance
      // hiccup or bad ticker doesn't stall the other channels.
      try {
        const prt = await runPortfolioRiskTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] portfolio-risk-tick ${prt.ranAt} — ` +
            `watches=${prt.watchCount} evaluated=${prt.tickersEvaluated} ` +
            `risky=${prt.riskyCount} sent=${prt.notifiesSent} errors=${prt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] portfolio-risk-tick threw:", err);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("[worker] bot disabled — skipping tick");
    }
    // Sleep in short slices so we can react to SIGINT quickly.
    const deadline = Date.now() + interval;
    while (!stopping && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
