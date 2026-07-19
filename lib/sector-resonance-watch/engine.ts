/**
 * Market-segment 6-Signal Resonance alert engine.
 *
 * Structurally parallel to `lib/resonance-watch/engine.ts` — on each
 * worker tick we iterate every persisted `sector_resonance_alerts`
 * row, resolve the segment to its proxy ETF, fetch the latest bars,
 * compute the current `ResonanceResult`, and decide whether to send
 * a notification.
 *
 * Everything about the two engines is deliberately kept isomorphic:
 *   * same strength gate (`all` / `trigger_only` / `strong_only`)
 *   * same "daily digest wins over on-change on the same tick" rule
 *   * same first-time-baseline seeding behaviour to prevent
 *     spurious "verdict changed from null" pings
 *
 * The only differences are:
 *   1. We look up `findSegment(alert.segmentId)` before fetching bars
 *      (a rule for an unknown segment is skipped with a friendly
 *      error, not a hard tick failure).
 *   2. The notifier variants (`notifySectorResonance{Digest,Change}`)
 *      accept a `SectorNotifyContext` so the outgoing message
 *      surfaces both the segment name (what the user subscribed to)
 *      AND the proxy ETF (what was measured).
 *
 * Failure handling mirrors the per-ticker engine: per-segment errors
 * are captured into `report.errors[]` and don't abort the tick.
 */

import { fetchHistory } from "@/lib/data";
import { computeResonance, type ResonanceVerdict } from "@/lib/resonance";
import {
  notifySectorResonanceDigest,
  notifySectorResonanceChange,
} from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { getState, setState } from "@/lib/bot/store";
import { withTickLock } from "@/lib/watch/tick-lock";
import { localWallClock, timeGte } from "@/lib/watch/time";
import { findSegment } from "@/lib/segments";
import {
  listSectorResonanceAlerts,
  markSectorResonanceChangeFired,
  markSectorResonanceDigestFired,
  seedSectorResonanceLastVerdict,
  type SectorResonanceAlertStrength,
  type SectorResonanceAlert,
} from "./store";

export const SECTOR_RESONANCE_STATE_KEYS = {
  LAST_TICK_AT: "sector_resonance.last_tick_at",
  LAST_TICK_STATUS: "sector_resonance.last_tick_status",
} as const;

export interface SectorResonanceTickReport {
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

export function verdictClearsSectorResonanceGate(
  newVerdict: ResonanceVerdict,
  prevVerdict: ResonanceVerdict | null,
  alignedCount: number,
  bearishCount: number,
  minStrength: SectorResonanceAlertStrength,
): boolean {
  if (minStrength === "all") return true;

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

export async function runSectorResonanceTick(): Promise<SectorResonanceTickReport> {
  const ranAt = new Date().toISOString();
  const report: SectorResonanceTickReport = {
    ok: true,
    ranAt,
    alertCount: 0,
    segmentsEvaluated: 0,
    digestsSent: 0,
    changesSent: 0,
    errors: [],
  };
  return withTickLock("sector-resonance", report, () =>
    runSectorResonanceTickBody(ranAt, report),
  );
}

async function runSectorResonanceTickBody(
  ranAt: string,
  report: SectorResonanceTickReport,
): Promise<SectorResonanceTickReport> {
  const alerts = listSectorResonanceAlerts();
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
 * computes resonance, and dispatches through the sector-specific
 * notifiers. Unknown segments (e.g. a stale row for a slug that
 * was renamed / removed in `SEGMENTS[]`) are captured as errors so
 * the operator can clean them up.
 */
async function evaluateAlert(
  alert: SectorResonanceAlert,
  now: Date,
  report: SectorResonanceTickReport,
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
  const result = computeResonance(bars);
  report.segmentsEvaluated += 1;

  // Never notify on warmup — nothing meaningful to say yet.
  if (result.verdict === "warmup") return;

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
    const res = await notifySectorResonanceDigest(notifyCtx, result, {
      localDate,
      localTime,
      timezone: alert.timezone,
    });
    if (res.ok) {
      digestFired = true;
      report.digestsSent += 1;
      markSectorResonanceDigestFired(
        alert.segmentId,
        localDate,
        result.verdict,
        result.alignedCount,
        result.bearishAlignedCount,
      );
    } else {
      report.errors.push(`${alert.segmentId} digest: ${res.detail}`);
    }
  }

  // ---- 2. On-change alert -------------------------------------------------
  if (
    alert.notifyOnChange &&
    !digestFired &&
    alert.lastVerdict !== null &&
    alert.lastVerdict !== result.verdict &&
    verdictClearsSectorResonanceGate(
      result.verdict,
      alert.lastVerdict,
      result.alignedCount,
      result.bearishAlignedCount,
      alert.minStrength,
    )
  ) {
    const res = await notifySectorResonanceChange(notifyCtx, result, {
      previousVerdict: alert.lastVerdict,
      previousAlignedCount: alert.lastAlignedCount,
      previousBearishCount: alert.lastBearishCount,
    });
    if (res.ok) {
      report.changesSent += 1;
      markSectorResonanceChangeFired(
        alert.segmentId,
        result.verdict,
        result.alignedCount,
        result.bearishAlignedCount,
      );
    } else {
      report.errors.push(`${alert.segmentId} change: ${res.detail}`);
    }
  } else if (alert.lastVerdict === null) {
    // First-time evaluation: capture the baseline so the *next* tick
    // has something to compare against.
    seedSectorResonanceLastVerdict(
      alert.segmentId,
      result.verdict,
      result.alignedCount,
      result.bearishAlignedCount,
    );
  }
}

function persistStatus(
  ranAt: string,
  report: SectorResonanceTickReport,
): void {
  setState(SECTOR_RESONANCE_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(SECTOR_RESONANCE_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    alertCount: report.alertCount,
    segmentsEvaluated: report.segmentsEvaluated,
    digestsSent: report.digestsSent,
    changesSent: report.changesSent,
    errors: report.errors,
  });
}

export interface SectorResonanceTickState {
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

export function getSectorResonanceTickState(): SectorResonanceTickState {
  return {
    lastTickAt: getState<string | null>(
      SECTOR_RESONANCE_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(
      SECTOR_RESONANCE_STATE_KEYS.LAST_TICK_STATUS,
      null,
    ),
  };
}
