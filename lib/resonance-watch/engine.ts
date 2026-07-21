/**
 * 6-Signal Resonance alert engine.
 *
 * Structurally parallel to `lib/technical-watch/engine.ts` — on each
 * worker tick we iterate every persisted `resonance_alerts` row, fetch
 * the latest bars, compute the current `ResonanceResult`, and decide
 * whether to send a notification.
 *
 * Two independent decision paths share the same row:
 *
 *   1. **Daily digest** (`daily_time` set). Fires once per user-local
 *      day when the current time has passed the target instant.
 *      Idempotency via `last_digest_local_date`.
 *
 *   2. **On-change alert** (`notify_on_change = true`). Fires when
 *      the resonance verdict differs from `last_verdict`, filtered by
 *      `min_strength`. The default `trigger_only` mode ONLY fires on
 *      transitions INTO a fresh `buy` / `sell` verdict — the whole
 *      point of the resonance strategy is "alert me the instant all
 *      six signals align".
 *
 * Failure handling mirrors the technical-watch engine: per-ticker
 * errors are captured into `report.errors[]` and don't abort the tick.
 */

import { fetchHistory } from "@/lib/data";
import { computeResonance, type ResonanceVerdict } from "@/lib/resonance";
import { notifyResonanceDigest, notifyResonanceChange } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { getState, setState } from "@/lib/bot/store";
import { withTickLock } from "@/lib/watch/tick-lock";
import { localWallClock, timeGte } from "@/lib/watch/time";
import { shouldNotifyOnChange } from "@/lib/alert-frequency";
import {
  listResonanceAlerts,
  markResonanceChangeFired,
  markResonanceDigestFired,
  seedResonanceLastVerdict,
  type ResonanceAlertStrength,
  type ResonanceAlert,
} from "./store";

export const RESONANCE_STATE_KEYS = {
  LAST_TICK_AT: "resonance.last_tick_at",
  LAST_TICK_STATUS: "resonance.last_tick_status",
} as const;

export interface ResonanceTickReport {
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
 * Does the new verdict (given the current alignment counts) clear the
 * user's `min_strength` threshold? This gate is only applied on the
 * on-change path — the daily digest always fires regardless, since
 * the whole point of a digest is a "here's where we are today"
 * summary.
 *
 * The `trigger_only` gate — the default — filters aggressively so
 * users don't get pinged on every holding ↔ out transition (which
 * happens frequently near the end of a run). Only *fresh* triggers
 * fire.
 */
export function verdictClearsResonanceGate(
  newVerdict: ResonanceVerdict,
  prevVerdict: ResonanceVerdict | null,
  alignedCount: number,
  bearishCount: number,
  minStrength: ResonanceAlertStrength,
): boolean {
  if (minStrength === "all") return true;

  // Both stricter modes require a *transition into* `buy` or `sell`.
  // Warmup and out never fire on their own; holding/avoid only fire
  // via the digest path.
  const isFreshTrigger =
    (newVerdict === "buy" && prevVerdict !== "buy") ||
    (newVerdict === "sell" && prevVerdict !== "sell");
  if (!isFreshTrigger) return false;

  if (minStrength === "trigger_only") return true;

  // strong_only: require full 6/6 alignment on the triggering side.
  if (newVerdict === "buy") return alignedCount >= 6;
  if (newVerdict === "sell") return bearishCount >= 6;
  return false;
}

// ---------------------------------------------------------------------------
// Tick entrypoint
// ---------------------------------------------------------------------------

export async function runResonanceTick(): Promise<ResonanceTickReport> {
  const ranAt = new Date().toISOString();
  const report: ResonanceTickReport = {
    ok: true,
    ranAt,
    alertCount: 0,
    tickersEvaluated: 0,
    digestsSent: 0,
    changesSent: 0,
    errors: [],
  };
  return withTickLock("resonance", report, () =>
    runResonanceTickBody(ranAt, report),
  );
}

async function runResonanceTickBody(
  ranAt: string,
  report: ResonanceTickReport,
): Promise<ResonanceTickReport> {
  const alerts = listResonanceAlerts();
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
 * Evaluate one alert. Fetches bars → computes resonance → decides
 * which (if any) of the two channels should fire, and updates the
 * row's last-fire columns accordingly.
 */
async function evaluateAlert(
  alert: ResonanceAlert,
  now: Date,
  report: ResonanceTickReport,
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
  const result = computeResonance(bars);
  report.tickersEvaluated += 1;

  // Never notify on warmup — nothing meaningful to say yet.
  if (result.verdict === "warmup") return;

  const { date: localDate, time: localTime } = localWallClock(
    now,
    alert.timezone,
  );

  // ---- 1. Daily digest ----------------------------------------------------
  let digestFired = false;
  if (
    alert.dailyTime &&
    timeGte(localTime, alert.dailyTime) &&
    alert.lastDigestLocalDate !== localDate
  ) {
    const res = await notifyResonanceDigest(alert.ticker, result, {
      localDate,
      localTime,
      timezone: alert.timezone,
    });
    if (res.ok) {
      digestFired = true;
      report.digestsSent += 1;
      markResonanceDigestFired(
        alert.ticker,
        localDate,
        result.verdict,
        result.alignedCount,
        result.bearishAlignedCount,
      );
    } else {
      report.errors.push(`${alert.ticker} digest: ${res.detail}`);
    }
  }

  // ---- 2. On-change alert -------------------------------------------------
  // Skip when the digest already fired this tick — a duplicate change
  // ping right after a digest would be noise (the digest already
  // updated `last_verdict` so the next tick has a fresh baseline).
  //
  // The per-rule frequency mode ('always' | 'daily' | 'once') caps
  // how often this path can fire. Once-mode rules stay quiet after
  // their first fire until the user re-saves the alert.
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
    alert.lastVerdict !== result.verdict &&
    verdictClearsResonanceGate(
      result.verdict,
      alert.lastVerdict,
      result.alignedCount,
      result.bearishAlignedCount,
      alert.minStrength,
    ) &&
    frequencyAllows
  ) {
    const res = await notifyResonanceChange(alert.ticker, result, {
      previousVerdict: alert.lastVerdict,
      previousAlignedCount: alert.lastAlignedCount,
      previousBearishCount: alert.lastBearishCount,
    });
    if (res.ok) {
      report.changesSent += 1;
      markResonanceChangeFired(
        alert.ticker,
        result.verdict,
        result.alignedCount,
        result.bearishAlignedCount,
      );
    } else {
      report.errors.push(`${alert.ticker} change: ${res.detail}`);
    }
  } else if (alert.lastVerdict === null) {
    // First-time evaluation: capture the baseline so the *next* tick
    // has something to compare against. Prevents a fresh subscription
    // from firing a "verdict changed from null" ping on its very
    // first evaluation.
    seedResonanceLastVerdict(
      alert.ticker,
      result.verdict,
      result.alignedCount,
      result.bearishAlignedCount,
    );
  }
}

function persistStatus(ranAt: string, report: ResonanceTickReport): void {
  setState(RESONANCE_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(RESONANCE_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    alertCount: report.alertCount,
    tickersEvaluated: report.tickersEvaluated,
    digestsSent: report.digestsSent,
    changesSent: report.changesSent,
    errors: report.errors,
  });
}

export interface ResonanceTickState {
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

export function getResonanceTickState(): ResonanceTickState {
  return {
    lastTickAt: getState<string | null>(
      RESONANCE_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(RESONANCE_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}

// Convenience export for the manual /api/resonance-alerts/test route
// so it can format the "current resonance snapshot" without importing
// the whole engine surface. Kept as a re-export rather than duplicating
// the type so future changes to ResonanceResult only need to happen in
// one place.
export type { ResonanceResult } from "@/lib/resonance";
