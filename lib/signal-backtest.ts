/**
 * Signal backtest engine.
 *
 * Runs the app's own signal calculators — Technical Signal, 6-Signal
 * Resonance, or Master Verdict — over historical OHLCV bars and
 * simulates the resulting BUY / HOLD / SELL decisions as a series of
 * fills. Answers "if I had traded this signal on this ticker over
 * this period, what would my P&L look like?".
 *
 * ## Design decisions
 *
 * * **Pure & deterministic.** No I/O, no clocks. Callers pre-fetch
 *   bars (`fetchHistory`) and hand them in. Given identical inputs
 *   the output is byte-for-byte identical, which makes the engine
 *   trivially unit-testable and safe to memoise on the client.
 *
 * * **Look-ahead-safe.** At every bar `i` the signal is re-evaluated
 *   against `bars.slice(0, i + 1)` (not the full history), and any
 *   indicator that computes with a forward-looking window
 *   (`supportResistance` in particular) is re-derived per bar via
 *   `enrich()`. That's O(n²) in bar count but small enough for daily
 *   bars over a few years — the alternative would silently peek at
 *   future bars via the pivots.
 *
 * * **Execution timing is explicit.** The signal *fires* on close of
 *   bar `i`. Two fills are possible:
 *
 *     * `sameClose` — order fills at `bars[i].close`. Simplest, but
 *       imagines you could see the close before it printed. Useful
 *       for a "what would the visible verdict have told me?" view
 *       that lines up with the on-screen chart.
 *     * `nextOpen` — order fills at `bars[i + 1].open`. Realistic
 *       (you saw the signal on Monday's close, you traded Tuesday's
 *       open). The last bar's signal is *not* traded because there
 *       is no next-open — the engine emits it in the log as an
 *       "unfilled" note.
 *
 * * **Full-cycle only.** No margin / shorts / stops. When the signal
 *   flips bearish while flat, nothing happens; when it flips bullish
 *   while long, nothing happens. This mirrors what a beginner using
 *   the on-screen verdict would do and keeps the metrics
 *   intelligible.
 *
 * * **Three sizing modes:**
 *     * `all_in` — spend 100% of available cash on each BUY. Simplest;
 *       matches how the on-screen verdict says "here's the call".
 *     * `fixed_shares` — always trade the same share count. Under-
 *       fills silently if cash runs out.
 *     * `percent_equity` — spend `pct * equity_at_this_bar` on each
 *       BUY, cap-fitted to available cash. `equity` includes any open
 *       position valued at the fill price.
 *
 * ## Stop-loss / take-profit overlay
 *
 * Optional. Off by default so the raw "does the signal work?" story
 * stays untouched. When enabled, the caller supplies a `targets`
 * config (fixed-percent or "smart" — the latter derives per-entry
 * levels via `lib/target-recommender.ts` using ATR, trend, and the
 * nearest support/resistance levels).
 *
 * Per-bar order of operations inside the loop:
 *
 *   1. If a position is open AND was entered on a previous bar,
 *      check whether this bar's OHLC touched the SL or TP. If so,
 *      close the position (see `checkTargetHit` for the exact
 *      gap-aware fill-price rule) BEFORE evaluating the signal.
 *   2. Evaluate the signal on `bars.slice(0, i + 1)`.
 *   3. Trade signal-driven (BUY if intent flipped bullish and we're
 *      flat, SELL if intent flipped bearish and we're long).
 *   4. Record equity.
 *
 * If both SL and TP would fire on the same bar, we conservatively
 * assume the STOP hit first — the safest read when the intra-bar
 * order can't be inferred from OHLC alone.
 *
 * ## Not implemented (yet)
 *
 * * Intraday bars (engine is bar-agnostic; caller passes bars,
 *   granularity is whatever the caller fetched — but the "next open"
 *   mode assumes trading gaps between bars).
 * * Commissions per trade — the engine reports gross P&L. Adding a
 *   commission is a trivial subtract-per-trade but skipped for
 *   clarity of the "what does the signal alone do?" story.
 * * Dividends / corporate actions.
 * * Short selling on bearish signals — flat is flat.
 * * Trailing stops (only fixed SL/TP is supported — trailing would
 *   require tracking the position's high-water mark and is a bigger
 *   feature that's better handled as its own strategy overlay).
 */

import type { Bar } from "./indicators";
import { ema, enrich, latestSignals, rsi, sma } from "./indicators";
import { computeTechnicalSignal, type Verdict } from "./technical-signal";
import { computeResonance, type ResonanceVerdict } from "./resonance";
import { computeMasterVerdict } from "./master-verdict";
import { recommendTargets, type Recommendation } from "./target-recommender";
import { BACKTEST_STRATEGY_PARAMS } from "./backtest-strategy-config";

// ---------------------------------------------------------------------------
// Public config types
// ---------------------------------------------------------------------------

/**
 * Which of the three headline signals drives BUY/SELL decisions.
 *
 * ### Composite (multi-indicator) strategies
 *
 * * `technical` — 9-signal weighted score → `Verdict`.
 * * `resonance` — 6-signal moomoo strategy → `ResonanceVerdict`.
 * * `master`    — fused technical + resonance (fundamentals/news are
 *   NOT available historically, so this reduces to a "technical +
 *   resonance" master; coverage will report lower than the live UI).
 *
 * ### Single-indicator strategies (for baseline / educational comparison)
 *
 * These map straight to the same indicators the Charts & Indicators
 * page renders. Each computes a simple bull/bear/neutral intent from
 * that indicator alone — no filtering, no confirmation. That's the
 * *point*: they let a user see whether the composite signals above
 * add real value over the textbook single-indicator baseline.
 *
 * All of them are **state-based** (not cross-detection): the intent
 * is derived from the CURRENT bar's indicator values, and the engine
 * only fires a trade when the intent flips relative to the current
 * position. This is equivalent to cross-detection for monotone rules
 * (e.g. `sma50 > sma200` flips exactly on the golden cross) but is
 * simpler to reason about and side-steps subtle stateful bugs.
 *
 * * `sma_cross`        — Long while fast SMA > slow SMA (classic "Golden
 *                        Cross"). Defaults 50/200, env-tunable via
 *                        `NEXT_PUBLIC_BACKTEST_SMA_FAST` / `_SLOW`.
 * * `ema_cross`        — Long while fast EMA > slow EMA (a faster trend
 *                        follower). Defaults 20/52, env-tunable via
 *                        `NEXT_PUBLIC_BACKTEST_EMA_FAST` / `_SLOW`.
 * * `macd_cross`       — Long while MACD line > Signal line.
 * * `rsi_reversion`    — BUY when RSI ≤ oversold, SELL when RSI ≥
 *                        overbought. Defaults RSI(14) with 30/70
 *                        thresholds, env-tunable via
 *                        `NEXT_PUBLIC_BACKTEST_RSI_PERIOD` /
 *                        `_OVERSOLD` / `_OVERBOUGHT`.
 * * `kdj_cross`        — Long while K > D (KDJ golden/death cross).
 * * `bbands_reversion` — BUY at lower band, SELL at upper band (mean reversion).
 * * `sr_bounce`        — BUY near a support level (holding), SELL near a resistance level (rejected).
 *
 * See `evaluateAt` for the exact per-bar rules and `minBarsFor` for
 * the warm-up thresholds. Beginner-mode UI (see
 * `components/backtest-advice.tsx`) surfaces a per-strategy failure
 * mode so users don't read raw returns without context.
 */
export type BacktestStrategy =
  | "technical"
  | "resonance"
  | "master"
  | "sma_cross"
  | "ema_cross"
  | "macd_cross"
  | "rsi_reversion"
  | "kdj_cross"
  | "bbands_reversion"
  | "sr_bounce";

/**
 * When the simulated order fills once a signal fires on `bars[i]`.
 *
 * * `nextOpen`   — realistic: `bars[i+1].open`. Last bar unfilled.
 * * `sameClose`  — matches the on-screen verdict: `bars[i].close`.
 */
export type ExecutionTiming = "nextOpen" | "sameClose";

/**
 * Position sizing on each BUY. Sells always close the full open
 * position (single lot / no partial exits from the signal alone).
 */
export type SizingConfig =
  | { kind: "all_in" }
  | {
      kind: "fixed_shares";
      /** How many shares to buy each time. Cash-constrained (will
       *  under-fill if cash is insufficient). */
      shares: number;
    }
  | {
      kind: "percent_equity";
      /** Fraction of current equity to deploy per buy, in (0, 1]. */
      pct: number;
    };

/**
 * Optional stop-loss / take-profit overlay on top of any strategy.
 * See the module header for the per-bar order of operations.
 *
 * * `off`          — no protective exits; only signal flips close a position.
 * * `fixed_pct`    — SL at `entry × (1 − stopLossPct)`, TP at
 *                    `entry × (1 + takeProfitPct)`. Levels are recomputed
 *                    for each fresh entry (so the last position's SL
 *                    can't linger and clip the next one).
 * * `smart`        — derive per-entry levels via
 *                    `lib/target-recommender.ts` from the enrichment at
 *                    the entry bar (ATR, trend regime, and nearest
 *                    support/resistance). Same recommender the paper-
 *                    trading "Smart pick" button uses live, but running
 *                    against historical bars.
 *
 * Both percent values are positive fractions of the entry price
 * (0.05 = 5%, not 5). Zero or missing values disable that side of the
 * bracket independently, so a caller can set an SL without a TP or
 * vice versa.
 */
export type TargetsConfig =
  | { kind: "off" }
  | {
      kind: "fixed_pct";
      /** Positive fraction of entry price; e.g. 0.05 = 5% stop.
       *  0 or missing disables the SL side of the bracket. */
      stopLossPct?: number;
      /** Positive fraction of entry price; e.g. 0.15 = 15% target.
       *  0 or missing disables the TP side of the bracket. */
      takeProfitPct?: number;
    }
  | { kind: "smart" };

export interface BacktestConfig {
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  sizing: SizingConfig;
  /** Cash the portfolio starts with. Must be positive. */
  startingCash: number;
  /**
   * Optional CNN Fear & Greed score to feed to the technical scorer.
   * Historical F&G is not available, so this is either the current
   * value (which the caller can pass through so the "recent" section
   * of the backtest reflects reality) or `null` to skip the F&G
   * contribution entirely. Documented as an intentional degradation
   * rather than silently pretending F&G was constant across history.
   */
  fearGreedScore?: number | null;
  /**
   * Optional stop-loss / take-profit overlay. Defaults to
   * `{ kind: "off" }` — the raw signal-only behaviour the module was
   * originally shipped with.
   */
  targets?: TargetsConfig;
}

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

/**
 * Origin of a trade — used both by the metrics roll-up (how many
 * exits were signal-driven vs. protective stops) and by the trade-
 * log rendering (which lets the UI colour SL/TP exits differently
 * so they stand out against the signal flow).
 */
export type ExitReason = "signal" | "stop_loss" | "take_profit";

/** A simulated trade. Chronological when in the trade log. */
export interface BacktestTrade {
  /** Unix seconds of the BAR that emitted the signal. */
  signalBarTime: number;
  /** Unix seconds of the BAR whose price was used to fill. Equals
   *  `signalBarTime` for `sameClose`, or the next bar's time for
   *  `nextOpen`. Kept separate so the UI can show "signal Mon, filled
   *  Tue" honestly. */
  fillBarTime: number;
  side: "buy" | "sell";
  shares: number;
  price: number;
  /** Cash after this trade (drops on buys, rises on sells). */
  cashAfter: number;
  /** Reason recorded on the trade — the verdict that triggered it,
   *  plus a compact human summary the UI shows in a tooltip. Includes
   *  "stop-loss @ $X" / "take-profit @ $X" strings for protective
   *  exits. */
  reason: string;
  /**
   * Machine-readable classification of what triggered this trade.
   * BUYs are always `"signal"`. SELLs are `"stop_loss"`,
   * `"take_profit"`, or `"signal"` depending on whether a target
   * fired first or the signal flipped bearish.
   */
  exitReason: ExitReason;
  /** Realised P&L for this trade. Populated only on SELLS (a buy has
   *  no realised gain until later sold). */
  realizedPnl: number | null;
  /**
   * On BUYs, the SL price attached to this entry — `null` when the
   * config didn't set one. On SELLs, always `null` (the exit consumed
   * the level).
   */
  stopLossAt: number | null;
  /** Same as `stopLossAt` but for take-profit. */
  takeProfitAt: number | null;
}

export interface EquityPoint {
  time: number;
  /** `cash + (open shares × bar's close)`. */
  equity: number;
  /** Same, but for a passive buy-and-hold portfolio: (startingCash /
   *  firstEligibleClose) × currentClose. Kept parallel so the UI can
   *  render "signal vs. buy & hold" without a second walk. */
  buyHoldEquity: number;
  /** Signal-driven cash balance at this bar (post any fill that
   *  bar). */
  cash: number;
  /** Open shares at this bar. Used by the UI so the equity curve can
   *  render a shaded band where the portfolio was actually invested. */
  positionShares: number;
}

export interface BacktestMetrics {
  /** Final equity — cash + last close × open shares. */
  finalEquity: number;
  /** `(finalEquity - startingCash) / startingCash`. */
  totalReturn: number;
  /** Same but for the passive buy-and-hold benchmark. */
  buyHoldReturn: number;
  /** Annualised return. Uses (final/start)^(365 / days) − 1 with days
   *  = calendar days between first and last bar. `null` when the
   *  window spans < 30 days (too short to be meaningful). */
  cagr: number | null;
  /** Same, buy-and-hold. */
  buyHoldCagr: number | null;
  /** Peak-to-trough equity drawdown, expressed as a positive fraction
   *  (e.g. 0.22 = 22% down from the peak). */
  maxDrawdown: number;
  /** Buy-and-hold's max drawdown, for comparison. */
  buyHoldMaxDrawdown: number;
  /** Fraction of round-trips that closed at a gain. `null` when there
   *  were no closed trips. */
  winRate: number | null;
  /** `|avg win / avg loss|`. `null` when either half is empty. */
  payoffRatio: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  tradeCount: number;
  /** Round trips (open then close). `tradeCount / 2` for tidy data;
   *  can be `tradeCount / 2 - 0.5` when the backtest ends with an
   *  open position. */
  roundTrips: number;
  /** Days between first and last bar (calendar, not trading). */
  spanDays: number;
  /**
   * Approximate fraction of the backtest window during which the
   * strategy held a position (0 = never in the market, 1 = always
   * long). Helps contextualise the return — a strategy that beats
   * buy-and-hold but was only invested 10% of the time is a very
   * different animal from one that was invested 100% and still won.
   */
  exposureFraction: number;
  /**
   * Breakdown of SELLs by what triggered them. Sums to the number
   * of SELL trades. Always populated (all-zero when SL/TP is off).
   * Surfaced so the results UI can show "3 exits by signal, 2 by
   * stop-loss, 1 by take-profit" — a beginner cue that the SL/TP
   * overlay is actively shaping the strategy's behaviour.
   */
  exitCounts: {
    signal: number;
    stopLoss: number;
    takeProfit: number;
  };
}

export interface BacktestResult {
  /** Echo of the config the caller supplied. Kept so the UI can label
   *  the report without re-plumbing state. */
  config: BacktestConfig;
  /** Warm-up bar count (before this index, the signal isn't defined
   *  enough to trade). Reflected in the equity curve as a flat
   *  cash-only prefix so users see when trading really started. */
  warmupBars: number;
  /**
   * Number of bars considered by the engine (may be less than the
   * caller-provided array if pre-warm-up bars are counted).
   */
  totalBars: number;
  /** Per-bar equity + benchmark. Length = `bars.length` (starts flat
   *  during warm-up). */
  equityCurve: EquityPoint[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  /**
   * When true, the very last signal fired but its `nextOpen` fill
   * couldn't happen because there's no bar after it. Surfaced so the
   * UI can render "last bar's verdict = BUY, would fill next open"
   * as a call-to-action.
   */
  hasUnfilledFinalSignal: boolean;
  /**
   * The verdict on the last bar, whatever the strategy. `null` when
   * warm-up wasn't cleared. Included so the UI doesn't have to re-run
   * the compute path on the client just to render "current call".
   */
  finalVerdict: string | null;
}

// ---------------------------------------------------------------------------
// Warm-up requirements per strategy
// ---------------------------------------------------------------------------

// Technical scorer wants sma200 to be meaningful for the trend row.
// It'll compute earlier — the row just won't fire — but the score is
// too thin to trust. 200 daily bars ≈ 10 months, which matches the
// "these bars must produce a real signal" bar we use in the live UI.
const TECHNICAL_MIN_BARS = 200;
// Resonance already refuses to compute below 40 bars (see
// `resonance.ts::MIN_BARS`). We match its threshold rather than
// picking our own so the two agree.
const RESONANCE_MIN_BARS = 40;
// Master needs both to be defined at once — pick the max.
const MASTER_MIN_BARS = Math.max(TECHNICAL_MIN_BARS, RESONANCE_MIN_BARS);

// ---- Single-indicator warm-ups -----------------------------------------
// Each threshold is "smallest number of bars for the indicator to
// produce a value we're willing to trade on". Some are the raw
// indicator warm-up + a couple of bars headroom so the first trade
// isn't at the first non-null datum.
//
// SMA / EMA / RSI floors derive from the env-configurable strategy
// params so a user who tunes SMA_SLOW down from 200 to (say) 100
// doesn't need to wait 200 bars before the first signal can fire.
// See `lib/backtest-strategy-config.ts`.
const SMA_CROSS_MIN_BARS = BACKTEST_STRATEGY_PARAMS.smaCross.slow;
// Fast EMA becomes stable at ~fast bars; slow EMA at ~slow. Add a
// small headroom so we don't trade on the very first stable value.
const EMA_CROSS_MIN_BARS = BACKTEST_STRATEGY_PARAMS.emaCross.slow + 8;
const MACD_CROSS_MIN_BARS = 34;      // MACD(12,26,9): 26 + 9 = 35 bars for signal
// RSI(N) needs N bars; add a few bars so we don't fire on the first
// datum right at the boundary.
const RSI_REVERSION_MIN_BARS =
  BACKTEST_STRATEGY_PARAMS.rsiReversion.period + 6;
const KDJ_CROSS_MIN_BARS = 20;       // KDJ(9,3,3): warm-up ~15
const BBANDS_MIN_BARS = 25;          // BB(20,2) + a few bars headroom
const SR_BOUNCE_MIN_BARS = 60;       // supportResistance needs enough pivots to matter

function minBarsFor(strategy: BacktestStrategy): number {
  switch (strategy) {
    case "technical":         return TECHNICAL_MIN_BARS;
    case "resonance":         return RESONANCE_MIN_BARS;
    case "master":            return MASTER_MIN_BARS;
    case "sma_cross":         return SMA_CROSS_MIN_BARS;
    case "ema_cross":         return EMA_CROSS_MIN_BARS;
    case "macd_cross":        return MACD_CROSS_MIN_BARS;
    case "rsi_reversion":     return RSI_REVERSION_MIN_BARS;
    case "kdj_cross":         return KDJ_CROSS_MIN_BARS;
    case "bbands_reversion":  return BBANDS_MIN_BARS;
    case "sr_bounce":         return SR_BOUNCE_MIN_BARS;
  }
}

// ---------------------------------------------------------------------------
// Verdict → intent
// ---------------------------------------------------------------------------

type Intent = "bull" | "bear" | "neutral";

function technicalIntent(v: Verdict): Intent {
  if (v === "buy" || v === "strong_buy") return "bull";
  if (v === "sell" || v === "strong_sell") return "bear";
  return "neutral";
}

function resonanceIntent(v: ResonanceVerdict): Intent {
  if (v === "buy" || v === "holding") return "bull";
  if (v === "sell" || v === "avoid") return "bear";
  return "neutral"; // out / warmup
}

// Master verdict reuses the technical `Verdict` alphabet — same
// mapping applies.
const masterIntent = technicalIntent;

// ---------------------------------------------------------------------------
// Signal compute per bar
// ---------------------------------------------------------------------------

interface PerBarSignal {
  intent: Intent;
  /** Compact label for the trade reason — e.g. "technical: buy". */
  verdictLabel: string;
}

function evaluateAt(
  strategy: BacktestStrategy,
  barsUpToNow: Bar[],
  fearGreedScore: number | null | undefined,
): PerBarSignal {
  // Re-enrich per bar. This is the expensive step (O(n) inside `enrich`
  // × O(n) bars = O(n²)) but it's the only way to keep
  // `supportResistance` from peeking at future pivots via its symmetric
  // window. For daily bars over even 20 years that's ~5000 bars and
  // still finishes in well under a second on any modern laptop.
  const e = enrich(barsUpToNow);
  if (strategy === "technical") {
    const sig = computeTechnicalSignal({
      bars: e.bars,
      sma50: e.sma50,
      sma200: e.sma200,
      rsi14: e.rsi14,
      macd: e.macd,
      bb20: e.bb20,
      levels: e.levels,
      kdj: e.kdj,
      fearGreedScore: fearGreedScore ?? null,
    });
    return {
      intent: technicalIntent(sig.verdict),
      verdictLabel: `technical: ${sig.verdict}`,
    };
  }
  if (strategy === "resonance") {
    const res = computeResonance(e.bars);
    return {
      intent: resonanceIntent(res.verdict),
      verdictLabel: `resonance: ${res.verdict}`,
    };
  }
  if (strategy === "master") {
    const tech = computeTechnicalSignal({
      bars: e.bars,
      sma50: e.sma50,
      sma200: e.sma200,
      rsi14: e.rsi14,
      macd: e.macd,
      bb20: e.bb20,
      levels: e.levels,
      kdj: e.kdj,
      fearGreedScore: fearGreedScore ?? null,
    });
    const res = computeResonance(e.bars);
    // Historical fundamentals / news / F&G aren't recorded, so we pass
    // null for those — the master gracefully degrades to a technical +
    // resonance blend with reduced coverage. Documented in this
    // module's header so users understand the historical master is
    // *not* apples-to-apples with the live one.
    const m = computeMasterVerdict({
      technical: tech,
      resonance: res,
      fundamentals: null,
      sentiment: null,
      fearGreedScore: fearGreedScore ?? null,
    });
    return {
      intent: masterIntent(m.verdict),
      verdictLabel: `master: ${m.verdict}`,
    };
  }

  // -------------------------------------------------------------------
  // Single-indicator strategies. All state-based: read the CURRENT
  // bar's indicator values and derive intent. The engine handles the
  // rest (fires trades only when intent flips relative to position).
  // -------------------------------------------------------------------
  return singleIndicatorSignal(strategy, e);
}

/**
 * State-based per-bar intent for the single-indicator strategies.
 *
 * Extracted from `evaluateAt` so the composite branches above stay
 * readable. Each `case` reads the LAST value of the relevant
 * enriched series and maps it to `Intent`. `null` (warm-up or
 * indicator undefined for this bar) always maps to `neutral` —
 * safer than silently defaulting to bull/bear when the indicator
 * hasn't printed yet.
 */
function singleIndicatorSignal(
  strategy: Exclude<
    BacktestStrategy,
    "technical" | "resonance" | "master"
  >,
  e: ReturnType<typeof enrich>,
): PerBarSignal {
  const n = e.closes.length;
  const lastClose = n > 0 ? e.closes[n - 1]! : null;

  const lastNonNull = (s: (number | null)[]): number | null => {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] !== null) return s[i]!;
    }
    return null;
  };

  // Env-driven strategy tuning — see `lib/backtest-strategy-config.ts`
  // for the parsing / validation. Read into local const so the
  // switch bodies below are readable at a glance and don't repeat
  // the `BACKTEST_STRATEGY_PARAMS.` prefix on every reference.
  const { smaCross: SMA, emaCross: EMA, rsiReversion: RSI } =
    BACKTEST_STRATEGY_PARAMS;

  switch (strategy) {
    case "sma_cross": {
      // Classic "Golden Cross" / "Death Cross": long while the fast
      // SMA sits above the slow SMA. Both crosses are implicit in
      // the intent-flip semantics of the engine. Windows are env-
      // configurable (defaults 50/200) — when the user has customised
      // them we bypass the pre-computed `e.sma50`/`e.sma200` series
      // and compute the requested pair locally. `evaluateAt`
      // already re-enriches per bar so an extra O(n) sma() call here
      // is negligible relative to the enclosing O(n²) walk.
      const fastSeries =
        SMA.fast === 50 ? e.sma50 : sma(e.closes, SMA.fast);
      const slowSeries =
        SMA.slow === 200 ? e.sma200 : sma(e.closes, SMA.slow);
      const fast = lastNonNull(fastSeries);
      const slow = lastNonNull(slowSeries);
      if (fast === null || slow === null) {
        return { intent: "neutral", verdictLabel: "sma_cross: warmup" };
      }
      const label = fast > slow
        ? `sma${SMA.fast} > sma${SMA.slow}`
        : `sma${SMA.fast} < sma${SMA.slow}`;
      return {
        intent: fast > slow ? "bull" : fast < slow ? "bear" : "neutral",
        verdictLabel: `sma_cross: ${label}`,
      };
    }

    case "ema_cross": {
      // Faster trend follower than SMA cross. Defaults to EMA20 vs
      // EMA52 (matches Elder's "impulse" system); when the user has
      // customised the windows we compute the requested pair
      // locally. See the sma_cross comment above for the O-cost
      // rationale.
      const fastSeries =
        EMA.fast === 20 ? e.ema20 : ema(e.closes, EMA.fast);
      const slowSeries =
        EMA.slow === 52 ? e.ema52 : ema(e.closes, EMA.slow);
      const fast = lastNonNull(fastSeries);
      const slow = lastNonNull(slowSeries);
      if (fast === null || slow === null) {
        return { intent: "neutral", verdictLabel: "ema_cross: warmup" };
      }
      const label = fast > slow
        ? `ema${EMA.fast} > ema${EMA.slow}`
        : `ema${EMA.fast} < ema${EMA.slow}`;
      return {
        intent: fast > slow ? "bull" : fast < slow ? "bear" : "neutral",
        verdictLabel: `ema_cross: ${label}`,
      };
    }

    case "macd_cross": {
      const line = lastNonNull(e.macd.macd);
      const signal = lastNonNull(e.macd.signal);
      if (line === null || signal === null) {
        return { intent: "neutral", verdictLabel: "macd_cross: warmup" };
      }
      return {
        intent: line > signal ? "bull" : line < signal ? "bear" : "neutral",
        verdictLabel: `macd_cross: ${line > signal ? "macd > signal" : "macd < signal"}`,
      };
    }

    case "rsi_reversion": {
      // Textbook contrarian rule: buy when the crowd is capitulating
      // (RSI ≤ oversold), sell when it's frothy (RSI ≥ overbought).
      // Between the boundaries we hold whatever we've got — flipping
      // to neutral on every intermediate bar would cause spurious
      // re-entries when RSI wanders back into the boundary from the
      // middle. Period + thresholds are env-configurable (defaults
      // 14 / 30 / 70).
      const rsiSeries =
        RSI.period === 14 ? e.rsi14 : rsi(e.closes, RSI.period);
      const r = lastNonNull(rsiSeries);
      if (r === null) {
        return { intent: "neutral", verdictLabel: "rsi_reversion: warmup" };
      }
      if (r <= RSI.oversold) {
        return {
          intent: "bull",
          verdictLabel: `rsi_reversion: rsi ${r.toFixed(1)} (oversold ≤ ${RSI.oversold})`,
        };
      }
      if (r >= RSI.overbought) {
        return {
          intent: "bear",
          verdictLabel: `rsi_reversion: rsi ${r.toFixed(1)} (overbought ≥ ${RSI.overbought})`,
        };
      }
      return {
        intent: "neutral",
        verdictLabel: `rsi_reversion: rsi ${r.toFixed(1)} (hold)`,
      };
    }

    case "kdj_cross": {
      const k = lastNonNull(e.kdj.k);
      const d = lastNonNull(e.kdj.d);
      if (k === null || d === null) {
        return { intent: "neutral", verdictLabel: "kdj_cross: warmup" };
      }
      return {
        intent: k > d ? "bull" : k < d ? "bear" : "neutral",
        verdictLabel: `kdj_cross: ${k > d ? "k > d" : "k < d"}`,
      };
    }

    case "bbands_reversion": {
      // Mean-reversion: at or below the lower band → buy (statistically
      // cheap); at or above the upper band → sell (statistically
      // expensive). Inside the bands → hold whatever we've got.
      const upper = lastNonNull(e.bb20.upper);
      const lower = lastNonNull(e.bb20.lower);
      if (lastClose === null || upper === null || lower === null) {
        return { intent: "neutral", verdictLabel: "bbands_reversion: warmup" };
      }
      if (lastClose <= lower) {
        return {
          intent: "bull",
          verdictLabel: "bbands_reversion: close ≤ lower band",
        };
      }
      if (lastClose >= upper) {
        return {
          intent: "bear",
          verdictLabel: "bbands_reversion: close ≥ upper band",
        };
      }
      return {
        intent: "neutral",
        verdictLabel: "bbands_reversion: inside bands",
      };
    }

    case "sr_bounce": {
      // "Buy at support, sell at resistance". Rule:
      //
      //   * Look at all support levels <= last close; take the highest
      //     (nearest below). If close is within 2% above it, the price
      //     is "sitting on support" — bullish (assumes support holds).
      //   * Symmetric for resistance above.
      //   * If both fire (price boxed in), prefer neutral — the
      //     signal has no clean bias.
      //
      // S&R is inherently fuzzy; this rule captures the on-screen
      // intuition ("bounced off support") without pretending to be
      // precise. Users see the level names in the verdict label.
      if (lastClose === null) {
        return { intent: "neutral", verdictLabel: "sr_bounce: warmup" };
      }
      const tolerance = 0.02;

      let nearestSupport: number | null = null;
      for (const s of e.levels.support) {
        if (s.price <= lastClose) {
          if (nearestSupport === null || s.price > nearestSupport) {
            nearestSupport = s.price;
          }
        }
      }
      const nearSupport =
        nearestSupport !== null &&
        (lastClose - nearestSupport) / lastClose <= tolerance;

      let nearestResistance: number | null = null;
      for (const r of e.levels.resistance) {
        if (r.price >= lastClose) {
          if (nearestResistance === null || r.price < nearestResistance) {
            nearestResistance = r.price;
          }
        }
      }
      const nearResistance =
        nearestResistance !== null &&
        (nearestResistance - lastClose) / lastClose <= tolerance;

      if (nearSupport && !nearResistance) {
        return {
          intent: "bull",
          verdictLabel: `sr_bounce: bouncing off support ${nearestSupport!.toFixed(2)}`,
        };
      }
      if (nearResistance && !nearSupport) {
        return {
          intent: "bear",
          verdictLabel: `sr_bounce: rejected at resistance ${nearestResistance!.toFixed(2)}`,
        };
      }
      // Boxed-in, no clean bias, or neither level nearby → hold.
      return {
        intent: "neutral",
        verdictLabel: "sr_bounce: mid-range",
      };
    }
    default: {
      // Exhaustiveness guard: if a new BacktestStrategy value is
      // added and this switch isn't updated, TypeScript will error
      // here at compile time.
      const _exhaustive: never = strategy;
      throw new Error(`Unhandled backtest strategy: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------

/**
 * Convert a sizing directive + current portfolio state into a share
 * count. Returns 0 when nothing should be bought (insufficient cash
 * or a nonsense request); callers should treat that as "skip this
 * signal, don't record a zero-share trade".
 *
 * `equity` is what the equity would be *before* the buy (cash + open
 * shares × fill price). Used only by percent_equity.
 */
function sharesForBuy(
  sizing: SizingConfig,
  cash: number,
  fillPrice: number,
  equity: number,
): number {
  if (fillPrice <= 0) return 0;
  if (sizing.kind === "all_in") {
    // Whole shares only — matches how a real broker would fill a
    // "spend $X" market order most of the time (fractional-share
    // trading exists but isn't universal, and fractional shares
    // would push the metrics to look better than a real user would
    // actually see).
    const s = Math.floor(cash / fillPrice);
    return s > 0 ? s : 0;
  }
  if (sizing.kind === "fixed_shares") {
    const wanted = Math.max(0, Math.floor(sizing.shares));
    const affordable = Math.floor(cash / fillPrice);
    return Math.min(wanted, affordable);
  }
  // percent_equity
  const pct = Math.min(1, Math.max(0.001, sizing.pct));
  const budget = Math.min(cash, equity * pct);
  const s = Math.floor(budget / fillPrice);
  return s > 0 ? s : 0;
}

// ---------------------------------------------------------------------------
// Stop-loss / take-profit helpers
// ---------------------------------------------------------------------------

interface TargetHit {
  price: number;
  reason: "stop_loss" | "take_profit";
}

/**
 * Check whether a bar's OHLC touched the stop-loss or take-profit
 * price attached to an open long position. Returns the exit fill
 * price and reason on hit, or `null` when neither triggered.
 *
 * Gap-aware:
 *   * If the OPEN is at/beyond the SL (gap down), we fill at the
 *     open — worse than the stop itself, matching real-world
 *     "market opens 5% below the stop" behaviour.
 *   * Symmetric on the TP side: an open at/above the TP fills at
 *     the open (a favourable gap the trader would happily take).
 *
 * When both SL and TP would fire on the same bar (a wide-range
 * outside bar that hits both levels), we conservatively return the
 * STOP hit. Real intra-bar order can't be inferred from OHLC alone,
 * and pretending TP fired first would systematically inflate
 * returns in backtests where volatility is high.
 */
function checkTargetHit(
  bar: Bar,
  stopLoss: number | null,
  takeProfit: number | null,
): TargetHit | null {
  if (stopLoss !== null) {
    if (bar.open <= stopLoss) {
      return { price: bar.open, reason: "stop_loss" };
    }
    if (bar.low <= stopLoss) {
      return { price: stopLoss, reason: "stop_loss" };
    }
  }
  if (takeProfit !== null) {
    if (bar.open >= takeProfit) {
      return { price: bar.open, reason: "take_profit" };
    }
    if (bar.high >= takeProfit) {
      return { price: takeProfit, reason: "take_profit" };
    }
  }
  return null;
}

/**
 * Derive the SL/TP pair that should be attached to a fresh entry.
 * Pure function — takes the config, the fill price the entry landed
 * at, and the history up to (and including) the signal bar so the
 * `smart` mode can enrich against exactly the same window the
 * signal saw.
 *
 * Returns `null` on each side of the bracket independently when the
 * config didn't set it (or the smart recommender bailed for lack of
 * data — extremely rare given the strategy's warm-up threshold).
 */
function deriveTargets(
  config: TargetsConfig,
  fillPrice: number,
  barsUpToNow: Bar[],
): { stopLoss: number | null; takeProfit: number | null } {
  if (config.kind === "off") return { stopLoss: null, takeProfit: null };
  if (config.kind === "fixed_pct") {
    const sl =
      config.stopLossPct && config.stopLossPct > 0
        ? fillPrice * (1 - config.stopLossPct)
        : null;
    const tp =
      config.takeProfitPct && config.takeProfitPct > 0
        ? fillPrice * (1 + config.takeProfitPct)
        : null;
    return { stopLoss: sl, takeProfit: tp };
  }
  // config.kind === "smart" — reuse the paper-trading recommender
  // against the enrichment at this bar. Runs O(n) each buy, not each
  // bar, so the O(n²) engine budget is unaffected.
  const e = enrich(barsUpToNow);
  const signals = latestSignals(e);
  let atr14: number | null = null;
  for (let k = e.atr14.length - 1; k >= 0; k--) {
    const v = e.atr14[k];
    if (v !== null && Number.isFinite(v)) {
      atr14 = v;
      break;
    }
  }
  const rec: Recommendation = recommendTargets({
    avgCost: fillPrice,
    atr14,
    trendLabel: signals.trend,
    supports: e.levels.support,
    resistances: e.levels.resistance,
  });
  return { stopLoss: rec.stopLoss, takeProfit: rec.takeProfit };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runBacktest(bars: Bar[], config: BacktestConfig): BacktestResult {
  const totalBars = bars.length;
  const equityCurve: EquityPoint[] = new Array(totalBars);
  const trades: BacktestTrade[] = [];
  const warmupBars = minBarsFor(config.strategy);
  const targetsConfig: TargetsConfig = config.targets ?? { kind: "off" };

  let cash = config.startingCash;
  let openShares = 0;
  // FIFO isn't necessary here (we never sell partial lots) — a single
  // running average cost suffices for realised-P&L attribution.
  let avgCost = 0;
  let firstEligibleClose: number | null = null;
  let buyHoldShares = 0;
  let peakEquity = -Infinity;
  let maxDrawdown = 0;
  let buyHoldPeak = -Infinity;
  let buyHoldMaxDrawdown = 0;
  let barsInPosition = 0;
  let hasUnfilledFinalSignal = false;
  let finalVerdict: string | null = null;

  // Protective-exit state — the SL/TP levels attached to the current
  // open position (or null when we're flat / targets are off), and the
  // bar index the position was opened on. We only check SL/TP hits on
  // bars AFTER the entry bar so the entry-price boundary can't
  // spuriously trigger a same-bar exit.
  let stopLossAt: number | null = null;
  let takeProfitAt: number | null = null;
  let entryBarIndex = -1;
  const exitCounts = { signal: 0, stopLoss: 0, takeProfit: 0 };

  // Trade replay stats — computed inline instead of a second pass to
  // keep the engine single-loop and stay under the O(n²) budget.
  let winCount = 0;
  let lossCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let roundTrips = 0;

  // We evaluate the signal on bar i (using bars[0..i]) and, per the
  // execution config, either fill on bars[i].close (`sameClose`) or
  // bars[i+1].open (`nextOpen`). We record equity on bars[i].close
  // for every bar so the curve always has one point per bar — trades
  // that happened between the sample points still get reflected in
  // the next bar's cash / position.
  for (let i = 0; i < totalBars; i++) {
    const bar = bars[i]!;

    if (i < warmupBars) {
      // Pre-warm-up: no signal, no benchmark yet. Cash-only equity.
      equityCurve[i] = {
        time: bar.time,
        equity: cash,
        buyHoldEquity: config.startingCash,
        cash,
        positionShares: 0,
      };
      continue;
    }

    // Establish the buy-and-hold benchmark on the FIRST post-warm-up
    // bar so it starts from the same instant the signal-driven
    // strategy does. Uses the same fill-timing convention as the
    // strategy — `sameClose` uses this bar's close, `nextOpen` waits
    // for the next bar's open. Corner case: on the very last bar in
    // `nextOpen` mode, buy-and-hold *also* can't fill, so it stays
    // flat and the "b&h return" for a one-bar window is 0.
    if (firstEligibleClose === null) {
      const bhFillPrice =
        config.execution === "sameClose"
          ? bar.close
          : i + 1 < totalBars
            ? bars[i + 1]!.open
            : null;
      if (bhFillPrice !== null && bhFillPrice > 0) {
        buyHoldShares = config.startingCash / bhFillPrice;
        firstEligibleClose = bhFillPrice;
      }
    }

    // ---- 1) Protective exit check ------------------------------------
    // Runs BEFORE the signal so that an intra-bar stop takes priority
    // over any bullish flip that might also happen on this bar (e.g. a
    // whipsaw candle that dips through the stop then recovers to close
    // green). Only fires from the bar AFTER entry — the entry bar itself
    // is skipped because the entry price is inside its own range, which
    // would allow a same-bar SL "hit" from a wick that predated the
    // fill.
    if (
      openShares > 0 &&
      entryBarIndex >= 0 &&
      i > entryBarIndex &&
      (stopLossAt !== null || takeProfitAt !== null)
    ) {
      const hit = checkTargetHit(bar, stopLossAt, takeProfitAt);
      if (hit) {
        const proceeds = openShares * hit.price;
        const realizedPnl = (hit.price - avgCost) * openShares;
        cash += proceeds;
        trades.push({
          signalBarTime: bar.time,
          fillBarTime: bar.time,
          side: "sell",
          shares: openShares,
          price: hit.price,
          cashAfter: cash,
          reason:
            hit.reason === "stop_loss"
              ? `stop-loss @ $${hit.price.toFixed(2)}`
              : `take-profit @ $${hit.price.toFixed(2)}`,
          exitReason: hit.reason,
          realizedPnl,
          stopLossAt: null,
          takeProfitAt: null,
        });
        if (realizedPnl > 0) {
          winCount += 1;
          winSum += realizedPnl;
        } else if (realizedPnl < 0) {
          lossCount += 1;
          lossSum += realizedPnl;
        }
        roundTrips += 1;
        if (hit.reason === "stop_loss") exitCounts.stopLoss += 1;
        else exitCounts.takeProfit += 1;
        openShares = 0;
        avgCost = 0;
        stopLossAt = null;
        takeProfitAt = null;
        entryBarIndex = -1;
      }
    }

    // ---- 2) Evaluate the signal on close of bar i --------------------
    const signal = evaluateAt(
      config.strategy,
      bars.slice(0, i + 1),
      config.fearGreedScore,
    );
    finalVerdict = signal.verdictLabel;

    // Decide what to trade.
    //   intent went bear → sell any open position
    //   intent went bull → buy if flat
    // We don't emit trades when the intent is `neutral` — that maps
    // to "hold" on both strategies and matches user intuition.
    const wantSell = signal.intent === "bear" && openShares > 0;
    const wantBuy = signal.intent === "bull" && openShares <= 1e-9;

    if (wantBuy || wantSell) {
      const canFillSameBar = config.execution === "sameClose";
      const canFillNextOpen =
        config.execution === "nextOpen" && i + 1 < totalBars;
      if (canFillSameBar || canFillNextOpen) {
        const fillBar = canFillSameBar ? bar : bars[i + 1]!;
        const fillPrice = canFillSameBar ? bar.close : fillBar.open;

        if (wantBuy) {
          const equity = cash + openShares * fillPrice;
          const shares = sharesForBuy(config.sizing, cash, fillPrice, equity);
          if (shares > 0) {
            const cost = shares * fillPrice;
            cash -= cost;
            openShares = shares;
            avgCost = fillPrice;
            // Derive the protective bracket for THIS entry. Note we
            // pass bars-up-to-signal (not up-to-fill) so `smart` mode
            // sees exactly the same history the signal did — otherwise
            // nextOpen would leak one bar of future info into the
            // recommender.
            const targets = deriveTargets(
              targetsConfig,
              fillPrice,
              bars.slice(0, i + 1),
            );
            stopLossAt = targets.stopLoss;
            takeProfitAt = targets.takeProfit;
            // Skip SL/TP checks on the fill bar itself (see checkTargetHit
            // docs). Under sameClose the entry is at close so bar i has no
            // remaining range anyway; under nextOpen the entry is at bar
            // i+1's open, so we skip that bar too.
            entryBarIndex = canFillSameBar ? i : i + 1;
            trades.push({
              signalBarTime: bar.time,
              fillBarTime: fillBar.time,
              side: "buy",
              shares,
              price: fillPrice,
              cashAfter: cash,
              reason: signal.verdictLabel,
              exitReason: "signal",
              realizedPnl: null,
              stopLossAt: targets.stopLoss,
              takeProfitAt: targets.takeProfit,
            });
          }
        } else {
          // wantSell — close the whole position via signal flip.
          const proceeds = openShares * fillPrice;
          const realizedPnl = (fillPrice - avgCost) * openShares;
          cash += proceeds;
          trades.push({
            signalBarTime: bar.time,
            fillBarTime: fillBar.time,
            side: "sell",
            shares: openShares,
            price: fillPrice,
            cashAfter: cash,
            reason: signal.verdictLabel,
            exitReason: "signal",
            realizedPnl,
            stopLossAt: null,
            takeProfitAt: null,
          });
          if (realizedPnl > 0) {
            winCount += 1;
            winSum += realizedPnl;
          } else if (realizedPnl < 0) {
            lossCount += 1;
            lossSum += realizedPnl;
          }
          roundTrips += 1;
          exitCounts.signal += 1;
          openShares = 0;
          avgCost = 0;
          stopLossAt = null;
          takeProfitAt = null;
          entryBarIndex = -1;
        }
      } else if (wantBuy && i === totalBars - 1) {
        // Final bar's signal is bullish but we're in nextOpen mode —
        // no bar after this one to fill on. Record the unfilled call
        // so the UI can show "would BUY tomorrow" as a live cue.
        hasUnfilledFinalSignal = true;
      }
    }

    // Record equity + benchmark AFTER any fill this bar so the curve
    // reflects the post-trade state at bar close.
    const equity = cash + openShares * bar.close;
    const buyHoldEquity = buyHoldShares * bar.close;
    equityCurve[i] = {
      time: bar.time,
      equity,
      buyHoldEquity: buyHoldShares > 0 ? buyHoldEquity : config.startingCash,
      cash,
      positionShares: openShares,
    };
    if (equity > peakEquity) peakEquity = equity;
    if (peakEquity > 0) {
      const dd = (peakEquity - equity) / peakEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    if (buyHoldShares > 0) {
      if (buyHoldEquity > buyHoldPeak) buyHoldPeak = buyHoldEquity;
      if (buyHoldPeak > 0) {
        const bhDd = (buyHoldPeak - buyHoldEquity) / buyHoldPeak;
        if (bhDd > buyHoldMaxDrawdown) buyHoldMaxDrawdown = bhDd;
      }
    }
    if (openShares > 0) barsInPosition += 1;
  }

  // ---- Metrics --------------------------------------------------------
  const lastBar = bars[totalBars - 1];
  const finalEquity =
    lastBar !== undefined
      ? cash + openShares * lastBar.close
      : config.startingCash;
  const buyHoldFinalEquity =
    lastBar !== undefined && buyHoldShares > 0
      ? buyHoldShares * lastBar.close
      : config.startingCash;

  const totalReturn =
    config.startingCash > 0
      ? (finalEquity - config.startingCash) / config.startingCash
      : 0;
  const buyHoldReturn =
    config.startingCash > 0
      ? (buyHoldFinalEquity - config.startingCash) / config.startingCash
      : 0;

  const spanSeconds =
    lastBar !== undefined && bars[0] !== undefined
      ? Math.max(0, lastBar.time - bars[0]!.time)
      : 0;
  const spanDays = spanSeconds / 86_400;

  const cagr =
    spanDays >= 30 && finalEquity > 0 && config.startingCash > 0
      ? Math.pow(finalEquity / config.startingCash, 365 / spanDays) - 1
      : null;
  const buyHoldCagr =
    spanDays >= 30 && buyHoldFinalEquity > 0 && config.startingCash > 0
      ? Math.pow(buyHoldFinalEquity / config.startingCash, 365 / spanDays) - 1
      : null;

  const closedRoundTrips = winCount + lossCount;
  const winRate =
    closedRoundTrips > 0 ? winCount / closedRoundTrips : null;
  const averageWin = winCount > 0 ? winSum / winCount : null;
  const averageLoss = lossCount > 0 ? lossSum / lossCount : null;
  const payoffRatio =
    averageWin !== null && averageLoss !== null && averageLoss !== 0
      ? Math.abs(averageWin / averageLoss)
      : null;

  const exposureFraction =
    totalBars > warmupBars
      ? Math.min(1, barsInPosition / (totalBars - warmupBars))
      : 0;

  return {
    config,
    warmupBars,
    totalBars,
    equityCurve,
    trades,
    metrics: {
      finalEquity,
      totalReturn,
      buyHoldReturn,
      cagr,
      buyHoldCagr,
      maxDrawdown,
      buyHoldMaxDrawdown,
      winRate,
      payoffRatio,
      averageWin,
      averageLoss,
      tradeCount: trades.length,
      roundTrips,
      spanDays,
      exposureFraction,
      exitCounts,
    },
    hasUnfilledFinalSignal,
    finalVerdict,
  };
}

// ---------------------------------------------------------------------------
// Client helper: convert BacktestTrade[] → the shape needed by the
// `/api/paper/portfolios` create-with-trades payload so the "save as
// paper portfolio" button is a one-liner.
// ---------------------------------------------------------------------------

/**
 * Turn simulated trades into the payload shape POST
 * `/api/paper/portfolios` expects. Adds a stable "Backtest" note so
 * the resulting paper portfolio's trade log makes the origin obvious,
 * and stamps `createdAt` from `fillBarTime` (Unix seconds → ISO) so
 * the timeline in the paper page reflects when the trade would have
 * happened, not when the user pressed the button.
 */
export function backtestTradesToImportPayload(
  trades: BacktestTrade[],
  strategyLabel: string,
): Array<{
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  note: string;
  createdAt: string;
}> {
  return trades.map((t) => ({
    // Caller supplies the symbol at import time — engine is
    // symbol-agnostic. Empty here as a placeholder; the API endpoint
    // that consumes this fills it in per trade.
    symbol: "",
    side: t.side,
    shares: t.shares,
    price: t.price,
    note: `${strategyLabel} · ${t.reason}`,
    createdAt: new Date(t.fillBarTime * 1000).toISOString(),
  }));
}
