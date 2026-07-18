/**
 * Data-driven stop-loss / take-profit recommender.
 *
 * Blends three inputs the app already has for the current ticker:
 *   1. **ATR(14)** — average true range, i.e. how much the stock typically
 *      moves in one day. This sets the *base* stop distance. Setting SL <
 *      1× ATR guarantees you'll be stopped out by normal noise; ≥ 3× ATR
 *      gives up too much of the position before admitting you're wrong.
 *      We aim for **~2× ATR** as a middle ground (a common swing-trading
 *      convention going back to Chuck Le Beau's "Chandelier Exit").
 *   2. **Trend regime** — from `latestSignals.trend`. In a bullish trend
 *      we let winners run (higher reward multiple); in a bearish or
 *      choppy tape we shorten both sides.
 *   3. **Nearest support / resistance** — from `supportResistance()`.
 *      Anchoring the SL just below a nearby support level makes it "real"
 *      structure (a break of $47 says the thesis is broken) rather than
 *      an arbitrary percentage; the TP anchors to nearest resistance
 *      when doing so keeps risk-reward ≥ 1.5:1.
 *
 * Output is intentionally verbose: a list of `reasons` the UI can
 * translate + a compact `basis` object with the raw numbers so
 * technical users can sanity-check. `stopLossPct` / `takeProfitPct` are
 * fractions **of avgCost** (matching the preset buttons on the paper
 * page) so users can eyeball the P&L those levels correspond to.
 *
 * NOTE: This module is deliberately dependency-light — it takes plain
 * numbers as input so it can be unit-tested without spinning up the
 * bundle pipeline.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type TrendRegime = "bullish" | "bearish" | "sideways" | "unknown";

/**
 * One structured reason bullet. `key` maps to an i18n string on the
 * client, `values` are interpolation values (all pre-formatted as
 * strings so the client doesn't have to reason about locale-specific
 * number formatting).
 */
export interface Reason {
  key:
    | "reason.atr"
    | "reason.trend.bullish"
    | "reason.trend.bearish"
    | "reason.trend.sideways"
    | "reason.support"
    | "reason.resistance"
    | "reason.clampMinRisk"
    | "reason.clampMaxRisk"
    | "reason.rewardMultiple"
    | "reason.fallback";
  values?: Record<string, string | number>;
}

export interface RecommendationBasis {
  /** Last ATR(14) value, or null if too little history. */
  atr14: number | null;
  /** ATR expressed as a percentage of avgCost. */
  atrPct: number | null;
  /** Detected trend regime. */
  trend: TrendRegime;
  /** Human-readable trend label straight from `latestSignals.trend`. */
  trendLabel: string;
  /** Reward-to-risk multiple used to derive the take-profit (e.g. 2.5). */
  rewardMultiple: number;
  /** Nearest support price *below* avgCost, if any. */
  nearestSupport: number | null;
  /** Nearest resistance price *above* avgCost, if any. */
  nearestResistance: number | null;
  /** True if the final SL is anchored to a support level. */
  anchoredToSupport: boolean;
  /** True if the final TP is anchored to a resistance level. */
  anchoredToResistance: boolean;
}

export interface Recommendation {
  /** Absolute price for the stop-loss guard. */
  stopLoss: number;
  /** Absolute price for the take-profit guard. */
  takeProfit: number;
  /**
   * Stop-loss distance from avgCost, as a positive fraction
   * (0.05 = "5% below avg cost").
   */
  stopLossPct: number;
  /**
   * Take-profit distance from avgCost, as a positive fraction
   * (0.15 = "15% above avg cost").
   */
  takeProfitPct: number;
  /** Reward-to-risk ratio implied by the pair (TP-avg) / (avg-SL). */
  riskReward: number;
  /** Structured reason bullets — one line per factor. */
  reasons: Reason[];
  /** Raw numbers backing the recommendation (for expert users). */
  basis: RecommendationBasis;
  /** If true we fell back to a fixed preset because inputs were too thin. */
  fallback: boolean;
}

// Level shape lifted from `lib/indicators.ts` — declared here as a
// minimal interface so this file has zero import surface.
export interface LevelLike {
  price: number;
  strength: number;
}

export interface RecommenderInput {
  avgCost: number;
  /** Latest ATR(14) value from the enriched bundle. `null` if the
   *  history window is too short (< 15 bars). */
  atr14: number | null;
  /** Latest trend string ('Bullish uptrend' / 'Bearish downtrend' /
   *  'Sideways'). Empty string / null falls back to sideways. */
  trendLabel: string | null;
  /** Support levels below current price, strongest first. */
  supports?: LevelLike[];
  /** Resistance levels above current price, strongest first. */
  resistances?: LevelLike[];
}

// -----------------------------------------------------------------------------
// Constants — tuned by feel, documented so future-me knows what to twiddle.
// -----------------------------------------------------------------------------

/** Multiplier applied to ATR to size the base stop distance. */
const ATR_MULTIPLIER = 2;

/**
 * Hard floors/ceilings on stop-loss distance. Even a super-tight ATR
 * shouldn't produce a 1% stop (spread + slippage eats you); even a
 * super-wide one shouldn't push a beginner to a 25% stop.
 */
const MIN_STOP_PCT = 0.03;
const MAX_STOP_PCT = 0.12;

/** Reward-to-risk multiples per regime. Bullish gets the biggest. */
const REWARD_MULTIPLE: Record<TrendRegime, number> = {
  bullish: 3.0,
  sideways: 2.0,
  bearish: 1.5,
  unknown: 2.0,
};

/** When anchoring SL to support, drop this fraction below the level
 *  itself so an intraday wick doesn't stop us out on the actual level. */
const SUPPORT_BUFFER = 0.005;

/** Same idea on the other side — sell into strength *before* the wall. */
const RESISTANCE_BUFFER = 0.005;

/** Minimum acceptable reward-to-risk when anchoring TP to resistance.
 *  Anything below this and we ignore the resistance level and use the
 *  ATR-based target instead — trading through a wall is still a valid
 *  outcome, just not one worth planning around. */
const MIN_ANCHORED_RR = 1.5;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function detectTrend(label: string | null | undefined): TrendRegime {
  if (!label) return "unknown";
  const l = label.toLowerCase();
  if (l.includes("bullish")) return "bullish";
  if (l.includes("bearish")) return "bearish";
  if (l.includes("sideways") || l.includes("flat")) return "sideways";
  return "unknown";
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** Round to 2dp — matches the paper-trading UI's presentation. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Format a fraction as "X.X%" (rounded to 1dp). */
function pctStr(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

/**
 * Compute a recommended SL/TP pair for a long position. All fractional
 * values are relative to `avgCost` so the output composes cleanly with
 * the existing preset buttons.
 */
export function recommendTargets(input: RecommenderInput): Recommendation {
  const { avgCost, atr14, trendLabel, supports = [], resistances = [] } = input;
  const reasons: Reason[] = [];

  if (!Number.isFinite(avgCost) || avgCost <= 0) {
    // Should never happen (validation upstream), but be defensive.
    return fallback(avgCost, "invalid avg cost");
  }

  const trend = detectTrend(trendLabel);
  const trendKey: Reason["key"] =
    trend === "bullish"
      ? "reason.trend.bullish"
      : trend === "bearish"
        ? "reason.trend.bearish"
        : "reason.trend.sideways";

  // -------- 1) Base stop distance from ATR --------
  let baseStopPct: number;
  let atrPct: number | null = null;

  if (atr14 !== null && Number.isFinite(atr14) && atr14 > 0) {
    atrPct = atr14 / avgCost;
    baseStopPct = (atr14 * ATR_MULTIPLIER) / avgCost;
    reasons.push({
      key: "reason.atr",
      values: {
        atr: round2(atr14),
        atrPct: pctStr(atrPct),
        mult: ATR_MULTIPLIER,
      },
    });
  } else {
    // No ATR (fresh listing / illiquid) — pick a sensible mid preset and
    // flag it so the UI can call out that this is a heuristic guess.
    return fallback(avgCost, "no ATR");
  }

  // -------- 2) Trend adjustment --------
  // Tighten stops in weak markets, loosen (a little) in strong ones.
  const trendStopScale =
    trend === "bullish" ? 1.0
    : trend === "sideways" ? 0.85
    : trend === "bearish" ? 0.75
    : 1.0;
  let stopPct = baseStopPct * trendStopScale;

  // -------- 3) Clamp to sane risk band --------
  const preClamp = stopPct;
  stopPct = clamp(stopPct, MIN_STOP_PCT, MAX_STOP_PCT);
  if (stopPct !== preClamp) {
    reasons.push({
      key: preClamp < MIN_STOP_PCT ? "reason.clampMinRisk" : "reason.clampMaxRisk",
      values: {
        limit: pctStr(preClamp < MIN_STOP_PCT ? MIN_STOP_PCT : MAX_STOP_PCT),
      },
    });
  }

  reasons.push({
    key: trendKey,
    values: { label: trendLabel ?? "" },
  });

  // -------- 4) Anchor SL to nearby support if one sits in the band --------
  let anchoredToSupport = false;
  let stopPrice = avgCost * (1 - stopPct);
  const nearestSupport = pickNearestBelow(supports, avgCost);
  if (nearestSupport !== null) {
    const supportStopPrice = nearestSupport * (1 - SUPPORT_BUFFER);
    const supportStopPct = 1 - supportStopPrice / avgCost;
    // Only anchor when the resulting stop is inside the risk band —
    // otherwise it means the closest support is way too far / too close
    // and the ATR heuristic is safer.
    if (supportStopPct >= MIN_STOP_PCT && supportStopPct <= MAX_STOP_PCT) {
      stopPrice = supportStopPrice;
      stopPct = supportStopPct;
      anchoredToSupport = true;
      reasons.push({
        key: "reason.support",
        values: {
          support: round2(nearestSupport),
          price: round2(stopPrice),
        },
      });
    }
  }

  // -------- 5) Take-profit: reward multiple, then maybe anchor to R --------
  const rewardMultiple = REWARD_MULTIPLE[trend];
  let takeProfitPct = stopPct * rewardMultiple;
  let takeProfitPrice = avgCost * (1 + takeProfitPct);
  let anchoredToResistance = false;

  const nearestResistance = pickNearestAbove(resistances, avgCost);
  if (nearestResistance !== null) {
    const resistanceTpPrice = nearestResistance * (1 - RESISTANCE_BUFFER);
    const resistanceTpPct = resistanceTpPrice / avgCost - 1;
    const rrAtResistance = resistanceTpPct / stopPct;
    if (resistanceTpPct > 0 && rrAtResistance >= MIN_ANCHORED_RR) {
      takeProfitPrice = resistanceTpPrice;
      takeProfitPct = resistanceTpPct;
      anchoredToResistance = true;
      reasons.push({
        key: "reason.resistance",
        values: {
          resistance: round2(nearestResistance),
          price: round2(takeProfitPrice),
        },
      });
    }
  }

  if (!anchoredToResistance) {
    reasons.push({
      key: "reason.rewardMultiple",
      values: {
        mult: rewardMultiple,
        risk: pctStr(stopPct),
        reward: pctStr(takeProfitPct),
      },
    });
  }

  const stopLoss = round2(stopPrice);
  const takeProfit = round2(takeProfitPrice);
  // Recompute fractions after rounding so the UI's numbers agree with
  // what actually gets sent to the server.
  const finalStopPct = 1 - stopLoss / avgCost;
  const finalTpPct = takeProfit / avgCost - 1;
  const riskReward = finalStopPct > 0 ? finalTpPct / finalStopPct : 0;

  return {
    stopLoss,
    takeProfit,
    stopLossPct: finalStopPct,
    takeProfitPct: finalTpPct,
    riskReward,
    reasons,
    basis: {
      atr14: round2(atr14),
      atrPct,
      trend,
      trendLabel: trendLabel ?? "",
      rewardMultiple,
      nearestSupport,
      nearestResistance,
      anchoredToSupport,
      anchoredToResistance,
    },
    fallback: false,
  };
}

/**
 * Zero-data fallback: mirror the "moderate" preset (-5% SL / +15% TP).
 * We still fill in `reasons` so the UI can explain that this isn't a
 * data-driven pick.
 */
function fallback(avgCost: number, _why: string): Recommendation {
  const stopPct = 0.05;
  const takeProfitPct = 0.15;
  const stopLoss = round2(avgCost * (1 - stopPct));
  const takeProfit = round2(avgCost * (1 + takeProfitPct));
  return {
    stopLoss,
    takeProfit,
    stopLossPct: stopPct,
    takeProfitPct,
    riskReward: takeProfitPct / stopPct,
    reasons: [{ key: "reason.fallback" }],
    basis: {
      atr14: null,
      atrPct: null,
      trend: "unknown",
      trendLabel: "",
      rewardMultiple: REWARD_MULTIPLE.unknown,
      nearestSupport: null,
      nearestResistance: null,
      anchoredToSupport: false,
      anchoredToResistance: false,
    },
    fallback: true,
  };
}

function pickNearestBelow(levels: LevelLike[], price: number): number | null {
  // supports live below the current close; take the strongest that's
  // strictly below `price`.
  const below = levels.filter((l) => l.price < price && Number.isFinite(l.price));
  if (below.length === 0) return null;
  // Strongest first, then nearest to price as a tiebreaker.
  below.sort((a, b) => b.strength - a.strength || b.price - a.price);
  return below[0]!.price;
}

function pickNearestAbove(levels: LevelLike[], price: number): number | null {
  const above = levels.filter((l) => l.price > price && Number.isFinite(l.price));
  if (above.length === 0) return null;
  above.sort((a, b) => b.strength - a.strength || a.price - b.price);
  return above[0]!.price;
}
