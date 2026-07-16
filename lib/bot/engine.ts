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
} from "./store";
import { notifySignal } from "./notifier";

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
    const notifyEligible = shouldNotify(ticker, signal);
    if (signal.type !== "HOLD") {
      report.signalsFired += 1;
      if (notifyEligible) {
        const res = await notifySignal(ticker, signal);
        recordSignal(ticker, signal, { notified: res.ok });
        markNotified(ticker, signal);
        if (res.ok) report.notifiesSent += 1;
        else report.errors.push(`notify(${key}): ${res.detail}`);
      } else {
        // Duplicate for this bar — record without notifying.
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
