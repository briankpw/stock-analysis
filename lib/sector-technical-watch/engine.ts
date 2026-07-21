/**
 * Market-segment Technical Signal alert engine.
 *
 * Structural parallel to `lib/technical-watch/engine.ts` — on each
 * worker tick we iterate every persisted `sector_technical_alerts`
 * row, resolve the segment to its proxy ETF, fetch the latest bars,
 * compute the current `TechnicalSignal`, and decide whether to send a
 * notification.
 *
 * Everything about the two engines is deliberately kept isomorphic:
 *   * same strength gate (`all` / `buy_sell` / `strong_only`)
 *   * same "daily digest wins over on-change on the same tick" rule
 *   * same first-time-baseline seeding to prevent spurious "verdict
 *     changed from null" pings
 *
 * The only differences are:
 *   1. We look up `findSegment(alert.segmentId)` before fetching bars
 *      (a rule for an unknown segment is skipped with a friendly
 *      error, not a hard tick failure).
 *   2. The notifier variants (`notifySectorTechnical{Digest,Change}`)
 *      accept a `SectorNotifyContext` so the outgoing message
 *      surfaces both the segment name (what the user subscribed to)
 *      AND the proxy ETF (what was measured).
 *
 * Failure handling mirrors the sibling engines: per-segment errors
 * are captured into `report.errors[]` and don't abort the tick.
 */

import { fetchHistory } from "@/lib/data";
import { enrich } from "@/lib/indicators";
import { computeTechnicalSignal, type Verdict } from "@/lib/technical-signal";
import {
  notifySectorTechnicalDigest,
  notifySectorTechnicalChange,
} from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { getState, setState } from "@/lib/bot/store";
import { withTickLock } from "@/lib/watch/tick-lock";
import { localWallClock, timeGte } from "@/lib/watch/time";
import { findSegment } from "@/lib/segments";
import { shouldNotifyOnChange } from "@/lib/alert-frequency";
import {
  listSectorTechnicalAlerts,
  markSectorTechnicalChangeFired,
  markSectorTechnicalDigestFired,
  seedSectorTechnicalLastVerdict,
  type SectorTechnicalAlertStrength,
  type SectorTechnicalAlert,
} from "./store";

export const SECTOR_TECHNICAL_STATE_KEYS = {
  LAST_TICK_AT: "sector_technical.last_tick_at",
  LAST_TICK_STATUS: "sector_technical.last_tick_status",
} as const;

export interface SectorTechnicalTickReport {
  ok: boolean;
  ranAt: string;
  alertCount: number;
  segmentsEvaluated: number;
  digestsSent: number;
  changesSent: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Strength gate — verbatim copy of the per-ticker version. Kept as a
// separate function (rather than reusing the ticker one) so a future
// tweak to sector semantics doesn't accidentally leak into the
// per-ticker path.
// ---------------------------------------------------------------------------

export function verdictClearsSectorTechnicalGate(
  verdict: Verdict,
  minStrength: SectorTechnicalAlertStrength,
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

export async function runSectorTechnicalTick(): Promise<SectorTechnicalTickReport> {
  const ranAt = new Date().toISOString();
  const report: SectorTechnicalTickReport = {
    ok: true,
    ranAt,
    alertCount: 0,
    segmentsEvaluated: 0,
    digestsSent: 0,
    changesSent: 0,
    errors: [],
  };
  return withTickLock("sector-technical", report, () =>
    runSectorTechnicalTickBody(ranAt, report),
  );
}

async function runSectorTechnicalTickBody(
  ranAt: string,
  report: SectorTechnicalTickReport,
): Promise<SectorTechnicalTickReport> {
  const alerts = listSectorTechnicalAlerts();
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
        `${alert.segmentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  persistStatus(ranAt, report);
  return report;
}

/**
 * Evaluate one sector alert. Resolves the proxy ETF, fetches bars,
 * computes the technical signal, and dispatches through the sector-
 * specific notifiers. Unknown segments (e.g. a stale row for a slug
 * that was renamed / removed in `SEGMENTS[]`) are captured as errors
 * so the operator can clean them up.
 */
async function evaluateAlert(
  alert: SectorTechnicalAlert,
  now: Date,
  report: SectorTechnicalTickReport,
): Promise<void> {
  const segment = findSegment(alert.segmentId);
  if (!segment) {
    report.errors.push(`${alert.segmentId}: unknown segment (stale row?)`);
    return;
  }

  const bars = await fetchHistory(
    segment.proxyEtf,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  );
  if (bars.length === 0) {
    report.errors.push(
      `${alert.segmentId} (${segment.proxyEtf}): no bars from upstream`,
    );
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
    // Fear & Greed intentionally omitted — matches the per-ticker
    // engine's decision (see comment in `lib/technical-watch/engine.ts`).
  });
  report.segmentsEvaluated += 1;

  const { date: localDate, time: localTime } = localWallClock(
    now,
    alert.timezone,
  );
  const notifyCtx = {
    segmentId: alert.segmentId,
    segmentName: segment.name,
    proxyTicker: segment.proxyEtf,
  };

  // ---- 1. Daily digest ----------------------------------------------------
  let digestFired = false;
  if (
    alert.dailyTime &&
    timeGte(localTime, alert.dailyTime) &&
    alert.lastDigestLocalDate !== localDate
  ) {
    const res = await notifySectorTechnicalDigest(notifyCtx, signal, {
      localDate,
      localTime,
      timezone: alert.timezone,
    });
    if (res.ok) {
      digestFired = true;
      report.digestsSent += 1;
      markSectorTechnicalDigestFired(
        alert.segmentId,
        localDate,
        signal.verdict,
        signal.score,
      );
    } else {
      report.errors.push(`${alert.segmentId} digest: ${res.detail}`);
    }
  }

  // ---- 2. On-change alert -------------------------------------------------
  // Per-rule frequency ('always' | 'daily' | 'once') caps how often
  // this path can fire. See `lib/alert-frequency.ts` for semantics.
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
    verdictClearsSectorTechnicalGate(signal.verdict, alert.minStrength) &&
    frequencyAllows
  ) {
    const res = await notifySectorTechnicalChange(notifyCtx, signal, {
      previousVerdict: alert.lastVerdict,
      previousScore: alert.lastScore,
    });
    if (res.ok) {
      report.changesSent += 1;
      markSectorTechnicalChangeFired(
        alert.segmentId,
        signal.verdict,
        signal.score,
      );
    } else {
      report.errors.push(`${alert.segmentId} change: ${res.detail}`);
    }
  } else if (alert.lastVerdict === null) {
    // First-time evaluation: capture the baseline so the *next* tick
    // has something to compare against.
    seedSectorTechnicalLastVerdict(
      alert.segmentId,
      signal.verdict,
      signal.score,
    );
  }
}

function persistStatus(
  ranAt: string,
  report: SectorTechnicalTickReport,
): void {
  setState(SECTOR_TECHNICAL_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(SECTOR_TECHNICAL_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    alertCount: report.alertCount,
    segmentsEvaluated: report.segmentsEvaluated,
    digestsSent: report.digestsSent,
    changesSent: report.changesSent,
    errors: report.errors,
  });
}

export interface SectorTechnicalTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    alertCount: number;
    segmentsEvaluated: number;
    digestsSent: number;
    changesSent: number;
    errors: string[];
  } | null;
}

export function getSectorTechnicalTickState(): SectorTechnicalTickState {
  return {
    lastTickAt: getState<string | null>(
      SECTOR_TECHNICAL_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(
      SECTOR_TECHNICAL_STATE_KEYS.LAST_TICK_STATUS,
      null,
    ),
  };
}
