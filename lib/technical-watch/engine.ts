/**
 * Technical-signal alert engine.
 *
 * On each worker tick we iterate every persisted `technical_alerts` row,
 * fetch the latest bars for that ticker, compute the current
 * `TechnicalSignal`, and decide whether to send a notification.
 *
 * Two independent decision paths share the same row:
 *
 *   1. **Daily digest** (`daily_time` set). We compare the current
 *      time in the alert's `timezone` against `daily_time`. If we've
 *      passed today's target instant AND we haven't already sent a
 *      digest for today's local date, fire one. The
 *      `last_digest_local_date` column is the idempotency key — this
 *      keeps the digest to *at most one per user-local day* even when
 *      the worker's tick cadence is a few minutes.
 *
 *   2. **On-change alert** (`notify_on_change = true`). Whenever the
 *      verdict band differs from `last_verdict`, we compare against
 *      `min_strength` (e.g. `strong_only` filters out HOLD ↔ BUY
 *      chatter) and fire when the gate passes. Every fire updates
 *      `last_verdict` so the next tick has a fresh baseline.
 *
 * The two paths use different `last_*` columns so they can't
 * accidentally cancel each other out — a mid-day BUY→SELL flip
 * doesn't reset the "already sent today's digest" flag.
 *
 * Failure handling mirrors the news-watch engine: per-ticker errors
 * are captured into `report.errors[]` and don't abort the tick. The
 * worker log surfaces them.
 */

import { fetchHistory } from "@/lib/data";
import { enrich } from "@/lib/indicators";
import { computeTechnicalSignal, type Verdict } from "@/lib/technical-signal";
import { notifyTechnicalDigest, notifyTechnicalChange } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { getState, setState } from "@/lib/bot/store";
import { withTickLock } from "@/lib/watch/tick-lock";
import { localWallClock, timeGte } from "@/lib/watch/time";
import { shouldNotifyOnChange } from "@/lib/alert-frequency";
import {
  listTechnicalAlerts,
  markChangeFired,
  markDigestFired,
  seedLastVerdict,
  type AlertStrength,
  type TechnicalAlert,
} from "./store";

export const TECHNICAL_STATE_KEYS = {
  LAST_TICK_AT: "technical.last_tick_at",
  LAST_TICK_STATUS: "technical.last_tick_status",
} as const;

export interface TechnicalTickReport {
  ok: boolean;
  ranAt: string;
  alertCount: number;
  tickersEvaluated: number;
  digestsSent: number;
  changesSent: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Strength gate
// ---------------------------------------------------------------------------

/**
 * Does `verdict` clear the user's `min_strength` threshold? Only used
 * for the on-change path — the daily digest always fires regardless of
 * band, since the whole point of it is a "here's where we are today"
 * summary.
 */
export function verdictClearsGate(
  verdict: Verdict,
  minStrength: AlertStrength,
): boolean {
  if (minStrength === "all") return true;
  if (minStrength === "buy_sell") {
    return (
      verdict === "buy" ||
      verdict === "strong_buy" ||
      verdict === "sell" ||
      verdict === "strong_sell"
    );
  }
  // strong_only
  return verdict === "strong_buy" || verdict === "strong_sell";
}

// ---------------------------------------------------------------------------
// Tick entrypoint
// ---------------------------------------------------------------------------

export async function runTechnicalTick(): Promise<TechnicalTickReport> {
  const ranAt = new Date().toISOString();
  const report: TechnicalTickReport = {
    ok: true,
    ranAt,
    alertCount: 0,
    tickersEvaluated: 0,
    digestsSent: 0,
    changesSent: 0,
    errors: [],
  };
  return withTickLock("technical", report, () =>
    runTechnicalTickBody(ranAt, report),
  );
}

async function runTechnicalTickBody(
  ranAt: string,
  report: TechnicalTickReport,
): Promise<TechnicalTickReport> {
  const alerts = listTechnicalAlerts();
  report.alertCount = alerts.length;
  if (alerts.length === 0) {
    persistStatus(ranAt, report);
    return report;
  }

  const now = new Date();
  for (const alert of alerts) {
    try {
      await evaluateAlert(alert, now, report);
    } catch (err) {
      report.errors.push(
        `${alert.ticker}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  persistStatus(ranAt, report);
  return report;
}

/**
 * Evaluate one alert. Fetches bars → computes signal → decides which
 * (if any) of the two channels should fire, and updates the row's
 * last-fire columns accordingly.
 */
async function evaluateAlert(
  alert: TechnicalAlert,
  now: Date,
  report: TechnicalTickReport,
): Promise<void> {
  const bars = await fetchHistory(
    alert.ticker,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  );
  if (bars.length === 0) {
    report.errors.push(`${alert.ticker}: no bars from upstream`);
    return;
  }
  const enriched = enrich(bars);
  const signal = computeTechnicalSignal({
    bars,
    sma50: enriched.sma50,
    sma200: enriched.sma200,
    rsi14: enriched.rsi14,
    macd: enriched.macd,
    bb20: enriched.bb20,
    levels: enriched.levels,
    kdj: enriched.kdj,
    // Fear & Greed intentionally omitted — the F&G proxy is a Next.js
    // route handler, not a reusable server module, and its optional
    // ±0.5-weight contribution rarely flips the headline verdict.
    // Users who care about the exact UI match can cross-check the
    // dashboard when the digest lands.
  });
  report.tickersEvaluated += 1;

  const { date: localDate, time: localTime } = localWallClock(
    now,
    alert.timezone,
  );

  // ---- 1. Daily digest ----------------------------------------------------
  // Fire when: a target time is set, we've passed it in the alert's local
  // timezone today, and we haven't already sent today's digest.
  let digestFired = false;
  if (
    alert.dailyTime &&
    timeGte(localTime, alert.dailyTime) &&
    alert.lastDigestLocalDate !== localDate
  ) {
    const res = await notifyTechnicalDigest(alert.ticker, signal, {
      localDate,
      localTime,
      timezone: alert.timezone,
    });
    if (res.ok) {
      digestFired = true;
      report.digestsSent += 1;
      markDigestFired(
        alert.ticker,
        localDate,
        signal.verdict,
        signal.score,
      );
    } else {
      // Non-ok: record the error but DON'T mark the digest as fired,
      // so the next tick retries (matches the news-tick behaviour).
      report.errors.push(
        `${alert.ticker} digest: ${res.detail}`,
      );
    }
  }

  // ---- 2. On-change alert -------------------------------------------------
  // Skip when the digest already fired this tick — the digest carries
  // the same verdict info so a follow-up "verdict changed" ping would
  // be redundant noise. `markDigestFired` already updated last_verdict
  // to the new value so the next tick won't re-detect the crossing.
  //
  // Also honour the per-rule frequency mode ('always' | 'daily' |
  // 'once'). When the gate returns false we still update the baseline
  // via seedLastVerdict if applicable, so the throttled tick doesn't
  // leave a stale verdict comparison for tomorrow.
  const frequencyAllows = shouldNotifyOnChange(
    alert.frequency,
    alert.lastChangeNotifiedAt,
    now,
    alert.timezone,
  );
  if (
    alert.notifyOnChange &&
    !digestFired &&
    alert.lastVerdict !== null &&
    alert.lastVerdict !== signal.verdict &&
    verdictClearsGate(signal.verdict, alert.minStrength) &&
    frequencyAllows
  ) {
    const res = await notifyTechnicalChange(alert.ticker, signal, {
      previousVerdict: alert.lastVerdict,
      previousScore: alert.lastScore,
    });
    if (res.ok) {
      report.changesSent += 1;
      markChangeFired(alert.ticker, signal.verdict, signal.score);
    } else {
      report.errors.push(
        `${alert.ticker} change: ${res.detail}`,
      );
    }
  } else if (alert.lastVerdict === null) {
    // First-time evaluation: capture the baseline so the *next* tick
    // has something to compare against. This is what prevents a fresh
    // subscription from firing a "verdict changed from null to buy"
    // ping on its very first evaluation.
    seedLastVerdict(alert.ticker, signal.verdict, signal.score);
  }
}

function persistStatus(ranAt: string, report: TechnicalTickReport): void {
  setState(TECHNICAL_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(TECHNICAL_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    alertCount: report.alertCount,
    tickersEvaluated: report.tickersEvaluated,
    digestsSent: report.digestsSent,
    changesSent: report.changesSent,
    errors: report.errors,
  });
}

export interface TechnicalTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    alertCount: number;
    tickersEvaluated: number;
    digestsSent: number;
    changesSent: number;
    errors: string[];
  } | null;
}

export function getTechnicalTickState(): TechnicalTickState {
  return {
    lastTickAt: getState<string | null>(
      TECHNICAL_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(TECHNICAL_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}
