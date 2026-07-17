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

import type { Bar, MacdResult, NullableSeries, SupportResistance } from "./indicators";

export type Verdict = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

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
  /** Overall verdict bucket. */
  verdict: Verdict;
  /** Signed aggregate in [-1, +1] (−1 = maximally bearish, +1 = maximally bullish). */
  score: number;
  /** Fraction of signals that actually fired (0 = no data, 1 = all seven). */
  confidence: number;
  /** Raw counts of bullish / bearish signals. */
  bullishCount: number;
  bearishCount: number;
  /** All rows that contributed, positive or negative (neutral rows omitted). */
  rows: SignalRow[];
  /** Total weight actually voted, for display. */
  totalWeight: number;
  /** Maximum possible weight (denominator used to compute `score`). */
  maxWeight: number;
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

/** Signals are +1 bullish, -1 bearish, 0 neutral. */
type Direction = 1 | -1 | 0;

interface Contribution {
  key: string;
  weight: number;
  direction: Direction;
  category: SignalRow["category"];
  detailEn: string;
  params?: SignalRow["params"];
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
}

/**
 * Compute today's technical verdict.
 *
 * Signals in the current version (weights in parentheses):
 *   1. SMA trend regime (2)            — 50 vs 200 and price vs SMA50
 *   2. Recent cross event (2)          — golden / death cross within 20 bars
 *   3. MACD line vs signal (1)         — momentum
 *   4. RSI(14) zone (1)                — mean-reversion (oversold buy, overbought sell)
 *   5. Bollinger position (1)          — mean-reversion (below-lower buy)
 *   6. Short-term return + volume (1)  — 5-day return with participation
 *   7. Support / resistance proximity (1) — near-support = buy, near-resistance = sell
 *
 * Max attainable weight: 9. The score is (bullish - bearish) / max, in [-1, +1].
 */
export function computeTechnicalSignal(inp: TechnicalInputs): TechnicalSignal {
  const contribs: Contribution[] = [];

  const n = inp.bars.length;
  const closes = inp.bars.map((b) => b.close);
  const lastClose = n > 0 ? closes[n - 1]! : null;

  // ---- 1) SMA trend regime (weight 2) ----------------------------------
  {
    const sma50 = last(inp.sma50);
    const sma200 = last(inp.sma200);
    if (lastClose !== null && sma50 !== null && sma200 !== null) {
      if (sma50 > sma200 && lastClose > sma50) {
        contribs.push({
          key: "trend.up",
          weight: 2,
          direction: 1,
          category: "trend",
          detailEn: "Uptrend: price above SMA-50, SMA-50 above SMA-200.",
        });
      } else if (sma50 < sma200 && lastClose < sma50) {
        contribs.push({
          key: "trend.down",
          weight: 2,
          direction: -1,
          category: "trend",
          detailEn: "Downtrend: price below SMA-50, SMA-50 below SMA-200.",
        });
      }
    }
  }

  // ---- 2) Golden / death cross within last 20 bars (weight 2) ----------
  {
    const golden = detectCross(inp.sma50, inp.sma200, "up", 20);
    const death = detectCross(inp.sma50, inp.sma200, "down", 20);
    if (golden !== null) {
      contribs.push({
        key: "trend.goldenCross",
        weight: 2,
        direction: 1,
        category: "trend",
        detailEn: `Golden cross: SMA-50 crossed above SMA-200 ${golden} bars ago.`,
        params: { bars: golden },
      });
    } else if (death !== null) {
      contribs.push({
        key: "trend.deathCross",
        weight: 2,
        direction: -1,
        category: "trend",
        detailEn: `Death cross: SMA-50 crossed below SMA-200 ${death} bars ago.`,
        params: { bars: death },
      });
    }
  }

  // ---- 3) MACD line vs signal (weight 1) --------------------------------
  {
    const m = last(inp.macd.macd);
    const s = last(inp.macd.signal);
    const h = last(inp.macd.histogram);
    if (m !== null && s !== null) {
      const direction: Direction = m > s ? 1 : m < s ? -1 : 0;
      const detail = direction > 0
        ? `MACD above signal line (histogram ${h !== null ? h.toFixed(3) : "—"}).`
        : direction < 0
        ? `MACD below signal line (histogram ${h !== null ? h.toFixed(3) : "—"}).`
        : "MACD equals its signal line.";
      contribs.push({
        key: direction > 0 ? "macd.bullish" : direction < 0 ? "macd.bearish" : "macd.neutral",
        weight: 1,
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

  // ---- 7) Support / resistance proximity (weight 1) --------------------
  //
  // "Near" = within 2% of the level's price. Nearest support close by is a
  // buy hint (price is bouncing at a known floor); nearest resistance is
  // a sell hint (price is testing a known ceiling).
  {
    if (lastClose !== null) {
      const nearestSup = inp.levels.support[0]; // strongest support is first (client order preserved by API)
      const nearestRes = inp.levels.resistance[0];
      const supDist = nearestSup ? (lastClose - nearestSup.price) / lastClose : null;
      const resDist = nearestRes ? (nearestRes.price - lastClose) / lastClose : null;
      const TOL = 0.02;

      // Pick the *closer* of support/resistance if within tolerance.
      const supHit = supDist !== null && supDist >= 0 && supDist <= TOL;
      const resHit = resDist !== null && resDist >= 0 && resDist <= TOL;

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

  // ---- Aggregate --------------------------------------------------------
  const MAX_WEIGHT = 9; // 2 + 2 + 1 + 1 + 1 + 1 + 1
  let bullishWeight = 0;
  let bearishWeight = 0;
  const rows: SignalRow[] = [];
  for (const c of contribs) {
    if (c.direction === 0) continue;
    const signed = c.weight * c.direction;
    if (signed > 0) bullishWeight += signed;
    else bearishWeight += -signed;
    rows.push({
      key: c.key,
      weight: signed,
      category: c.category,
      detailEn: c.detailEn,
      params: c.params,
    });
  }

  const totalWeight = bullishWeight + bearishWeight;
  const netWeight = bullishWeight - bearishWeight;
  const score = Math.max(-1, Math.min(1, netWeight / MAX_WEIGHT));
  const confidence = totalWeight / MAX_WEIGHT;
  const bullishCount = rows.filter((r) => r.weight > 0).length;
  const bearishCount = rows.filter((r) => r.weight < 0).length;

  return {
    verdict: verdictFromScore(score),
    score,
    confidence,
    bullishCount,
    bearishCount,
    rows,
    totalWeight,
    maxWeight: MAX_WEIGHT,
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
