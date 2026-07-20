/**
 * Portfolio delisting / bankruptcy risk engine.
 *
 * On each worker tick we walk every row in `portfolio_risk_watches`,
 * fetch its bars + recent news, run `analyzeRisk()`, and decide
 * whether to fire a push.
 *
 * Notification model: **sticky-until-recovery**. We alert exactly ONCE
 * per at-risk episode — the moment a ticker first crosses the
 * `min_severity` gate, and then stay quiet even as the underlying
 * signal set churns (new headlines, price drift, etc.) until the
 * ticker returns to a clean state (`overallSeverity === null`). At
 * that point `last_notified_at` is cleared and any future re-entry
 * into risk is treated as a fresh episode that fires again.
 *
 * Rationale: the previous "fingerprint change" model would re-fire
 * every time a news headline entered or left the 30-day window, which
 * for a persistently-risky ticker meant a push roughly every hour.
 * Users found that noisy; the one-per-episode contract matches the
 * user-visible mental model of "notify me when this ticker gets into
 * trouble, once."
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
import type { RiskAssessment, RiskSeverity } from "./signals";
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

  const shouldNotify = decideNotify(watch, assessment);
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
  // so the next tick's evaluation sees the latest observed state.
  // `markRiskEvaluated` also clears `last_notified_at` when severity
  // returns to null, which is what lets a recovered ticker fire again
  // if it re-enters risk later.
  markRiskEvaluated(watch.ticker, assessment, sent);
}

// ---------------------------------------------------------------------------
// Notification gating
// ---------------------------------------------------------------------------

/**
 * Should this evaluation fire a push?
 *
 * Sticky-until-recovery contract:
 *
 *   1. There must be at least one signal (severity != null).
 *   2. The overall severity must clear the watch's `min_severity`
 *      gate (see `severityClearsGate`).
 *   3. The user hasn't dismissed this exact signal set as a false
 *      positive (`dismissedFingerprint === assessment.fingerprint`).
 *      Dismissals are pinned to a specific fingerprint so a NEW
 *      signal appearing (fingerprint change) still fires — we don't
 *      want a dismissed "spurious Chapter 11 news" alert to also
 *      silence the ACTUAL delisting notice a week later.
 *   4. First-time evaluations (last_fingerprint is null) don't fire —
 *      they seed the baseline instead. Otherwise importing a new
 *      portfolio full of at-risk names would blast the user with
 *      pushes for state that hasn't actually changed.
 *   5. Once we've alerted for this episode (`last_notified_at` is
 *      set), stay quiet regardless of how the signal set churns.
 *      That flag is cleared in `markRiskEvaluated` when the ticker
 *      returns to clean, so a later re-entry into risk fires again.
 */
function decideNotify(
  watch: RiskWatch,
  assessment: RiskAssessment,
): boolean {
  if (assessment.overallSeverity === null) return false;
  if (!severityClearsGate(assessment.overallSeverity, watch.minSeverity)) {
    return false;
  }
  // False-positive dismissal — pinned to a specific fingerprint.
  if (
    watch.dismissedFingerprint !== null &&
    watch.dismissedFingerprint === assessment.fingerprint
  ) {
    return false;
  }
  if (watch.lastFingerprint === null) return false;
  // Sticky suppression — one push per at-risk episode, forever, until
  // the ticker recovers.
  if (watch.lastNotifiedAt !== null) return false;
  return true;
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
