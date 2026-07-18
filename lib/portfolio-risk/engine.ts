/**
 * Portfolio delisting / bankruptcy risk engine.
 *
 * On each worker tick we walk every row in `portfolio_risk_watches`,
 * fetch its bars + recent news, run `analyzeRisk()`, and decide
 * whether to fire a push:
 *
 *   * Fire when the current fingerprint differs from the last one AND
 *     the new signal set clears the watch's `min_severity` gate AND we
 *     haven't already pushed within the throttle window (default 1h).
 *   * Otherwise just record what we saw so the next tick has a fresh
 *     baseline.
 *
 * Failures are per-ticker: a Yahoo Finance 429 on one symbol
 * doesn't stop the rest of the batch. The report captures them into
 * `errors[]` so the /bot page can surface them.
 */

import { fetchHistory, fetchNews, fetchQuote } from "@/lib/data";
import { notifyPortfolioRisk } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { getState, setState } from "@/lib/bot/store";
import { withTickLock } from "@/lib/watch/tick-lock";
import { analyzeRisk } from "./analyzer";
import { maxSeverity, type RiskAssessment, type RiskSeverity } from "./signals";
import {
  listRiskWatches,
  markRiskEvaluated,
  type MinRiskSeverity,
  type RiskWatch,
} from "./store";

export const PORTFOLIO_RISK_STATE_KEYS = {
  LAST_TICK_AT: "portfolio_risk.last_tick_at",
  LAST_TICK_STATUS: "portfolio_risk.last_tick_status",
} as const;

/**
 * Do not push the same ticker's alert more than once per this many
 * milliseconds. Prevents a news feed that keeps re-shuffling the
 * publish time of the same "Chapter 11" article from paging the user
 * every 15 minutes.
 */
const THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export interface PortfolioRiskTickReport {
  ok: boolean;
  ranAt: string;
  watchCount: number;
  tickersEvaluated: number;
  cleanCount: number;
  riskyCount: number;
  notifiesSent: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runPortfolioRiskTick(): Promise<PortfolioRiskTickReport> {
  const ranAt = new Date().toISOString();
  const report: PortfolioRiskTickReport = {
    ok: true,
    ranAt,
    watchCount: 0,
    tickersEvaluated: 0,
    cleanCount: 0,
    riskyCount: 0,
    notifiesSent: 0,
    errors: [],
  };
  return withTickLock("portfolio_risk", report, () =>
    runPortfolioRiskTickBody(ranAt, report),
  );
}

async function runPortfolioRiskTickBody(
  ranAt: string,
  report: PortfolioRiskTickReport,
): Promise<PortfolioRiskTickReport> {
  const watches = listRiskWatches();
  report.watchCount = watches.length;
  if (watches.length === 0) {
    persistStatus(ranAt, report);
    return report;
  }

  const now = new Date();
  for (const watch of watches) {
    try {
      await evaluateWatch(watch, now, report);
    } catch (err) {
      report.errors.push(
        `${watch.ticker}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  persistStatus(ranAt, report);
  return report;
}

// ---------------------------------------------------------------------------
// Per-ticker evaluation
// ---------------------------------------------------------------------------

async function evaluateWatch(
  watch: RiskWatch,
  now: Date,
  report: PortfolioRiskTickReport,
): Promise<void> {
  const bars = await fetchHistory(
    watch.ticker,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  ).catch(() => []);
  // News + quote are best-effort: if either upstream fails we still
  // want the price-based signals to fire.
  const [news, quote] = await Promise.all([
    fetchNews(watch.ticker, 30).catch(() => []),
    fetchQuote(watch.ticker).catch(() => null),
  ]);

  const assessment = analyzeRisk({
    ticker: watch.ticker,
    bars,
    news,
    quote,
    now,
  });
  report.tickersEvaluated += 1;
  if (assessment.overallSeverity === null) report.cleanCount += 1;
  else report.riskyCount += 1;

  const shouldNotify = decideNotify(watch, assessment, now);
  let sent = false;
  if (shouldNotify) {
    const res = await notifyPortfolioRisk(watch.ticker, assessment, {
      previousSeverity: watch.lastSeverity,
      previousSignals: watch.lastSignals,
    });
    if (res.ok) {
      sent = true;
      report.notifiesSent += 1;
    } else {
      report.errors.push(`${watch.ticker} push: ${res.detail}`);
    }
  }
  // Always update the snapshot — even when we chose not to notify —
  // so the next tick's fingerprint comparison sees the latest state.
  markRiskEvaluated(watch.ticker, assessment, sent);
}

// ---------------------------------------------------------------------------
// Notification gating
// ---------------------------------------------------------------------------

/**
 * Should this evaluation fire a push?
 *
 * Rules:
 *   1. There must be at least one signal.
 *   2. The overall severity must clear the watch's `min_severity`
 *      gate (see `severityClearsGate`).
 *   3. The fingerprint must differ from the last one — no "same
 *      signal set, still true" repeat pings.
 *   4. Never more than one push per THROTTLE_MS per ticker, even if
 *      2 & 3 flap.
 *   5. First-time evaluations (last_fingerprint is null) don't fire —
 *      they seed the baseline instead. Otherwise a user newly
 *      importing a portfolio full of at-risk names would be buried
 *      in pushes for state that hasn't actually changed.
 */
function decideNotify(
  watch: RiskWatch,
  assessment: RiskAssessment,
  now: Date,
): boolean {
  if (assessment.overallSeverity === null) return false;
  if (!severityClearsGate(assessment.overallSeverity, watch.minSeverity)) {
    return false;
  }
  // Seed the baseline on first evaluation.
  if (watch.lastFingerprint === null) return false;
  if (assessment.fingerprint === watch.lastFingerprint) return false;
  if (watch.lastNotifiedAt) {
    const last = Date.parse(watch.lastNotifiedAt);
    if (Number.isFinite(last) && now.getTime() - last < THROTTLE_MS) {
      return false;
    }
  }
  // Additional guard: don't page for downgrades ("critical → high"
  // stays interesting, "high → medium" doesn't). We already dropped
  // medium via the gate check, but the previous severity being HIGHER
  // than the new one means the story got LESS severe — no ping.
  const merged = maxSeverity(watch.lastSeverity, assessment.overallSeverity);
  return merged === assessment.overallSeverity;
}

function severityClearsGate(
  severity: RiskSeverity,
  gate: MinRiskSeverity,
): boolean {
  if (gate === "critical") return severity === "critical";
  // "high" gate accepts high + critical, skips medium.
  return severity === "critical" || severity === "high";
}

// ---------------------------------------------------------------------------
// Status persistence — mirrors the pattern used by the other engines
// so /bot can show a "last portfolio-risk tick" summary consistently.
// ---------------------------------------------------------------------------

function persistStatus(
  ranAt: string,
  report: PortfolioRiskTickReport,
): void {
  setState(PORTFOLIO_RISK_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(PORTFOLIO_RISK_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    watchCount: report.watchCount,
    tickersEvaluated: report.tickersEvaluated,
    cleanCount: report.cleanCount,
    riskyCount: report.riskyCount,
    notifiesSent: report.notifiesSent,
    errors: report.errors,
  });
}

export interface PortfolioRiskTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    watchCount: number;
    tickersEvaluated: number;
    cleanCount: number;
    riskyCount: number;
    notifiesSent: number;
    errors: string[];
  } | null;
}

export function getPortfolioRiskTickState(): PortfolioRiskTickState {
  return {
    lastTickAt: getState<string | null>(
      PORTFOLIO_RISK_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(
      PORTFOLIO_RISK_STATE_KEYS.LAST_TICK_STATUS,
      null,
    ),
  };
}
