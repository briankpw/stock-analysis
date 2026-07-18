/**
 * "六指标共振" (Six-Signal Resonance) — a direct TypeScript port of a
 * popular MooMoo / TongDaXin (通达信) formula-language strategy that
 * fires a BUY the moment six fast-tuned momentum checks *all* line up
 * bullish on the same bar.
 *
 * The idea, in one line: single indicators produce false positives all
 * the time, but the probability of six independent ones simultaneously
 * flipping bullish by accident is small — so a fresh alignment is
 * treated as an entry trigger and the ongoing alignment as a hold
 * signal. When any check breaks, resonance ends.
 *
 * The six checks (all use non-standard, fast parameters so the whole
 * system reacts within days rather than weeks):
 *
 *   1. MACD(8, 13, 5)               → DIFF > DEA
 *   2. KDJ(8, 3, 3)                 → K > D
 *   3. RSI 5-period vs 13-period    → RSI5 > RSI13
 *   4. LWR(13, 3, 3)                → LWR1 > LWR2  (smoothed Williams %R fast > slow)
 *   5. BBI = mean(MA 3, 5, 8, 13)   → Close > BBI
 *   6. MTM double-smoothed          → MMS > MMM  (fast > slow smoothed momentum)
 *
 * Original moomoo/TDX script for reference (positions 1–6 map to the six
 * checks; icon id 1 = red-up-arrow bullish, id 2 = green-down-arrow
 * bearish, id 9 = buy marker):
 *
 *   DIFF := EMA(CLOSE,8) - EMA(CLOSE,13);   DEA := EMA(DIFF,5);   TJ1 := DIFF > DEA;
 *   RSV1 := (C - LLV(L,8)) / (HHV(H,8) - LLV(L,8)) * 100;
 *   K := SMA(RSV1,3,1);   D := SMA(K,3,1);   TJ2 := K > D;
 *   RSI1 := SMA(MAX(C-REF(C,1),0),5,1)/SMA(ABS(C-REF(C,1)),5,1)*100;
 *   RSI2 := SMA(MAX(C-REF(C,1),0),13,1)/SMA(ABS(C-REF(C,1)),13,1)*100; TJ3 := RSI1 > RSI2;
 *   RSV2 := -(HHV(H,13)-C)/(HHV(H,13)-LLV(L,13))*100;
 *   LWR1 := SMA(RSV2,3,1);   LWR2 := SMA(LWR1,3,1);   TJ4 := LWR1 > LWR2;
 *   BBI := (MA(C,3)+MA(C,5)+MA(C,8)+MA(C,13))/4;   TJ5 := C > BBI;
 *   MTM := C - REF(C,1);
 *   MMS := 100*EMA(EMA(MTM,5),3)/EMA(EMA(ABS(MTM),5),3);
 *   MMM := 100*EMA(EMA(MTM,13),8)/EMA(EMA(ABS(MTM),13),8);   TJ6 := MMS > MMM;
 *   共振 := TJ1 AND TJ2 AND TJ3 AND TJ4 AND TJ5 AND TJ6;
 *   买入信号 := 共振 AND REF(共振,1)=0;
 */

import {
  type Bar,
  type NullableSeries,
  emaSeeded,
  hhv,
  llv,
  sma,
  smaSmoothed,
} from "./indicators";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type ResonanceCheckId = "macd" | "kdj" | "rsi" | "lwr" | "bbi" | "mtm";

/**
 * The overall stance of the strategy on the *latest* bar.
 *   `buy`         — six checks just turned aligned bullish this bar (fresh long trigger)
 *   `holding`     — six checks are still aligned bullish (long in force)
 *   `sell`        — six checks just turned aligned bearish this bar (fresh short/exit trigger)
 *   `avoid`       — six checks are still aligned bearish (stay out / hold short)
 *   `out`         — mixed, no resonance in either direction (flat)
 *   `warmup`      — not enough bars yet for all indicators to be defined
 *
 * The symmetric `sell` / `avoid` states were added in response to the
 * senior-analyst review's P0 finding that the original formula had no
 * exit rule — users treating "6 bullish align" as a buy had nothing on
 * the sell side beyond the vague "when one breaks, get out", which
 * whipsaws badly.
 */
export type ResonanceVerdict =
  | "buy"
  | "holding"
  | "sell"
  | "avoid"
  | "out"
  | "warmup";

export interface ResonanceCheckState {
  id: ResonanceCheckId;
  /** True if the bullish rule was satisfied on the latest bar. */
  bullish: boolean;
  /** "Fast" reading (e.g. DIFF for MACD, K for KDJ, RSI5, LWR1, Close, MMS). */
  fastValue: number | null;
  /** "Slow" reading (e.g. DEA, D, RSI13, LWR2, BBI, MMM). */
  slowValue: number | null;
  /** `fast − slow`. Positive = bullish, negative = bearish. `null` on warm-up. */
  spread: number | null;
  /** Whether both fast/slow are defined on the latest bar (i.e. check is active). */
  ready: boolean;
}

/**
 * Per-bar state for the "Recent status" visualization — one entry per
 * bar in the trailing history window.
 *
 * Mirrors the TDX script's on-chart output:
 *   * `买入信号` = STICKLINE(...) COLORYELLOW  →  `state === "buy"`   (fresh alignment)
 *   * `共振`     = STICKLINE(...) COLORMAGENTA →  `state === "holding"` (alignment persists)
 *   * (implicit) any other bar                →  `state === "out"`
 *
 * Warm-up bars are excluded from history — they'd render as noisy gray
 * bars at the left edge and add nothing informational.
 */
export interface ResonanceHistoryEntry {
  /** Unix seconds — same clock domain as `Bar.time`. */
  time: number;
  /**
   * State of the whole strategy on that bar. `buy` / `holding` for a
   * fresh or persistent bullish alignment, `sell` / `avoid` for the
   * symmetric bearish side, `out` otherwise.
   */
  state: "buy" | "holding" | "sell" | "avoid" | "out";
  /** How many of the six checks were bullish on that bar (0–6). */
  alignedCount: number;
  /** How many of the six checks were bearish on that bar (0–6). */
  bearishAlignedCount: number;
  /** Close price on this bar. Feeds the strip's per-tick tooltip. */
  close: number;
  /**
   * Close-over-close return vs. the prior bar as a fraction
   * (e.g. `0.012` = +1.2%). `null` for the very first bar of the
   * history window when no prior close is available.
   */
  changePct: number | null;
}

export interface ResonanceResult {
  /** Latest verdict for the whole strategy. */
  verdict: ResonanceVerdict;
  /** How many of the six checks are bullish right now (0–6). */
  alignedCount: number;
  /** How many of the six checks are bearish right now (0–6). */
  bearishAlignedCount: number;
  /** Convenience: all six bullish (equivalent to `alignedCount === 6`). */
  resonance: boolean;
  /** Convenience: all six bearish (equivalent to `bearishAlignedCount === 6`). */
  bearishResonance: boolean;
  /** True only when this bar is the *first* of a fresh bullish alignment. */
  freshBuy: boolean;
  /** True only when this bar is the *first* of a fresh bearish alignment. */
  freshSell: boolean;
  /**
   * How many consecutive bars (ending on the latest) all six checks have
   * been aligned. `0` when not currently aligned. Sign encodes side:
   * positive = bullish streak, negative = bearish streak.
   */
  streak: number;
  /** Bar index of the most recent buy trigger, or `null` if none in history. */
  lastBuyIndex: number | null;
  /** Unix seconds of the most recent buy trigger, or `null` if none. */
  lastBuyTime: number | null;
  /** Bar index of the most recent sell trigger, or `null` if none in history. */
  lastSellIndex: number | null;
  /** Unix seconds of the most recent sell trigger, or `null` if none. */
  lastSellTime: number | null;
  /** Per-check readings so the UI can render each row. */
  checks: ResonanceCheckState[];
  /**
   * Trailing per-bar state, chronological (oldest → latest). Capped at
   * `HISTORY_WINDOW` bars so the JSON payload stays tiny. Empty during
   * warm-up. Feeds the "Recent status" strip in the UI.
   */
  history: ResonanceHistoryEntry[];
  /** Total number of bars evaluated (for warm-up messaging). */
  barsAvailable: number;
  /** True once every indicator produces a value on the latest bar. */
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Minimum bars we need before every check can be evaluated. In practice
// BBI-13 + MTM(13, 8) require ~30 bars for meaningful values; we require
// a slightly larger buffer so early smoothing has time to converge.
const MIN_BARS = 40;

// How many trailing bars of per-bar state we surface to the UI. Sized so
// the "Recent status" strip covers roughly the last 3-4 months of daily
// data — enough for the eye to spot the alignment/exit cadence, small
// enough to keep the JSON payload trivial. Anything older is elided —
// users who need deeper history should use the Charts page.
const HISTORY_WINDOW = 90;

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------

/**
 * Evaluate the 6-signal resonance strategy over a bar series.
 *
 * Pure and deterministic — no external fetches, no time-dependent
 * behaviour beyond the bars you hand in.
 */
export function computeResonance(bars: Bar[]): ResonanceResult {
  const n = bars.length;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  if (n < MIN_BARS) {
    return warmupResult(n);
  }

  // === 1. MACD (8, 13, 5) ================================================
  // Use TDX-style EMA seeding so DIFF/DEA start populating from the first
  // bar (same behaviour a moomoo user would see on-screen).
  const macdFast = emaSeeded(closes, 8);
  const macdSlow = emaSeeded(closes, 13);
  const diff: NullableSeries = closes.map((_, i) => {
    const f = macdFast[i], s = macdSlow[i];
    return f !== null && s !== null ? f - s : null;
  });
  const dea = emaSeeded(diff, 5);

  // === 2. KDJ (8, 3, 3) ==================================================
  const hh8 = hhv(highs, 8);
  const ll8 = llv(lows, 8);
  const rsv1: NullableSeries = closes.map((c, i) => {
    const h = hh8[i], l = ll8[i];
    if (h === null || l === null) return null;
    const range = h - l;
    if (range === 0) return null; // flat window; smaSmoothed carries prev K/D
    return ((c - l) / range) * 100;
  });
  const k = smaSmoothed(rsv1, 3, 1);
  const d = smaSmoothed(k, 3, 1);

  // === 3. RSI 5 vs RSI 13 (TDX / Wilder form) ============================
  const upMove: NullableSeries = closes.map((c, i) =>
    i === 0 ? null : Math.max(c - closes[i - 1]!, 0),
  );
  const absMove: NullableSeries = closes.map((c, i) =>
    i === 0 ? null : Math.abs(c - closes[i - 1]!),
  );
  const rsiOf = (period: number): NullableSeries => {
    const num = smaSmoothed(upMove, period, 1);
    const den = smaSmoothed(absMove, period, 1);
    return closes.map((_, i) => {
      const nv = num[i], dv = den[i];
      if (nv === null || dv === null || dv === 0) return null;
      return (nv / dv) * 100;
    });
  };
  const rsi1 = rsiOf(5);   // fast (short-term momentum)
  const rsi2 = rsiOf(13);  // slow (medium-term momentum)

  // === 4. LWR (Larry Williams %R, smoothed 13/3/3) =======================
  const hh13 = hhv(highs, 13);
  const ll13 = llv(lows, 13);
  const rsv2: NullableSeries = closes.map((c, i) => {
    const h = hh13[i], l = ll13[i];
    if (h === null || l === null) return null;
    const range = h - l;
    if (range === 0) return null;
    return -((h - c) / range) * 100; // → range [-100, 0]
  });
  const lwr1 = smaSmoothed(rsv2, 3, 1);
  const lwr2 = smaSmoothed(lwr1, 3, 1);

  // === 5. BBI (Bull-Bear Index) ==========================================
  const ma3 = sma(closes, 3);
  const ma5 = sma(closes, 5);
  const ma8 = sma(closes, 8);
  const ma13 = sma(closes, 13);
  const bbi: NullableSeries = closes.map((_, i) => {
    const a = ma3[i], b = ma5[i], c = ma8[i], d2 = ma13[i];
    if (a === null || b === null || c === null || d2 === null) return null;
    return (a + b + c + d2) / 4;
  });

  // === 6. MTM double-smoothed ============================================
  const mtm: NullableSeries = closes.map((c, i) =>
    i === 0 ? null : c - closes[i - 1]!,
  );
  const absMtm: NullableSeries = mtm.map((v) => (v === null ? null : Math.abs(v)));

  // MMS = 100 · EMA(EMA(MTM, 5), 3) / EMA(EMA(|MTM|, 5), 3)
  const mmsNum = emaSeeded(emaSeeded(mtm, 5), 3);
  const mmsDen = emaSeeded(emaSeeded(absMtm, 5), 3);
  const mms: NullableSeries = closes.map((_, i) => {
    const nu = mmsNum[i], de = mmsDen[i];
    if (nu === null || de === null || de === 0) return null;
    return (100 * nu) / de;
  });
  // MMM = 100 · EMA(EMA(MTM, 13), 8) / EMA(EMA(|MTM|, 13), 8)
  const mmmNum = emaSeeded(emaSeeded(mtm, 13), 8);
  const mmmDen = emaSeeded(emaSeeded(absMtm, 13), 8);
  const mmm: NullableSeries = closes.map((_, i) => {
    const nu = mmmNum[i], de = mmmDen[i];
    if (nu === null || de === null || de === 0) return null;
    return (100 * nu) / de;
  });

  // ---- Per-bar boolean series for each check ----------------------------
  // Each entry is `true` only when both sides of the comparison are
  // defined AND the fast side is strictly above the slow side. When the
  // check is undefined (still warming up) the value is `null` — treated
  // as "not aligned" for the resonance boolean.
  const tj1 = pairwise(diff, dea, (a, b) => a > b);
  const tj2 = pairwise(k, d, (a, b) => a > b);
  const tj3 = pairwise(rsi1, rsi2, (a, b) => a > b);
  const tj4 = pairwise(lwr1, lwr2, (a, b) => a > b);
  const tj5 = pairwise(closes, bbi, (a, b) => a > b);
  const tj6 = pairwise(mms, mmm, (a, b) => a > b);

  const resonanceSeries: boolean[] = new Array(n).fill(false);
  const bearishResonanceSeries: boolean[] = new Array(n).fill(false);
  // Per-bar "how many of the six checks fired" — used by the history strip
  // to fade partially-aligned bars (5/6 is more informative than 3/6, even
  // though neither is "resonance"). Computed here so the loop below stays
  // linear and we don't re-visit each series a second time.
  //
  // Bearish variant tracks "how many checks are DEFINED and pointing
  // bearish (i.e. tj*[i] === false)" — null (still warming up) is
  // neither bullish nor bearish and doesn't count in either tally.
  const alignedSeries: number[] = new Array(n).fill(0);
  const bearishAlignedSeries: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const b1 = tj1[i] === true ? 1 : 0;
    const b2 = tj2[i] === true ? 1 : 0;
    const b3 = tj3[i] === true ? 1 : 0;
    const b4 = tj4[i] === true ? 1 : 0;
    const b5 = tj5[i] === true ? 1 : 0;
    const b6 = tj6[i] === true ? 1 : 0;
    const bullCount = b1 + b2 + b3 + b4 + b5 + b6;
    const d1 = tj1[i] === false ? 1 : 0;
    const d2 = tj2[i] === false ? 1 : 0;
    const d3 = tj3[i] === false ? 1 : 0;
    const d4 = tj4[i] === false ? 1 : 0;
    const d5 = tj5[i] === false ? 1 : 0;
    const d6 = tj6[i] === false ? 1 : 0;
    const bearCount = d1 + d2 + d3 + d4 + d5 + d6;
    alignedSeries[i] = bullCount;
    bearishAlignedSeries[i] = bearCount;
    resonanceSeries[i] = bullCount === 6;
    bearishResonanceSeries[i] = bearCount === 6;
  }

  // ---- Aggregate on the latest bar --------------------------------------
  const last = n - 1;
  const latestChecks: ResonanceCheckState[] = [
    buildState("macd", diff, dea, tj1, last),
    buildState("kdj",  k,    d,   tj2, last),
    buildState("rsi",  rsi1, rsi2, tj3, last),
    buildState("lwr",  lwr1, lwr2, tj4, last),
    buildState("bbi",  closes, bbi, tj5, last),
    buildState("mtm",  mms,  mmm, tj6, last),
  ];

  const alignedCount = alignedSeries[last]!;
  const bearishAlignedCount = bearishAlignedSeries[last]!;
  const resonance = alignedCount === 6;
  const bearishResonance = bearishAlignedCount === 6;
  const prevResonance = last >= 1 ? resonanceSeries[last - 1] : false;
  const prevBearishResonance = last >= 1 ? bearishResonanceSeries[last - 1] : false;
  const freshBuy = resonance && !prevResonance;
  const freshSell = bearishResonance && !prevBearishResonance;

  // Streak encodes side in the sign: positive for consecutive bullish
  // alignments ending at `last`, negative for consecutive bearish ones.
  // Zero when the latest bar is neither. Users see it as "days-in-force".
  let streak = 0;
  if (resonance) {
    for (let i = last; i >= 0 && resonanceSeries[i]; i--) streak++;
  } else if (bearishResonance) {
    for (let i = last; i >= 0 && bearishResonanceSeries[i]; i--) streak--;
  }

  // Most recent bullish and bearish trigger anywhere in history.
  let lastBuyIndex: number | null = null;
  for (let i = last; i >= 0; i--) {
    const prev = i >= 1 ? resonanceSeries[i - 1] : false;
    if (resonanceSeries[i] && !prev) { lastBuyIndex = i; break; }
  }
  const lastBuyTime = lastBuyIndex !== null ? bars[lastBuyIndex]!.time : null;

  let lastSellIndex: number | null = null;
  for (let i = last; i >= 0; i--) {
    const prev = i >= 1 ? bearishResonanceSeries[i - 1] : false;
    if (bearishResonanceSeries[i] && !prev) { lastSellIndex = i; break; }
  }
  const lastSellTime = lastSellIndex !== null ? bars[lastSellIndex]!.time : null;

  const ready = latestChecks.every((c) => c.ready);
  const verdict: ResonanceVerdict = !ready
    ? "warmup"
    : freshBuy
      ? "buy"
      : freshSell
        ? "sell"
        : resonance
          ? "holding"
          : bearishResonance
            ? "avoid"
            : "out";

  // Build the trailing "recent status" window. One entry per bar, oldest
  // first, up to HISTORY_WINDOW entries. Each entry maps to the TDX
  // script's on-chart output (extended with the symmetric bearish
  // states this port adds on top of the original formula):
  //   • fresh bullish alignment ("买入信号")  → "buy"      (yellow bar)
  //   • ongoing bullish alignment ("共振")    → "holding"  (magenta bar)
  //   • fresh bearish alignment (new)         → "sell"
  //   • ongoing bearish alignment (new)       → "avoid"
  //   • anything else                          → "out"
  const historyStart = Math.max(0, n - HISTORY_WINDOW);
  const history: ResonanceHistoryEntry[] = [];
  for (let i = historyStart; i < n; i++) {
    const bullOn = resonanceSeries[i];
    const bearOn = bearishResonanceSeries[i];
    const prevBull = i >= 1 ? resonanceSeries[i - 1] : false;
    const prevBear = i >= 1 ? bearishResonanceSeries[i - 1] : false;
    let state: "buy" | "holding" | "sell" | "avoid" | "out";
    if (bullOn) state = prevBull ? "holding" : "buy";
    else if (bearOn) state = prevBear ? "avoid" : "sell";
    else state = "out";
    const close = bars[i]!.close;
    const prevClose = i >= 1 ? bars[i - 1]!.close : null;
    const changePct =
      prevClose !== null && prevClose !== 0 ? (close - prevClose) / prevClose : null;
    history.push({
      time: bars[i]!.time,
      state,
      alignedCount: alignedSeries[i]!,
      bearishAlignedCount: bearishAlignedSeries[i]!,
      close,
      changePct,
    });
  }

  return {
    verdict,
    alignedCount,
    bearishAlignedCount,
    resonance,
    bearishResonance,
    freshBuy,
    freshSell,
    streak,
    lastBuyIndex,
    lastBuyTime,
    lastSellIndex,
    lastSellTime,
    checks: latestChecks,
    history,
    barsAvailable: n,
    ready,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Zip two nullable series into a boolean series using `cmp`. Entries
 * where either side is `null` remain `null` so downstream code can tell
 * "undefined" apart from "false". Accepts plain `number[]` on either
 * side too (a `number[]` is a `NullableSeries` at runtime).
 */
function pairwise(
  a: NullableSeries | number[],
  b: NullableSeries | number[],
  cmp: (x: number, y: number) => boolean,
): (boolean | null)[] {
  const n = a.length;
  const out: (boolean | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === null || x === undefined || y === null || y === undefined) continue;
    out[i] = cmp(x, y);
  }
  return out;
}

function buildState(
  id: ResonanceCheckId,
  fast: NullableSeries | number[],
  slow: NullableSeries | number[],
  bullSeries: (boolean | null)[],
  idx: number,
): ResonanceCheckState {
  const f = fast[idx] ?? null;
  const s = slow[idx] ?? null;
  const ready = f !== null && s !== null;
  const spread = ready ? (f as number) - (s as number) : null;
  const bullish = bullSeries[idx] === true;
  return { id, bullish, fastValue: f, slowValue: s, spread, ready };
}

function warmupResult(barsAvailable: number): ResonanceResult {
  const emptyCheck = (id: ResonanceCheckId): ResonanceCheckState => ({
    id, bullish: false, fastValue: null, slowValue: null, spread: null, ready: false,
  });
  return {
    verdict: "warmup",
    alignedCount: 0,
    bearishAlignedCount: 0,
    resonance: false,
    bearishResonance: false,
    freshBuy: false,
    freshSell: false,
    streak: 0,
    lastBuyIndex: null,
    lastBuyTime: null,
    lastSellIndex: null,
    lastSellTime: null,
    checks: (["macd", "kdj", "rsi", "lwr", "bbi", "mtm"] as ResonanceCheckId[]).map(emptyCheck),
    history: [],
    barsAvailable,
    ready: false,
  };
}
