/**
 * Master Verdict alert engine.
 *
 * On each worker tick we iterate every persisted `master_alerts` row,
 * gather the five sub-scorer inputs (bars/indicators, resonance,
 * fundamentals, news sentiment, F&G), compute the fused
 * `MasterVerdict`, and decide whether to notify. Two independent
 * decision paths share the same row:
 *
 *   1. **Daily digest** (`daily_time` set). Fires once per local day
 *      in the alert's `timezone` once the target instant has passed.
 *      Idempotent per `last_digest_local_date`.
 *
 *   2. **On-change alert** (`notify_on_change = true`). Fires when
 *      the master verdict band differs from `last_verdict`, filtered
 *      by `min_strength`. `last_verdict` snapshots the master band
 *      specifically — not the technical band — so a technical-only
 *      flip that got absorbed by fundamentals doesn't spuriously
 *      trigger.
 *
 * The two channels use different `last_*` columns so they can't
 * cancel each other out — a mid-day BUY→SELL flip doesn't reset
 * "already sent today's digest".
 *
 * Failure handling mirrors the technical-watch engine: per-ticker
 * errors are captured into `report.errors[]` and don't abort the tick.
 * The engine tolerates missing sub-scorers (news, F&G, fundamentals)
 * gracefully — `computeMasterVerdict` drops them from the weighted
 * average and reports lower coverage.
 */

import { settings } from "@/lib/config";
import { fetchBundle, fetchNews } from "@/lib/data";
import { enrich, latestSignals } from "@/lib/indicators";
import { analyze } from "@/lib/insights";
import {
  aggregate as aggregateSentiment,
  labelFromScore,
  scoreText,
  type Scored,
} from "@/lib/sentiment";
import { computeTechnicalSignal, type Verdict } from "@/lib/technical-signal";
import { computeResonance } from "@/lib/resonance";
import {
  computeMasterVerdict,
  type MasterVerdict,
} from "@/lib/master-verdict";
import { getFearGreedScore } from "@/lib/fear-greed";
import { getState, setState } from "@/lib/bot/store";
import { notifyMasterDigest, notifyMasterChange } from "@/lib/bot/notifier";
import { withTickLock } from "@/lib/watch/tick-lock";
import { localWallClock, timeGte } from "@/lib/watch/time";
import { shouldNotifyOnChange } from "@/lib/alert-frequency";
import {
  listMasterAlerts,
  markMasterChangeFired,
  markMasterDigestFired,
  seedMasterLastVerdict,
  type AlertStrength,
  type MasterAlert,
} from "./store";

export const MASTER_STATE_KEYS = {
  LAST_TICK_AT: "master.last_tick_at",
  LAST_TICK_STATUS: "master.last_tick_status",
} as const;

export interface MasterTickReport {
  ok: boolean;
  ranAt: string;
  alertCount: number;
  tickersEvaluated: number;
  digestsSent: number;
  changesSent: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Strength gate — same semantics as `verdictClearsGate` in the
// technical engine. Duplicated (rather than imported) so the two
// engines stay decoupled — if one grows a master-only strength enum
// we won't have to unpick a shared helper.
// ---------------------------------------------------------------------------

export function masterClearsGate(
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
// Sub-scorer gathering — assembles exactly what `computeMasterVerdict`
// needs for one ticker. Extracted so `evaluateAlert` reads cleanly and
// so the `/api/master-alerts/test` route can reuse the same code path
// without duplicating the fetch dance.
// ---------------------------------------------------------------------------

/**
 * Fetch every sub-scorer input needed for the master verdict.
 *
 * News, F&G, and the info blob (fundamentals) are all fetched in
 * parallel with the price bundle so a slow upstream on one doesn't
 * serialise onto the critical path. Any of them can fail
 * independently — the engine tolerates missing inputs by lowering
 * coverage rather than aborting.
 */
export async function computeMasterForTicker(
  ticker: string,
): Promise<{ verdict: MasterVerdict; rateLimited: boolean } | null> {
  const bundleP = fetchBundle(
    ticker,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  );
  // News fetch: we ask for the same window the UI does. Errors
  // become an empty array so sentiment simply reports "no news".
  const newsP = fetchNews(ticker, 25).catch(() => []);
  const fgP = getFearGreedScore();

  const [bundle, rawNews, fearGreedScore] = await Promise.all([
    bundleP,
    newsP,
    fgP,
  ]);

  if (bundle.bars.length === 0) return null;

  const enriched = enrich(bundle.bars);
  const signals = latestSignals(enriched);
  const technical = computeTechnicalSignal({
    bars: bundle.bars,
    sma50: enriched.sma50,
    sma200: enriched.sma200,
    rsi14: enriched.rsi14,
    macd: enriched.macd,
    bb20: enriched.bb20,
    levels: enriched.levels,
    kdj: enriched.kdj,
    // F&G intentionally omitted from the technical sub-score to keep
    // parity with `/api/bundle` — the master layer folds F&G in via
    // its own `adaptMood` adapter, not via the technical scorer.
  });
  const resonance = computeResonance(bundle.bars);
  const analysis = analyze(ticker, bundle.info, bundle.bars, signals);

  // Score the news headlines exactly like `/api/news` does so the
  // sentiment aggregate we feed into the master matches what the UI
  // would show. Empty feed → aggregate reports `counts.*=0` and the
  // sentiment adapter treats it as "no vote".
  const scored: Scored[] = rawNews.map((n) => {
    const combined = `${n.title}. ${n.summary}`.trim();
    const s = scoreText(combined);
    return {
      score: s,
      publishedAt: new Date(n.publishedAt),
      label: labelFromScore(s),
    };
  });
  const sentiment = aggregateSentiment(scored);

  const verdict = computeMasterVerdict({
    technical,
    resonance,
    fundamentals: analysis,
    sentiment,
    fearGreedScore,
  });

  return { verdict, rateLimited: bundle.rateLimited };
}

// ---------------------------------------------------------------------------
// Tick entrypoint
// ---------------------------------------------------------------------------

export async function runMasterTick(): Promise<MasterTickReport> {
  const ranAt = new Date().toISOString();
  const report: MasterTickReport = {
    ok: true,
    ranAt,
    alertCount: 0,
    tickersEvaluated: 0,
    digestsSent: 0,
    changesSent: 0,
    errors: [],
  };
  return withTickLock("master", report, () =>
    runMasterTickBody(ranAt, report),
  );
}

async function runMasterTickBody(
  ranAt: string,
  report: MasterTickReport,
): Promise<MasterTickReport> {
  const alerts = listMasterAlerts();
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
 * Evaluate one alert. Fetches everything → computes master verdict →
 * decides which (if any) channel should fire → updates the row's
 * last-fire columns.
 */
async function evaluateAlert(
  alert: MasterAlert,
  now: Date,
  report: MasterTickReport,
): Promise<void> {
  const computed = await computeMasterForTicker(alert.ticker);
  if (!computed) {
    report.errors.push(`${alert.ticker}: no bars from upstream`);
    return;
  }
  const verdict = computed.verdict;
  report.tickersEvaluated += 1;

  if (!verdict.hasData) {
    // Every sub-scorer missing or in warm-up. Nothing to notify on;
    // skip both channels so we don't burn a digest slot or a change
    // ping on a "coverage: 0%" verdict.
    return;
  }

  const { date: localDate, time: localTime } = localWallClock(
    now,
    alert.timezone,
  );

  // ---- 1. Daily digest --------------------------------------------------
  let digestFired = false;
  if (
    alert.dailyTime &&
    timeGte(localTime, alert.dailyTime) &&
    alert.lastDigestLocalDate !== localDate
  ) {
    const res = await notifyMasterDigest(alert.ticker, verdict, {
      localDate,
      localTime,
      timezone: alert.timezone,
    });
    if (res.ok) {
      digestFired = true;
      report.digestsSent += 1;
      markMasterDigestFired(
        alert.ticker,
        localDate,
        verdict.verdict,
        verdict.score,
        verdict.coverage,
      );
    } else {
      // Non-ok: record the error but DON'T mark the digest as fired,
      // so the next tick retries.
      report.errors.push(`${alert.ticker} digest: ${res.detail}`);
    }
  }

  // ---- 2. On-change alert -----------------------------------------------
  // Skip when the digest already fired this tick — the digest carries
  // the same verdict info so a follow-up "verdict changed" ping would
  // be redundant. `markMasterDigestFired` already updated last_verdict
  // to the new value so the next tick won't re-detect the crossing.
  //
  // Per-rule frequency ('always' | 'daily' | 'once') caps how often
  // this path can fire.
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
    alert.lastVerdict !== verdict.verdict &&
    masterClearsGate(verdict.verdict, alert.minStrength) &&
    frequencyAllows
  ) {
    const res = await notifyMasterChange(alert.ticker, verdict, {
      previousVerdict: alert.lastVerdict,
      previousScore: alert.lastScore,
      previousCoverage: alert.lastCoverage,
    });
    if (res.ok) {
      report.changesSent += 1;
      markMasterChangeFired(
        alert.ticker,
        verdict.verdict,
        verdict.score,
        verdict.coverage,
      );
    } else {
      report.errors.push(`${alert.ticker} change: ${res.detail}`);
    }
  } else if (alert.lastVerdict === null) {
    // First-time evaluation: seed the baseline so the *next* tick has
    // something to compare against. Prevents a fresh subscription
    // from firing "verdict changed from null to buy" on its very
    // first evaluation.
    seedMasterLastVerdict(
      alert.ticker,
      verdict.verdict,
      verdict.score,
      verdict.coverage,
    );
  }
}

function persistStatus(ranAt: string, report: MasterTickReport): void {
  setState(MASTER_STATE_KEYS.LAST_TICK_AT, ranAt);
  setState(MASTER_STATE_KEYS.LAST_TICK_STATUS, {
    ok: report.errors.length === 0,
    alertCount: report.alertCount,
    tickersEvaluated: report.tickersEvaluated,
    digestsSent: report.digestsSent,
    changesSent: report.changesSent,
    errors: report.errors,
  });
}

export interface MasterTickState {
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

export function getMasterTickState(): MasterTickState {
  return {
    lastTickAt: getState<string | null>(
      MASTER_STATE_KEYS.LAST_TICK_AT,
      null,
    ),
    lastTickStatus: getState(MASTER_STATE_KEYS.LAST_TICK_STATUS, null),
  };
}
