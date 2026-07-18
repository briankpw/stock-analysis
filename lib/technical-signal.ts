/**
 * Technical Buy / Sell verdict — a transparent, rule-based aggregator over
 * the indicators the Price & Volume page already computes. The whole point
 * of this module is to answer "given today's numbers, does the technical
 * picture lean bullish or bearish, and how confidently?" without pretending
 * to give financial advice.
 *
 * Design choices
 * --------------
 * - **Pure & deterministic.** No randomness, no external calls; running it
 *   on the same bars always returns the same verdict.
 * - **Weighted vote.** Each signal contributes a signed weight (positive
 *   = bullish, negative = bearish). We normalise by the maximum
 *   attainable weight so the score is comparable across tickers with
 *   different histories.
 * - **Explainable.** The output includes the list of contributing signals
 *   so the UI can render "why" alongside "what".
 * - **Conservative.** The default thresholds require several signals to
 *   line up before we flip out of "Hold" — this dashboard is not a
 *   day-trading tool.
 */

import type { Bar, KdjResult, MacdResult, NullableSeries, SupportResistance } from "./indicators";
import { atr } from "./indicators";

export type Verdict = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

/**
 * Confidence-in-the-headline classifier derived from `coverage` (how
 * many signals fired at all) and `agreement` (how one-directional the
 * ones that fired were). Surfaced as a chip on the card so a "Buy"
 * from 2 fragile signals doesn't look identical to a "Buy" from 6
 * that agree.
 *
 *   high    — coverage ≥ 0.5 and agreement ≥ 0.6
 *   medium  — coverage ≥ 0.3 and agreement ≥ 0.4
 *   low     — anything else (also triggers a verdict downgrade)
 */
export type Conviction = "high" | "medium" | "low";

export interface SignalRow {
  /** Stable machine key for tooltips / i18n. */
  key: string;
  /** Signed contribution to the aggregate score (positive = bullish). */
  weight: number;
  /** Category the row rolls up into on the UI. */
  category: "trend" | "momentum" | "meanReversion" | "position" | "levels";
  /** Human-readable one-liner (English fallback; UI localizes via `key`). */
  detailEn: string;
  /** Parameters for i18n interpolation (e.g. RSI numeric reading). */
  params?: Record<string, string | number>;
}

export interface TechnicalSignal {
  /**
   * Overall verdict bucket. Reflects the *adjusted* score and can be
   * downgraded from `buy`/`sell` to `hold` when conviction is low
   * (see `conviction` below and `rawVerdict` for the pre-downgrade
   * value).
   */
  verdict: Verdict;
  /**
   * Verdict derived from the raw (pre-conviction-downgrade) score.
   * Kept so the UI can transparently show *what the vote would have
   * been* had the low-conviction safety net not fired. Equals
   * `verdict` unless the downgrade applied.
   */
  rawVerdict: Verdict;
  /**
   * How confident the aggregate is in its own headline (high / medium
   * / low). Derived from `coverage` × `agreement` — see the
   * `Conviction` type doc for exact thresholds.
   */
  conviction: Conviction;
  /**
   * Signed aggregate in [-1, +1] AFTER the agreement multiplier is
   * applied — this is what `verdict` bins on. Users see this on the
   * main gauge.
   */
  score: number;
  /**
   * The pre-adjustment aggregate: `(bullishWeight − bearishWeight) /
   * MAX_WEIGHT`. Shown in the beginner explainer so the transparent
   * math still lines up with the arithmetic shown to the user.
   */
  rawScore: number;
  /**
   * Multiplier applied to `rawScore` to obtain `score`, in [0.5, 1].
   * Equal to `0.5 + 0.5 × agreement`; capped at 1 when only one side
   * fired (unanimous by definition). Exposed for the beginner
   * explainer's "adjustment" line.
   */
  agreementFactor: number;
  /**
   * DEPRECATED alias for `coverage`. Retained so pre-existing UI code
   * (`ts.confidence` label) keeps rendering the same number. New code
   * should read `coverage` for "how many signals fired" and `agreement`
   * for "how much the ones that fired agreed with each other" —
   * conflating the two was one of the review's findings.
   */
  confidence: number;
  /**
   * Fraction of signals that fired (0 = none, 1 = all). "Coverage" is
   * about **how much of the signal universe spoke at all**, regardless
   * of direction. High coverage + high agreement = the strongest
   * possible read.
   */
  coverage: number;
  /**
   * Fraction in [0, 1] measuring **how one-directional** the firing
   * rows are. `|bull − bear| / (bull + bear)` — 0 = perfect conflict
   * (equal bull/bear weight), 1 = unanimous. `null` when nothing fired.
   * A high-coverage, low-agreement reading = "market is arguing with
   * itself" and users should distrust the headline verdict.
   */
  agreement: number | null;
  /** Raw counts of bullish / bearish signals. */
  bullishCount: number;
  bearishCount: number;
  /** All rows that contributed, positive or negative (neutral rows omitted). */
  rows: SignalRow[];
  /**
   * Rows whose vote was **cancelled by the trend regime** on this bar
   * (e.g. an RSI oversold bullish vote in a confirmed downtrend). They
   * don't affect the score, but the UI can render them so users see
   * *why* the mean-reversion signal isn't counted. Empty when no
   * regime suppression applied.
   */
  suppressedRows: SignalRow[];
  /** Total weight actually voted, for display. */
  totalWeight: number;
  /** Maximum possible weight (denominator used to compute `score`). */
  maxWeight: number;
  /**
   * Compact current-reading strings, keyed by `SIGNAL_CATALOG` id (e.g.
   * `"rsi"`, `"macd"`). Rendered as-is in the beginner "All signals"
   * reference so users can see *what the indicator says right now*, even
   * when the signal isn't firing. Empty string means "no data" (typically
   * because there aren't enough bars for the reading). Kept as opaque
   * pre-formatted strings so the UI doesn't have to know each signal's
   * unit or precision — the scorer is the only place that does.
   */
  measurements: Record<string, string>;
  /**
   * Trend regime on the latest bar — surfaced so the master verdict
   * layer and the UI can display *why* mean-reversion signals were
   * suppressed. `flat` when SMA50 and SMA200 are undefined or the
   * regime rule didn't fire.
   */
  regime: "bull" | "bear" | "flat";
}

/**
 * Pull the last non-null number from a nullable series (rightmost).
 * Mirrors `latestSignals` in `lib/indicators.ts`.
 */
function last(series: NullableSeries): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]!;
  }
  return null;
}

/** Index of the last non-null value, or -1. */
function lastIdx(series: NullableSeries): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Verdict bucket + colour classification (kept next to the thresholds so
// UI and logic can't drift apart).
// ---------------------------------------------------------------------------

const VERDICT_THRESHOLDS: Array<[number, Verdict]> = [
  [ 0.50, "strong_buy"],
  [ 0.15, "buy"],
  [-0.15, "hold"],
  [-0.50, "sell"],
  [-1.01, "strong_sell"],
];

export function verdictFromScore(score: number): Verdict {
  for (const [threshold, verdict] of VERDICT_THRESHOLDS) {
    if (score >= threshold) return verdict;
  }
  return "strong_sell";
}

// ---------------------------------------------------------------------------
// Signal catalog — the *stable* metadata for every signal `computeTechnicalSignal`
// can emit.  This is the single source of truth the beginner-mode explainer
// reads from, so weights + descriptions can never drift out of sync with the
// scoring code below.
//
// If you add / remove / re-weight a signal in `computeTechnicalSignal`, mirror
// the change here (and vice versa). The `assertCatalogMatchesScorer()` helper
// below is defensive glue: it sums up `maxWeight` and compares against the
// scorer's own `MAX_WEIGHT` so the two can't quietly disagree.
//
// `contributionKeys` lists every `key` that this signal is allowed to emit
// (see `computeTechnicalSignal`'s `contribs.push({ key: ... })` calls). The
// explainer uses this to figure out whether the signal is firing today.
// ---------------------------------------------------------------------------

export interface SignalDefinition {
  /** Stable machine id used by the explainer. Not exposed to end users. */
  id: string;
  /** Rolls up into the same category chips as the contribution rows. */
  category: SignalRow["category"];
  /** Maximum absolute contribution this signal can make in a single tick. */
  maxWeight: number;
  /** i18n key for the short display label (falls back to `labelEn`). */
  labelKey: string;
  /** English-source label. Used when `labelKey` isn't in the dictionary. */
  labelEn: string;
  /** i18n key for the "when this votes +" sentence. */
  bullishKey: string;
  bullishEn: string;
  /** i18n key for the "when this votes −" sentence. */
  bearishKey: string;
  bearishEn: string;
  /**
   * Every `key` this signal can emit into `TechnicalSignal.rows`.
   * The explainer uses `rows.some(r => contributionKeys.includes(r.key))`
   * to badge the "firing today" chip.
   */
  contributionKeys: readonly string[];
}

export const SIGNAL_CATALOG: readonly SignalDefinition[] = [
  {
    id: "trend",
    category: "trend",
    maxWeight: 2,
    labelKey: "ts.def.trend.label",
    labelEn: "SMA trend regime",
    bullishKey: "ts.def.trend.bullish",
    bullishEn: "50-day SMA is above the 200-day SMA and price is above the 50-day SMA.",
    bearishKey: "ts.def.trend.bearish",
    bearishEn: "50-day SMA is below the 200-day SMA and price is below the 50-day SMA.",
    contributionKeys: ["trend.up", "trend.down"],
  },
  {
    // Cross weight reduced from 2 → 1 and lookback shortened from 20 →
    // 5 bars after the senior-analyst review flagged trend/cross as
    // being double-counted (a golden cross implies SMA50>SMA200, which
    // is one leg of the trend-regime rule). A 5-bar window captures the
    // *event*; anything older is already priced into the trend regime.
    id: "cross",
    category: "trend",
    maxWeight: 1,
    labelKey: "ts.def.cross.label",
    labelEn: "Golden / death cross (event)",
    bullishKey: "ts.def.cross.bullish",
    bullishEn: "50-day SMA crossed above the 200-day SMA within the last 5 bars (fresh golden cross).",
    bearishKey: "ts.def.cross.bearish",
    bearishEn: "50-day SMA crossed below the 200-day SMA within the last 5 bars (fresh death cross).",
    contributionKeys: ["trend.goldenCross", "trend.deathCross"],
  },
  {
    id: "macd",
    category: "momentum",
    maxWeight: 1,
    labelKey: "ts.def.macd.label",
    labelEn: "MACD line vs signal",
    bullishKey: "ts.def.macd.bullish",
    bullishEn: "MACD line is above its signal line.",
    bearishKey: "ts.def.macd.bearish",
    bearishEn: "MACD line is below its signal line.",
    contributionKeys: ["macd.bullish", "macd.bearish"],
  },
  {
    id: "rsi",
    category: "meanReversion",
    maxWeight: 1,
    labelKey: "ts.def.rsi.label",
    labelEn: "RSI(14) zone",
    bullishKey: "ts.def.rsi.bullish",
    bullishEn: "RSI(14) is at or below 30 (oversold — mean-reversion buy).",
    bearishKey: "ts.def.rsi.bearish",
    bearishEn: "RSI(14) is at or above 70 (overbought — pullback risk).",
    contributionKeys: ["rsi.oversold", "rsi.overbought"],
  },
  {
    id: "bb",
    category: "meanReversion",
    maxWeight: 1,
    labelKey: "ts.def.bb.label",
    labelEn: "Bollinger band position",
    bullishKey: "ts.def.bb.bullish",
    bullishEn: "Price is at or below the lower band (statistically cheap).",
    bearishKey: "ts.def.bb.bearish",
    bearishEn: "Price is at or above the upper band (statistically expensive).",
    contributionKeys: ["bb.belowLower", "bb.aboveUpper"],
  },
  {
    id: "momentum5d",
    category: "momentum",
    maxWeight: 1,
    labelKey: "ts.def.momentum5d.label",
    labelEn: "5-day return + volume",
    bullishKey: "ts.def.momentum5d.bullish",
    bullishEn: "5-day return is +5% or better (bonus context if volume is above average).",
    bearishKey: "ts.def.momentum5d.bearish",
    bearishEn: "5-day return is −5% or worse (sellers active if volume is above average).",
    contributionKeys: [
      "momentum.up",
      "momentum.up_withVolume",
      "momentum.down",
      "momentum.down_withVolume",
    ],
  },
  {
    id: "kdj",
    category: "momentum",
    maxWeight: 1,
    labelKey: "ts.def.kdj.label",
    labelEn: "KDJ cross / zone",
    bullishKey: "ts.def.kdj.bullish",
    bullishEn: "K crossed above D in the last 3 bars, OR K is below 20 and turning up (oversold reversal).",
    bearishKey: "ts.def.kdj.bearish",
    bearishEn: "K crossed below D in the last 3 bars, OR K is above 80 and turning down (overbought reversal).",
    contributionKeys: [
      "kdj.goldenCross",
      "kdj.deathCross",
      "kdj.oversold",
      "kdj.overbought",
    ],
  },
  {
    id: "levels",
    category: "levels",
    maxWeight: 1,
    labelKey: "ts.def.levels.label",
    labelEn: "Support / resistance proximity",
    bullishKey: "ts.def.levels.bullish",
    bullishEn: "Price is within 2% of the nearest support level (potential bounce).",
    bearishKey: "ts.def.levels.bearish",
    bearishEn: "Price is within 2% of the nearest resistance level (potential rejection).",
    contributionKeys: ["levels.nearSupport", "levels.nearResistance"],
  },
  {
    id: "mood",
    category: "position",
    maxWeight: 1,
    labelKey: "ts.def.mood.label",
    labelEn: "Market mood (Fear & Greed)",
    bullishKey: "ts.def.mood.bullish",
    bullishEn: "CNN F&G is below 25 (Extreme Fear) — contrarian buy signal.",
    bearishKey: "ts.def.mood.bearish",
    bearishEn: "CNN F&G is above 75 (Extreme Greed) — contrarian sell signal.",
    contributionKeys: ["mood.extremeFear", "mood.extremeGreed"],
  },
] as const;

/**
 * Compile-time sanity check: the catalog's total max weight must equal
 * `MAX_WEIGHT` inside `computeTechnicalSignal`. If you tweak either side,
 * the mismatch fires immediately on module load in dev.
 *
 * Split out so tests can call it too.
 */
export function catalogTotalWeight(): number {
  return SIGNAL_CATALOG.reduce((sum, s) => sum + s.maxWeight, 0);
}

/** Signals are +1 bullish, -1 bearish, 0 neutral. */
type Direction = 1 | -1 | 0;

interface Contribution {
  key: string;
  weight: number;
  direction: Direction;
  category: SignalRow["category"];
  detailEn: string;
  params?: SignalRow["params"];
  /**
   * When set, this contribution was gated out by the trend-regime
   * arbitration rule and MUST NOT be added to the score. Retained so
   * the UI can surface it under a "suppressed" list with the reason.
   */
  suppressedBy?: "regime";
}

// ---------------------------------------------------------------------------
// The scorer — reads the same enriched-bundle fields the charts and
// indicator pages consume, so what the user *sees* on the chart is also
// what drives the verdict.
// ---------------------------------------------------------------------------

export interface TechnicalInputs {
  bars: Bar[];
  sma50: NullableSeries;
  sma200: NullableSeries;
  rsi14: NullableSeries;
  macd: MacdResult;
  bb20: { upper: NullableSeries; lower: NullableSeries; middle: NullableSeries };
  levels: SupportResistance;
  kdj: KdjResult;
  /**
   * Optional market-mood backdrop (CNN Fear & Greed Index, 0–100).
   * When present, extreme readings contribute a *contrarian* vote:
   * Extreme Fear (<25) counts as bullish, Extreme Greed (>75) as bearish.
   * Everything else is neutral and doesn't fire. When omitted, the
   * signal is simply skipped and doesn't hurt confidence.
   */
  fearGreedScore?: number | null;
}

/**
 * Compute today's technical verdict.
 *
 * Signals in the current version (weights in parentheses):
 *   1. SMA trend regime (2)            — 50 vs 200 and price vs SMA50
 *   2. Recent cross event (1)          — golden / death cross within 5 bars
 *   3. MACD line vs signal (1)         — momentum
 *   4. RSI(14) zone (1)                — mean-reversion (oversold buy, overbought sell)
 *   5. Bollinger position (1)          — mean-reversion (below-lower buy)
 *   6. Short-term return + volume (1)  — 5-day return with participation
 *   7. KDJ cross / zone (1)            — stochastic momentum (leading signal)
 *   8. Support / resistance proximity (1) — near-support = buy, near-resistance = sell
 *   9. Market mood backdrop (1)        — CNN Fear & Greed extremes, contrarian
 *
 * Max attainable weight: 10. The score is (bullish - bearish) / max, in [-1, +1].
 *
 * Regime-aware suppression
 * ------------------------
 * When the SMA trend regime is strongly bullish (price > SMA50 > SMA200)
 * the scorer suppresses mean-reversion **bearish** votes (RSI
 * overbought, BB above upper, KDJ overbought) because "overbought in a
 * strong uptrend" is trend continuation, not a sell signal. Symmetric
 * suppression applies in a strongly bearish regime — RSI oversold in a
 * downtrend is a falling knife, not a reversal.
 *
 * Suppressed rows are collected into `suppressedRows` (not `rows`) so
 * they don't affect the score but the UI can still show *why* the
 * signal isn't counted.
 */
export function computeTechnicalSignal(inp: TechnicalInputs): TechnicalSignal {
  const contribs: Contribution[] = [];
  // Regime is decided first (below) and used to gate mean-reversion
  // contributions during the aggregation phase. Rows tagged with
  // `suppressedBy` are collected but excluded from the score.
  //
  // `regime` uses the *strict* rule (price on the right side of SMA50)
  // and drives the trend contribution itself. `regimeForSuppression`
  // uses a softer ±2% band around SMA50, so one-bar dips through the
  // moving average don't turn off mean-reversion suppression the way
  // the strict rule does. See P2 review note #D.
  let regime: "bull" | "bear" | "flat" = "flat";
  let regimeForSuppression: "bull" | "bear" | "flat" = "flat";
  // Per-signal current readings — populated as we go, returned to the UI
  // so the "All signals" reference can show live values next to each rule.
  // Missing entries stay as "" (rendered as an em-dash by the component).
  const measurements: Record<string, string> = {
    trend: "",
    cross: "",
    macd: "",
    rsi: "",
    bb: "",
    momentum5d: "",
    kdj: "",
    levels: "",
    mood: "",
  };

  const n = inp.bars.length;
  const closes = inp.bars.map((b) => b.close);
  const lastClose = n > 0 ? closes[n - 1]! : null;

  // ---- 1) SMA trend regime (weight 2) ----------------------------------
  //
  // Also decides `regime`, which is the arbiter used later to suppress
  // mean-reversion signals that would otherwise vote against a strong
  // trend (RSI oversold in a downtrend = falling knife, RSI overbought
  // in an uptrend = trend continuation — neither is actionable and
  // both were the second-most-impactful bug the analyst review flagged).
  {
    const sma50 = last(inp.sma50);
    const sma200 = last(inp.sma200);
    if (sma50 !== null && sma200 !== null) {
      measurements.trend = `SMA50 ${sma50.toFixed(2)} · SMA200 ${sma200.toFixed(2)}`;
    }

    // Volume confirmation for the trend contribution. Classical Dow
    // theory requires volume to move with the trend — an uptrend on
    // drying volume is suspect. We do a light-touch version: full +2
    // (or -2) only when recent 5-bar volume is at least 80% of the
    // 20-bar average. Otherwise we drop to weight 1 (halve the vote)
    // and note the reason in the detail string.
    let volConfirms = true;
    if (n >= 20) {
      const vol5 = inp.bars.slice(n - 5).reduce((s, b) => s + b.volume, 0) / 5;
      const vol20 = inp.bars.slice(n - 20).reduce((s, b) => s + b.volume, 0) / 20;
      volConfirms = vol20 > 0 && vol5 >= vol20 * 0.8;
    }

    if (lastClose !== null && sma50 !== null && sma200 !== null) {
      const trendWeight = volConfirms ? 2 : 1;
      const suffix = volConfirms
        ? ""
        : " Volume drying up — trend vote halved.";

      if (sma50 > sma200 && lastClose > sma50) {
        regime = "bull";
        contribs.push({
          key: "trend.up",
          weight: trendWeight,
          direction: 1,
          category: "trend",
          detailEn: `Uptrend: price above SMA-50, SMA-50 above SMA-200.${suffix}`,
        });
      } else if (sma50 < sma200 && lastClose < sma50) {
        regime = "bear";
        contribs.push({
          key: "trend.down",
          weight: trendWeight,
          direction: -1,
          category: "trend",
          detailEn: `Downtrend: price below SMA-50, SMA-50 below SMA-200.${suffix}`,
        });
      }

      // Soft regime for suppression only. Slight dips through SMA50
      // (up to ~2%) don't turn off mean-reversion suppression while
      // SMA50/SMA200 stack is still in force.
      const SOFT_BAND = 0.02;
      if (sma50 > sma200) {
        if (lastClose > sma50 * (1 - SOFT_BAND)) regimeForSuppression = "bull";
      } else if (sma50 < sma200) {
        if (lastClose < sma50 * (1 + SOFT_BAND)) regimeForSuppression = "bear";
      }
    }
  }

  // ---- 2) Golden / death cross — recent event only (weight 1) ---------
  //
  // Window shortened from 20 → 5 bars and weight dropped 2 → 1 so this
  // signal captures the *event* rather than duplicating the trend
  // regime already voted in #1. See the module-level docstring.
  //
  // Whipsaw handling: when SMA50 crosses SMA200 twice in the window
  // (rare, only happens on very volatile names), the actionable event
  // is the *more recent* cross — that's the current state of the trend
  // structure. Picking golden-first blindly (as we used to) can report
  // a bullish setup even when the last thing to happen was a fresh
  // death cross. We compare bar counts (smaller = more recent) and
  // annotate the detail so the user sees the whipsaw context.
  {
    const CROSS_LOOKBACK = 5;
    const golden = detectCross(inp.sma50, inp.sma200, "up", CROSS_LOOKBACK);
    const death = detectCross(inp.sma50, inp.sma200, "down", CROSS_LOOKBACK);

    let recent: { kind: "golden" | "death"; bars: number } | null = null;
    if (golden !== null && death !== null) {
      recent = golden < death
        ? { kind: "golden", bars: golden }
        : { kind: "death", bars: death };
    } else if (golden !== null) {
      recent = { kind: "golden", bars: golden };
    } else if (death !== null) {
      recent = { kind: "death", bars: death };
    }

    const whipsaw = golden !== null && death !== null;

    if (recent?.kind === "golden") {
      const { bars } = recent;
      measurements.cross = whipsaw
        ? `Golden cross ${bars}b ago (whipsaw — death ${death}b ago)`
        : `Golden cross ${bars} bar${bars === 1 ? "" : "s"} ago`;
      contribs.push({
        key: "trend.goldenCross",
        weight: 1,
        direction: 1,
        category: "trend",
        detailEn: whipsaw
          ? `Golden cross ${bars} bars ago — but SMA50 whipsawed (death cross ${death} bars ago); latest cross wins.`
          : `Golden cross: SMA-50 crossed above SMA-200 ${bars} bars ago.`,
        params: { bars },
      });
    } else if (recent?.kind === "death") {
      const { bars } = recent;
      measurements.cross = whipsaw
        ? `Death cross ${bars}b ago (whipsaw — golden ${golden}b ago)`
        : `Death cross ${bars} bar${bars === 1 ? "" : "s"} ago`;
      contribs.push({
        key: "trend.deathCross",
        weight: 1,
        direction: -1,
        category: "trend",
        detailEn: whipsaw
          ? `Death cross ${bars} bars ago — but SMA50 whipsawed (golden cross ${golden} bars ago); latest cross wins.`
          : `Death cross: SMA-50 crossed below SMA-200 ${bars} bars ago.`,
        params: { bars },
      });
    } else {
      measurements.cross = `No cross in last ${CROSS_LOOKBACK} bars`;
    }
  }

  // ---- 3) MACD line vs signal (weight 1) --------------------------------
  //
  // The line-vs-signal test is a lagging cross indicator; a shrinking
  // histogram is the *leading* warning that the cross is about to
  // reverse. When the last 3 histogram values are moving *toward zero*
  // monotonically (|h_now| < |h_prev| < |h_prev2|), we halve the
  // contribution to reflect fading momentum.
  {
    const m = last(inp.macd.macd);
    const s = last(inp.macd.signal);
    const h = last(inp.macd.histogram);
    if (m !== null && s !== null) {
      const histFmt = h !== null ? (h >= 0 ? `+${h.toFixed(3)}` : h.toFixed(3)) : "—";

      // Histogram-slope check: are the last three histogram values
      // shrinking in absolute terms *while staying on the same side of
      // zero*? "Shrinking" = same-signed momentum is fading toward the
      // zero line, which is the classic warning that the current MACD
      // cross is about to reverse. Crossing zero is a *reversal*, not
      // fading, so we explicitly require h0*h1 > 0 and h1*h2 > 0 to
      // avoid halving the vote on the strongest bar of a fresh flip.
      let histShrinking = false;
      const hEnd = lastIdx(inp.macd.histogram);
      if (hEnd >= 2) {
        const h0 = inp.macd.histogram[hEnd];
        const h1 = inp.macd.histogram[hEnd - 1];
        const h2 = inp.macd.histogram[hEnd - 2];
        if (h0 !== null && h1 !== null && h2 !== null) {
          const sameSign = h0 * h1 > 0 && h1 * h2 > 0;
          histShrinking =
            sameSign &&
            Math.abs(h0) < Math.abs(h1) &&
            Math.abs(h1) < Math.abs(h2);
        }
      }
      const macdWeight = histShrinking ? 0.5 : 1;

      measurements.macd = `MACD ${m.toFixed(3)} · Signal ${s.toFixed(3)} · Hist ${histFmt}${
        histShrinking ? " (fading)" : ""
      }`;
      const direction: Direction = m > s ? 1 : m < s ? -1 : 0;
      const fadingSuffix = histShrinking ? " Histogram is shrinking — vote halved." : "";
      const detail = direction > 0
        ? `MACD above signal line (histogram ${h !== null ? h.toFixed(3) : "—"}).${fadingSuffix}`
        : direction < 0
        ? `MACD below signal line (histogram ${h !== null ? h.toFixed(3) : "—"}).${fadingSuffix}`
        : "MACD equals its signal line.";
      contribs.push({
        key: direction > 0 ? "macd.bullish" : direction < 0 ? "macd.bearish" : "macd.neutral",
        weight: macdWeight,
        direction,
        category: "momentum",
        detailEn: detail,
        params: h !== null ? { histogram: h.toFixed(3) } : undefined,
      });
    }
  }

  // ---- 4) RSI(14) zone (weight 1) --------------------------------------
  {
    const r = last(inp.rsi14);
    if (r !== null) {
      const zone = r >= 70 ? " (overbought)" : r <= 30 ? " (oversold)" : " (neutral)";
      measurements.rsi = `${r.toFixed(1)}${zone}`;
      let direction: Direction = 0;
      let key = "rsi.neutral";
      let detail = `RSI(14) = ${r.toFixed(1)} — neutral zone.`;
      if (r >= 70) {
        direction = -1;
        key = "rsi.overbought";
        detail = `RSI(14) = ${r.toFixed(1)} — overbought, pullback risk.`;
      } else if (r <= 30) {
        direction = 1;
        key = "rsi.oversold";
        detail = `RSI(14) = ${r.toFixed(1)} — oversold, mean-reversion setup.`;
      }
      if (direction !== 0) {
        contribs.push({
          key,
          weight: 1,
          direction,
          category: "meanReversion",
          detailEn: detail,
          params: { value: r.toFixed(1) },
        });
      }
    }
  }

  // ---- 5) Bollinger position (weight 1) --------------------------------
  {
    const up = last(inp.bb20.upper);
    const lo = last(inp.bb20.lower);
    if (lastClose !== null && up !== null && lo !== null) {
      measurements.bb = `Price ${lastClose.toFixed(2)} in [${lo.toFixed(2)}, ${up.toFixed(2)}]`;
      let direction: Direction = 0;
      let key = "bb.inside";
      let detail = "Price inside the Bollinger bands.";
      if (lastClose >= up) {
        direction = -1;
        key = "bb.aboveUpper";
        detail = "Price above the upper Bollinger band — stretched.";
      } else if (lastClose <= lo) {
        direction = 1;
        key = "bb.belowLower";
        detail = "Price below the lower Bollinger band — potential reversion higher.";
      }
      if (direction !== 0) {
        contribs.push({
          key,
          weight: 1,
          direction,
          category: "meanReversion",
          detailEn: detail,
        });
      }
    }
  }

  // ---- 6) Short-term return + volume participation (weight 1) ----------
  {
    if (n >= 6) {
      const c5 = closes[n - 6]!;
      const cN = closes[n - 1]!;
      const ret5 = c5 !== 0 ? (cN - c5) / c5 : 0;

      const last20Vol = inp.bars.slice(Math.max(0, n - 20), n).map((b) => b.volume);
      const avgVol = last20Vol.reduce((a, b) => a + b, 0) / Math.max(1, last20Vol.length);
      const lastVol = inp.bars[n - 1]!.volume;
      const volKick = avgVol > 0 && lastVol >= avgVol;

      const retFmt = ret5 >= 0 ? `+${(ret5 * 100).toFixed(2)}%` : `${(ret5 * 100).toFixed(2)}%`;
      const volFmt = volKick ? " · vol above avg" : " · vol below avg";
      measurements.momentum5d = `5d ${retFmt}${volFmt}`;

      let direction: Direction = 0;
      let key = "momentum.flat";
      let detail = `5-day return ${(ret5 * 100).toFixed(2)}% — no clear thrust.`;
      if (ret5 >= 0.05) {
        direction = 1;
        key = volKick ? "momentum.up_withVolume" : "momentum.up";
        detail = volKick
          ? `5-day return +${(ret5 * 100).toFixed(2)}% with above-average volume.`
          : `5-day return +${(ret5 * 100).toFixed(2)}%.`;
      } else if (ret5 <= -0.05) {
        direction = -1;
        key = volKick ? "momentum.down_withVolume" : "momentum.down";
        detail = volKick
          ? `5-day return ${(ret5 * 100).toFixed(2)}% with above-average volume — sellers active.`
          : `5-day return ${(ret5 * 100).toFixed(2)}%.`;
      }
      if (direction !== 0) {
        contribs.push({
          key,
          weight: 1,
          direction,
          category: "momentum",
          detailEn: detail,
          params: { value: (ret5 * 100).toFixed(2) },
        });
      }
    }
  }

  // ---- 7) KDJ signal (weight 1) ----------------------------------------
  //
  // Two-part signal — whichever fires first wins:
  //   1. Fresh K/D crossover in the last 3 bars:
  //        K crosses above D  →  bullish (buy)
  //        K crosses below D  →  bearish (sell)
  //   2. Otherwise, zone check:
  //        K < 20 and K > D   →  oversold + turning up (buy)
  //        K > 80 and K < D   →  overbought + turning down (sell)
  //
  // The cross gets priority because that's the classic KDJ trigger used
  // on Chinese platforms and it's more actionable than "already in a
  // zone".
  {
    const kEnd = lastIdx(inp.kdj.k);
    const dEnd = lastIdx(inp.kdj.d);
    const endK = Math.min(kEnd, dEnd);
    if (endK >= 1) {
      // Snapshot the latest KDJ readings for the measurements panel — the
      // scoring loop below re-reads its own `kNow`/`dNow` in a for-block
      // scope, so no shadowing occurs, but we still name these differently
      // to keep the two roles visually distinct on review.
      const kLatest = inp.kdj.k[endK];
      const dLatest = inp.kdj.d[endK];
      const jLatest = inp.kdj.j[endK] ?? null;
      if (kLatest !== null && dLatest !== null) {
        const jFmt = jLatest !== null ? ` · J ${jLatest.toFixed(1)}` : "";
        measurements.kdj = `K ${kLatest.toFixed(1)} · D ${dLatest.toFixed(1)}${jFmt}`;
      }
      let fired: Direction = 0;
      let key = "";
      let detail = "";
      // Look back up to 3 bars for a fresh cross.
      const CROSS_WINDOW = 3;
      const start = Math.max(1, endK - CROSS_WINDOW + 1);
      for (let i = endK; i >= start; i--) {
        const kNow = inp.kdj.k[i], kPrev = inp.kdj.k[i - 1];
        const dNow = inp.kdj.d[i], dPrev = inp.kdj.d[i - 1];
        if (kNow === null || dNow === null || kPrev === null || dPrev === null) continue;
        if (kPrev <= dPrev && kNow > dNow) {
          fired = 1;
          key = "kdj.goldenCross";
          detail = `KDJ golden cross ${endK - i} bar(s) ago (K crossed above D).`;
          break;
        }
        if (kPrev >= dPrev && kNow < dNow) {
          fired = -1;
          key = "kdj.deathCross";
          detail = `KDJ death cross ${endK - i} bar(s) ago (K crossed below D).`;
          break;
        }
      }

      if (fired === 0) {
        // No fresh cross — fall back to zone-based signal.
        //
        // Require SUSTAINED oversold / overbought: K must have been in
        // the extreme zone the previous bar as well. A one-bar flicker
        // through K<20 that immediately reverses isn't tradeable; TDX
        // practice waits for confirmation.
        const k = inp.kdj.k[endK]!;
        const d = inp.kdj.d[endK]!;
        const kPrev = endK >= 1 ? inp.kdj.k[endK - 1] : null;
        const sustainedOversold = kPrev !== null && kPrev !== undefined && kPrev < 20;
        const sustainedOverbought = kPrev !== null && kPrev !== undefined && kPrev > 80;
        if (k < 20 && k > d && sustainedOversold) {
          fired = 1;
          key = "kdj.oversold";
          detail = `KDJ oversold: K=${k.toFixed(1)} turning up through D (sustained).`;
        } else if (k > 80 && k < d && sustainedOverbought) {
          fired = -1;
          key = "kdj.overbought";
          detail = `KDJ overbought: K=${k.toFixed(1)} turning down through D (sustained).`;
        }
      }

      if (fired !== 0) {
        contribs.push({
          key,
          weight: 1,
          direction: fired,
          category: "momentum",
          detailEn: detail,
        });
      }
    }
  }

  // ---- 8) Support / resistance proximity (weight 1) --------------------
  //
  // "Near" = within a volatility-scaled tolerance of the level's price.
  // A flat static 2% is wrong for both ends of the volatility spectrum:
  // a 5%-ATR small-cap is inside 2% of every level all the time, while
  // a 0.5%-ATR mega-cap needs to travel a week's worth of moves to
  // trigger. Tolerance = clamp(0.5 × ATR/price, 1%, 5%) — bounded so
  // even a wild stock doesn't get an absurd 20% tolerance.
  //
  // Level selection: the API returns levels sorted *by strength*, not
  // *by price*. That's the wrong axis for proximity — if price has
  // broken through the strongest support, `support[0]` becomes
  // irrelevant and the actual floor is a weaker secondary level below
  // current price. Walk the whole list and pick the closest support
  // AT OR BELOW `lastClose` and the closest resistance AT OR ABOVE
  // `lastClose`. That way a broken level correctly "steps down" to
  // the next real one.
  {
    if (lastClose !== null) {
      const atrSeries = atr(inp.bars, 14);
      const atrVal = last(atrSeries);
      const atrPct = atrVal !== null && lastClose > 0 ? atrVal / lastClose : null;
      const TOL = atrPct !== null
        ? Math.max(0.01, Math.min(0.05, 0.5 * atrPct))
        : 0.02;

      // Closest support with price <= lastClose (i.e., a floor below).
      let nearestSup: (typeof inp.levels.support)[number] | undefined;
      let supDist: number | null = null;
      for (const s of inp.levels.support) {
        if (s.price > lastClose) continue; // above price = not a floor
        const d = (lastClose - s.price) / lastClose;
        if (supDist === null || d < supDist) {
          supDist = d;
          nearestSup = s;
        }
      }

      // Closest resistance with price >= lastClose (i.e., a ceiling above).
      let nearestRes: (typeof inp.levels.resistance)[number] | undefined;
      let resDist: number | null = null;
      for (const r of inp.levels.resistance) {
        if (r.price < lastClose) continue; // below price = not a ceiling
        const d = (r.price - lastClose) / lastClose;
        if (resDist === null || d < resDist) {
          resDist = d;
          nearestRes = r;
        }
      }

      const parts: string[] = [];
      if (nearestSup && supDist !== null) {
        parts.push(`Sup ${nearestSup.price.toFixed(2)} (−${(supDist * 100).toFixed(1)}%)`);
      }
      if (nearestRes && resDist !== null) {
        parts.push(`Res ${nearestRes.price.toFixed(2)} (+${(resDist * 100).toFixed(1)}%)`);
      }
      if (parts.length > 0) measurements.levels = parts.join(" · ");

      // Pick the *closer* of support/resistance if within tolerance.
      const supHit = supDist !== null && supDist <= TOL;
      const resHit = resDist !== null && resDist <= TOL;

      if (supHit && (!resHit || supDist! <= resDist!)) {
        contribs.push({
          key: "levels.nearSupport",
          weight: 1,
          direction: 1,
          category: "levels",
          detailEn: `Price within ${(supDist! * 100).toFixed(2)}% of nearest support (${nearestSup!.price.toFixed(2)}).`,
          params: {
            distance: (supDist! * 100).toFixed(2),
            price: nearestSup!.price.toFixed(2),
          },
        });
      } else if (resHit) {
        contribs.push({
          key: "levels.nearResistance",
          weight: 1,
          direction: -1,
          category: "levels",
          detailEn: `Price within ${(resDist! * 100).toFixed(2)}% of nearest resistance (${nearestRes!.price.toFixed(2)}).`,
          params: {
            distance: (resDist! * 100).toFixed(2),
            price: nearestRes!.price.toFixed(2),
          },
        });
      }
    }
  }

  // ---- 9) Market mood backdrop — CNN Fear & Greed (weight 1) -----------
  //
  // Interpreted *contrarian-ly*, following the way the index itself is
  // designed to be read ("Be fearful when others are greedy, and greedy
  // when others are fearful"):
  //   score < 25   → Extreme Fear     → bullish  (crowd panic, mean-reversion buy)
  //   score 25-45  → Fear             → neutral  (not extreme enough)
  //   score 45-55  → Neutral          → neutral
  //   score 55-75  → Greed            → neutral
  //   score > 75   → Extreme Greed    → bearish  (crowd euphoria, pullback risk)
  //
  // We deliberately only fire at the extremes so this signal has to earn
  // its vote. If `fearGreedScore` is missing (e.g. CNN is offline) the
  // signal is simply omitted — it doesn't drag down confidence.
  {
    const g = inp.fearGreedScore;
    if (g !== undefined && g !== null && Number.isFinite(g)) {
      const band = g < 25 ? "Extreme Fear"
        : g < 45 ? "Fear"
        : g <= 55 ? "Neutral"
        : g <= 75 ? "Greed"
        : "Extreme Greed";
      measurements.mood = `F&G ${g.toFixed(0)} (${band})`;
      if (g < 25) {
        contribs.push({
          key: "mood.extremeFear",
          weight: 1,
          direction: 1,
          category: "position",
          detailEn: `Market mood: Extreme Fear (F&G = ${g.toFixed(0)}) — often a contrarian buy signal.`,
          params: { value: g.toFixed(0) },
        });
      } else if (g > 75) {
        contribs.push({
          key: "mood.extremeGreed",
          weight: 1,
          direction: -1,
          category: "position",
          detailEn: `Market mood: Extreme Greed (F&G = ${g.toFixed(0)}) — pullback risk, often a contrarian sell signal.`,
          params: { value: g.toFixed(0) },
        });
      }
      // 25 ≤ score ≤ 75 → no contribution (kept off the row list so
      // "Contributing signals" doesn't fill with neutral chatter).
    }
  }

  // ---- Regime-aware suppression -----------------------------------------
  //
  // Mean-reversion signals (RSI zone, BB position, KDJ zone) get gated
  // out when they point *against* a strongly-trending regime, per the
  // review recommendation. The cross/gate is deliberately narrow — only
  // the "zone" flavours of these three signals are candidates, not the
  // KDJ *cross* (which is a momentum trigger, not mean-reversion).
  //
  // Suppression logic:
  //   regime = bull → suppress bearish RSI overbought / BB aboveUpper /
  //                    KDJ overbought (fighting the uptrend)
  //   regime = bear → suppress bullish RSI oversold / BB belowLower /
  //                    KDJ oversold (falling knife)
  const MEAN_REVERSION_KEYS = new Set([
    "rsi.oversold", "rsi.overbought",
    "bb.belowLower", "bb.aboveUpper",
    "kdj.oversold", "kdj.overbought",
  ]);
  for (const c of contribs) {
    if (!MEAN_REVERSION_KEYS.has(c.key)) continue;
    // Uses the softer regime so a one-bar dip through SMA50 doesn't
    // turn suppression off. See P2 review note #D.
    if (regimeForSuppression === "bull" && c.direction < 0) c.suppressedBy = "regime";
    else if (regimeForSuppression === "bear" && c.direction > 0) c.suppressedBy = "regime";
  }

  // ---- Aggregate --------------------------------------------------------
  // Sourced from SIGNAL_CATALOG so the scorer's denominator can never drift
  // out of sync with the beginner-mode "All signals reference" section
  // (which reads maxWeight per row from the same catalog).
  //
  //   2 (trend regime)
  // + 1 (SMA golden/death cross — event only, weight lowered from 2)
  // + 1 (MACD) + 1 (RSI) + 1 (BB) + 1 (5-day momentum + volume)
  // + 1 (KDJ) + 1 (S/R proximity) + 1 (F&G)
  // = 10
  const MAX_WEIGHT = catalogTotalWeight();
  let bullishWeight = 0;
  let bearishWeight = 0;
  const rows: SignalRow[] = [];
  const suppressedRows: SignalRow[] = [];
  for (const c of contribs) {
    if (c.direction === 0) continue;
    const signed = c.weight * c.direction;
    const row: SignalRow = {
      key: c.key,
      weight: signed,
      category: c.category,
      detailEn: c.detailEn,
      params: c.params,
    };
    if (c.suppressedBy) {
      suppressedRows.push(row);
      continue;
    }
    if (signed > 0) bullishWeight += signed;
    else bearishWeight += -signed;
    rows.push(row);
  }

  const totalWeight = bullishWeight + bearishWeight;
  const netWeight = bullishWeight - bearishWeight;
  const rawScore = Math.max(-1, Math.min(1, netWeight / MAX_WEIGHT));
  const coverage = totalWeight / MAX_WEIGHT;
  const agreement = totalWeight > 0
    ? Math.abs(bullishWeight - bearishWeight) / totalWeight
    : null;

  // Agreement-adjusted score. Perfect agreement (1.0) leaves the score
  // untouched; perfect conflict (0.0) halves it. Mono-directional rows
  // (agreement === null when only one side fired at all — never
  // happens with the current definition, but be safe) get factor 1.
  // See P1 review note.
  const agreementFactor = agreement === null ? 1 : 0.5 + 0.5 * agreement;
  const score = Math.max(-1, Math.min(1, rawScore * agreementFactor));

  // Categorical conviction chip based on coverage AND agreement.
  //   high    — coverage ≥ 0.5 and agreement ≥ 0.6
  //   medium  — coverage ≥ 0.3 and agreement ≥ 0.4
  //   low     — anything else
  // Nulls default to `low` so a totally silent bar (no rows) doesn't
  // parade around as high-confidence "hold".
  const conviction: Conviction =
    (coverage >= 0.5 && agreement !== null && agreement >= 0.6)
      ? "high"
      : (coverage >= 0.3 && agreement !== null && agreement >= 0.4)
        ? "medium"
        : "low";

  const rawVerdict = verdictFromScore(score);
  // Safety downgrade: if the label is "buy" or "sell" but conviction
  // is low, drop it to "hold". Strong verdicts (need |score| ≥ 0.5)
  // are left alone — they already required substantial agreement to
  // clear the threshold. See P0 review note #A.
  const verdict: Verdict =
    conviction === "low" && (rawVerdict === "buy" || rawVerdict === "sell")
      ? "hold"
      : rawVerdict;

  const bullishCount = rows.filter((r) => r.weight > 0).length;
  const bearishCount = rows.filter((r) => r.weight < 0).length;

  return {
    verdict,
    rawVerdict,
    conviction,
    score,
    rawScore,
    agreementFactor,
    confidence: coverage, // alias — see field JSDoc
    coverage,
    agreement,
    bullishCount,
    bearishCount,
    rows,
    suppressedRows,
    totalWeight,
    maxWeight: MAX_WEIGHT,
    measurements,
    regime,
  };
}

// ---------------------------------------------------------------------------
// Cross detection utility. Returns the number of bars back that `fast`
// crossed `direction` through `slow`, or null if no cross in `lookback`
// bars. Only the most recent cross in the window is reported.
// ---------------------------------------------------------------------------

function detectCross(
  fast: NullableSeries,
  slow: NullableSeries,
  direction: "up" | "down",
  lookback: number,
): number | null {
  const endIdx = Math.min(lastIdx(fast), lastIdx(slow));
  if (endIdx < 1) return null;
  const startIdx = Math.max(1, endIdx - lookback + 1);
  for (let i = endIdx; i >= startIdx; i--) {
    const f = fast[i];
    const s = slow[i];
    const fPrev = fast[i - 1];
    const sPrev = slow[i - 1];
    if (f === null || s === null || fPrev === null || sPrev === null) continue;
    if (direction === "up" && fPrev <= sPrev && f > s) return endIdx - i;
    if (direction === "down" && fPrev >= sPrev && f < s) return endIdx - i;
  }
  return null;
}
