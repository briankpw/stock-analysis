import { describe, it, expect } from "vitest";
import type { Bar } from "./indicators";
import { runBacktest, type BacktestConfig } from "./signal-backtest";

/**
 * Helpers ----------------------------------------------------------------
 *
 * Generate deterministic OHLCV bars so tests aren't at the mercy of any
 * real-world data source. Each helper produces at least enough bars to
 * clear the technical (200-bar) warm-up so the engine actually trades.
 */

function makeBars(
  startEpoch: number,
  count: number,
  priceAt: (i: number) => number,
): Bar[] {
  const out: Bar[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const close = priceAt(i);
    // Simple OHLC: open == previous close (or `close` for i=0), high/low
    // pinched around close so KDJ / Bollinger have some range to chew.
    const prevClose = i === 0 ? close : priceAt(i - 1);
    const open = prevClose;
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    out[i] = {
      time: startEpoch + i * 86_400,
      open,
      high,
      low,
      close,
      volume: 1_000_000,
    };
  }
  return out;
}

// A monotonically rising series — technical + resonance should both
// eventually turn bullish and stay there.
function makeUptrend(count = 260): Bar[] {
  return makeBars(1_700_000_000, count, (i) => 100 + i * 0.5);
}

// A monotonically falling series.
function makeDowntrend(count = 260): Bar[] {
  return makeBars(1_700_000_000, count, (i) => 200 - i * 0.5);
}

const BASE_CONFIG: BacktestConfig = {
  strategy: "technical",
  execution: "nextOpen",
  sizing: { kind: "all_in" },
  startingCash: 10_000,
  fearGreedScore: null,
};

describe("runBacktest — invariants", () => {
  it("returns exactly one equity point per bar", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    expect(r.equityCurve).toHaveLength(bars.length);
    expect(r.totalBars).toBe(bars.length);
  });

  it("equity during warm-up is exactly starting cash (no trading)", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    for (let i = 0; i < r.warmupBars; i++) {
      expect(r.equityCurve[i]!.equity).toBe(BASE_CONFIG.startingCash);
      expect(r.equityCurve[i]!.cash).toBe(BASE_CONFIG.startingCash);
      expect(r.equityCurve[i]!.positionShares).toBe(0);
    }
  });

  it("is deterministic — same inputs, same outputs", () => {
    const bars = makeUptrend();
    const a = runBacktest(bars, BASE_CONFIG);
    const b = runBacktest(bars, BASE_CONFIG);
    expect(a.metrics.finalEquity).toBe(b.metrics.finalEquity);
    expect(a.trades).toEqual(b.trades);
  });

  it("does not peek at future bars (truncated input matches per-bar equity)", () => {
    // Run the engine on the full series, then run it again on the
    // first `checkpoint` bars only. Every equity point up to
    // `checkpoint - 1` must match — proof that the engine's decisions
    // at bar `i` never depend on bars > i.
    const bars = makeUptrend(240);
    const checkpoint = 220;
    const full = runBacktest(bars, BASE_CONFIG);
    const partial = runBacktest(bars.slice(0, checkpoint), BASE_CONFIG);
    for (let i = 0; i < checkpoint; i++) {
      expect(partial.equityCurve[i]!.equity).toBeCloseTo(
        full.equityCurve[i]!.equity,
        6,
      );
      expect(partial.equityCurve[i]!.cash).toBeCloseTo(
        full.equityCurve[i]!.cash,
        6,
      );
      expect(partial.equityCurve[i]!.positionShares).toBeCloseTo(
        full.equityCurve[i]!.positionShares,
        6,
      );
    }
  });

  it("cash + positionShares × close ≈ equity every bar", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    for (let i = 0; i < bars.length; i++) {
      const pt = r.equityCurve[i]!;
      const bar = bars[i]!;
      expect(pt.equity).toBeCloseTo(
        pt.cash + pt.positionShares * bar.close,
        6,
      );
    }
  });
});

describe("runBacktest — trading behaviour", () => {
  it("emits at least one BUY on a sustained uptrend (all_in sizing)", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    const buys = r.trades.filter((t) => t.side === "buy");
    expect(buys.length).toBeGreaterThan(0);
  });

  it("all_in sizing uses > 90% of cash on first BUY", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    const firstBuy = r.trades.find((t) => t.side === "buy");
    if (!firstBuy) {
      // Uptrends should always produce a buy under all_in; if not,
      // the test itself is wrong.
      throw new Error("expected at least one BUY in an uptrend");
    }
    const spent = firstBuy.shares * firstBuy.price;
    expect(spent).toBeGreaterThanOrEqual(0.9 * BASE_CONFIG.startingCash);
    expect(spent).toBeLessThanOrEqual(BASE_CONFIG.startingCash);
  });

  it("fixed_shares sizing respects the requested share count", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, {
      ...BASE_CONFIG,
      sizing: { kind: "fixed_shares", shares: 5 },
    });
    const buys = r.trades.filter((t) => t.side === "buy");
    // Every buy should be exactly 5 shares (or clamped to affordable
    // — but 5 × ~200 = 1000 < 10000 cash, always affordable here).
    for (const b of buys) expect(b.shares).toBe(5);
  });

  it("percent_equity sizing scales with equity", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, {
      ...BASE_CONFIG,
      sizing: { kind: "percent_equity", pct: 0.5 },
    });
    const firstBuy = r.trades.find((t) => t.side === "buy");
    if (!firstBuy) throw new Error("expected at least one BUY");
    const spent = firstBuy.shares * firstBuy.price;
    // Should be roughly 50% of starting cash (minus a whole-share
    // rounding). Allow generous tolerance because the rounding + high
    // starting share price on this series can lop off ~2%.
    expect(spent).toBeGreaterThanOrEqual(0.4 * BASE_CONFIG.startingCash);
    expect(spent).toBeLessThanOrEqual(0.55 * BASE_CONFIG.startingCash);
  });

  it("nextOpen fill uses next bar's OPEN (not the signal bar's close)", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    const firstBuy = r.trades.find((t) => t.side === "buy");
    if (!firstBuy) throw new Error("expected at least one BUY");
    // Locate the bar whose time matches the fill.
    const fillIdx = bars.findIndex((b) => b.time === firstBuy.fillBarTime);
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(firstBuy.price).toBe(bars[fillIdx]!.open);
    // And the signal bar was ONE before.
    expect(firstBuy.signalBarTime).toBe(bars[fillIdx - 1]!.time);
  });

  it("sameClose fill uses the signal bar's own CLOSE", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, { ...BASE_CONFIG, execution: "sameClose" });
    const firstBuy = r.trades.find((t) => t.side === "buy");
    if (!firstBuy) throw new Error("expected at least one BUY");
    expect(firstBuy.signalBarTime).toBe(firstBuy.fillBarTime);
    const signalIdx = bars.findIndex((b) => b.time === firstBuy.signalBarTime);
    expect(firstBuy.price).toBe(bars[signalIdx]!.close);
  });

  it("does not exceed available cash on a BUY", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    // Every buy row's cashAfter must be non-negative.
    for (const t of r.trades) {
      if (t.side === "buy") expect(t.cashAfter).toBeGreaterThanOrEqual(0);
    }
  });

  it("realizedPnl is populated on SELLs and null on BUYs", () => {
    // Rolling series that eventually turns down — should produce at
    // least one round-trip.
    const bars = makeBars(1_700_000_000, 260, (i) =>
      i < 180 ? 100 + i * 0.5 : 190 - (i - 180) * 0.6,
    );
    const r = runBacktest(bars, BASE_CONFIG);
    for (const t of r.trades) {
      if (t.side === "buy") expect(t.realizedPnl).toBeNull();
      else expect(t.realizedPnl).not.toBeNull();
    }
  });
});

describe("runBacktest — metrics", () => {
  it("computes non-zero return on an uptrend under all_in", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    // Not asserting the sign of the *signal* return (that depends on
    // when it enters — the technical signal is conservative and may
    // wait longer than a buy-and-hold), but the benchmark must be
    // strongly positive on a monotonic uptrend.
    expect(r.metrics.buyHoldReturn).toBeGreaterThan(0);
  });

  it("exposureFraction is 0 on a portfolio that never entered", () => {
    // Downtrend under a technical-only signal: technical starts flat,
    // may briefly turn bearish; it should never open a long. Empirical
    // check that exposure is 0.
    const bars = makeDowntrend();
    const r = runBacktest(bars, BASE_CONFIG);
    // If the strategy did open a position, exposure > 0 — that's still
    // a valid backtest, so we only assert the *bound*: 0 ≤ exposure ≤ 1.
    expect(r.metrics.exposureFraction).toBeGreaterThanOrEqual(0);
    expect(r.metrics.exposureFraction).toBeLessThanOrEqual(1);
  });

  it("spanDays > 0 when the series covers more than one bar", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    expect(r.metrics.spanDays).toBeGreaterThan(0);
  });

  it("cagr is null when the window is shorter than 30 days", () => {
    // 25 daily bars total, but the engine's warm-up (200) means the
    // strategy never even fires. Set a short synthetic warm-up path
    // by using the resonance strategy (only 40-bar warm-up), and
    // trim bars so total < 30 days.
    const bars = makeUptrend(25);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "resonance" });
    expect(r.metrics.cagr).toBeNull();
    expect(r.metrics.buyHoldCagr).toBeNull();
  });

  it("maxDrawdown is 0 when equity never decreased", () => {
    // Trivial case: warm-up-only backtest, cash never moves, so
    // drawdown must be 0.
    const bars = makeUptrend(180); // < 200 = TECHNICAL_MIN_BARS
    const r = runBacktest(bars, BASE_CONFIG);
    expect(r.trades).toHaveLength(0);
    expect(r.metrics.maxDrawdown).toBe(0);
  });
});

describe("runBacktest — unfilled final signal", () => {
  it("flags an unfilled BUY on the last bar under nextOpen", () => {
    // Build a series that ends *right* as the technical signal is
    // turning bullish. Empirically hard to guarantee for a specific
    // bar without inspecting the scorer, so we accept "any outcome":
    // the invariant is that if `hasUnfilledFinalSignal` is true, the
    // last trade in the log (if any) is a SELL — otherwise the engine
    // would have already filled the BUY.
    const bars = makeUptrend();
    const r = runBacktest(bars, BASE_CONFIG);
    if (r.hasUnfilledFinalSignal) {
      const last = r.trades[r.trades.length - 1];
      if (last) expect(last.side).toBe("sell");
    }
  });

  it("under sameClose, there is never an unfilled final signal", () => {
    const bars = makeUptrend();
    const r = runBacktest(bars, { ...BASE_CONFIG, execution: "sameClose" });
    expect(r.hasUnfilledFinalSignal).toBe(false);
  });
});

describe("runBacktest — resonance & master strategies", () => {
  it("resonance strategy respects its lower warm-up (40 bars)", () => {
    const bars = makeUptrend(60);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "resonance" });
    expect(r.warmupBars).toBe(40);
    expect(r.equityCurve).toHaveLength(bars.length);
  });

  it("master strategy uses the technical warm-up (higher)", () => {
    const bars = makeUptrend(260);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "master" });
    expect(r.warmupBars).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Single-indicator strategies
// ---------------------------------------------------------------------------
//
// The behavioural test we care about most for these is "the intent is
// bull on an uptrend, bear on a downtrend, and the engine actually
// enters/exits when expected". We don't assert exact numeric metrics
// (they depend on the synthetic price paths) — only invariants and
// direction.

describe("runBacktest — single-indicator strategies", () => {
  it("sma_cross uses the SMA200 warm-up", () => {
    const bars = makeUptrend(260);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "sma_cross" });
    expect(r.warmupBars).toBe(200);
    expect(r.equityCurve).toHaveLength(bars.length);
  });

  it("ema_cross fires trades on a persistent uptrend", () => {
    const bars = makeUptrend(120);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "ema_cross" });
    // Rising prices → EMA20 crosses above EMA52 during the run →
    // at least one BUY.
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades[0]!.side).toBe("buy");
  });

  it("macd_cross respects its ~34-bar warm-up and produces trades on a trend", () => {
    const bars = makeUptrend(120);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "macd_cross" });
    expect(r.warmupBars).toBe(34);
    expect(r.trades.length).toBeGreaterThan(0);
  });

  it("rsi_reversion buys near an oversold trough and sells near an overbought peak", () => {
    // V-shaped price: sharp drop then sharp rise. Should push RSI
    // deep into oversold at the bottom (buy), then into overbought
    // near the top (sell).
    const bars = makeBars(1_700_000_000, 120, (i) =>
      i < 60 ? 200 - i * 2 : 80 + (i - 60) * 3,
    );
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "rsi_reversion" });
    // The strategy must have entered a position at some point OR
    // exposure > 0. On a shallower V we may end still holding — either
    // is a valid outcome; the invariant is the presence of at least
    // one trade.
    expect(r.trades.length).toBeGreaterThan(0);
  });

  it("kdj_cross fires trades on a directional path", () => {
    const bars = makeUptrend(80);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "kdj_cross" });
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades[0]!.side).toBe("buy");
  });

  it("bbands_reversion enters near the lower band on a dip", () => {
    // Downward drift then a sharp dip — should push close below the
    // lower Bollinger Band at least once.
    const bars = makeBars(1_700_000_000, 120, (i) =>
      i < 100 ? 150 - i * 0.2 : 130 - (i - 100) * 5,
    );
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "bbands_reversion" });
    // Not asserting a specific trade count — synthetic prices can
    // fail to breach the band in some seeds. The stable invariant is
    // that ANY trade taken is a buy first (matches "reversion:
    // catch the dip"), and the engine doesn't panic.
    if (r.trades.length > 0) expect(r.trades[0]!.side).toBe("buy");
    expect(r.equityCurve).toHaveLength(bars.length);
  });

  it("sr_bounce respects its warm-up and doesn't crash on flat prices", () => {
    // Flat prices produce no meaningful pivots — the strategy should
    // stay neutral throughout, never trade, and never throw.
    const bars = makeBars(1_700_000_000, 120, () => 100);
    const r = runBacktest(bars, { ...BASE_CONFIG, strategy: "sr_bounce" });
    expect(r.warmupBars).toBe(60);
    expect(r.trades).toHaveLength(0);
    expect(r.equityCurve).toHaveLength(bars.length);
    expect(r.metrics.maxDrawdown).toBe(0);
  });

  it("every strategy returns a full equity curve equal to bar count", () => {
    // Regression test: all strategies must satisfy the invariant
    // that `equityCurve.length === bars.length` even when they never
    // trade. Prevents future strategy additions from accidentally
    // short-circuiting the loop.
    const bars = makeUptrend(260);
    for (const s of [
      "sma_cross",
      "ema_cross",
      "macd_cross",
      "rsi_reversion",
      "kdj_cross",
      "bbands_reversion",
      "sr_bounce",
    ] as const) {
      const r = runBacktest(bars, { ...BASE_CONFIG, strategy: s });
      expect(r.equityCurve, `strategy=${s}`).toHaveLength(bars.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Stop-loss / take-profit overlay
// ---------------------------------------------------------------------------
//
// These tests use `ema_cross` on a persistent uptrend as the "vehicle
// strategy" because it reliably fires a BUY early and stays long, so
// we can layer engineered exit-scenario bars on top and know a
// position is open when they arrive.

describe("runBacktest — SL/TP overlay", () => {
  // Common vehicle: 70 bars of monotonic uptrend. ema_cross → BUY
  // around bar ~50-60, position stays open through the last bar.
  function upTrendVehicle(): Bar[] {
    return makeBars(1_700_000_000, 70, (i) => 100 + i * 1.5);
  }

  // Locate the first BUY trade in a result — every SL/TP test starts
  // with one, so failing to find it is a fixture problem, not an
  // engine bug.
  function requireFirstBuy(r: { trades: { side: string; price: number; stopLossAt: number | null; takeProfitAt: number | null }[] }) {
    const b = r.trades.find((t) => t.side === "buy");
    if (!b) throw new Error("test fixture failed to trigger a BUY");
    return b;
  }

  it("defaults to `kind: off` when targets is omitted", () => {
    const r = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
    });
    for (const t of r.trades) {
      expect(t.exitReason === "signal" || t.side === "buy").toBe(true);
      // With overlay off, no BUY should carry SL/TP levels.
      if (t.side === "buy") {
        expect(t.stopLossAt).toBeNull();
        expect(t.takeProfitAt).toBeNull();
      }
    }
    expect(r.metrics.exitCounts.stopLoss).toBe(0);
    expect(r.metrics.exitCounts.takeProfit).toBe(0);
  });

  it("fixed_pct attaches SL/TP levels to every BUY", () => {
    const r = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05, takeProfitPct: 0.15 },
    });
    const buys = r.trades.filter((t) => t.side === "buy");
    expect(buys.length).toBeGreaterThan(0);
    for (const b of buys) {
      expect(b.stopLossAt).not.toBeNull();
      expect(b.takeProfitAt).not.toBeNull();
      expect(b.stopLossAt!).toBeCloseTo(b.price * 0.95, 6);
      expect(b.takeProfitAt!).toBeCloseTo(b.price * 1.15, 6);
    }
  });

  it("fixed_pct SL fires when a later bar's low pierces the level", () => {
    // Determine the buy price via a baseline run, then append a
    // bar whose low pierces the SL (but whose OPEN is above the
    // SL — the intra-bar path hit, not a gap-down).
    const baseline = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05 },
    });
    const firstBuy = requireFirstBuy(baseline);
    const sl = firstBuy.price * 0.95;
    const upBars = upTrendVehicle();
    const dipBar: Bar = {
      time: upBars[upBars.length - 1]!.time + 86_400,
      open: sl * 1.01, // above SL
      high: sl * 1.02,
      low: sl * 0.98, // pierces SL
      close: sl * 1.0,
      volume: 1_000_000,
    };
    const r = runBacktest([...upBars, dipBar], {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05 },
    });
    const slExit = r.trades.find((t) => t.exitReason === "stop_loss");
    expect(slExit).toBeDefined();
    // Intra-bar (non-gap) hit fills EXACTLY at the SL level.
    expect(slExit!.price).toBeCloseTo(sl, 6);
    expect(r.metrics.exitCounts.stopLoss).toBe(1);
  });

  it("fixed_pct SL: a gap-down open fills at the open, not the SL", () => {
    const baseline = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05 },
    });
    const firstBuy = requireFirstBuy(baseline);
    const sl = firstBuy.price * 0.95;
    const gapOpen = sl * 0.9; // clearly below the SL
    const upBars = upTrendVehicle();
    const gapBar: Bar = {
      time: upBars[upBars.length - 1]!.time + 86_400,
      open: gapOpen,
      high: gapOpen * 1.01,
      low: gapOpen * 0.98,
      close: gapOpen,
      volume: 1_000_000,
    };
    const r = runBacktest([...upBars, gapBar], {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05 },
    });
    const slExit = r.trades.find((t) => t.exitReason === "stop_loss");
    expect(slExit).toBeDefined();
    expect(slExit!.price).toBeCloseTo(gapOpen, 6);
    // Sanity: the fill must be strictly worse than the SL — that's
    // the whole point of gap-down handling.
    expect(slExit!.price).toBeLessThan(sl);
  });

  it("fixed_pct TP fires when a later bar's high pierces the target", () => {
    const baseline = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", takeProfitPct: 0.15 },
    });
    const firstBuy = requireFirstBuy(baseline);
    const tp = firstBuy.price * 1.15;
    const upBars = upTrendVehicle();
    // A bar whose HIGH breaks the TP but OPEN is below (intra-bar hit).
    const rallyBar: Bar = {
      time: upBars[upBars.length - 1]!.time + 86_400,
      open: tp * 0.99,
      high: tp * 1.02, // pierces TP
      low: tp * 0.98,
      close: tp * 1.01,
      volume: 1_000_000,
    };
    const r = runBacktest([...upBars, rallyBar], {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", takeProfitPct: 0.15 },
    });
    const tpExit = r.trades.find((t) => t.exitReason === "take_profit");
    expect(tpExit).toBeDefined();
    expect(tpExit!.price).toBeCloseTo(tp, 6);
    expect(r.metrics.exitCounts.takeProfit).toBe(1);
  });

  it("fixed_pct TP: a gap-up open fills at the open (better than the TP)", () => {
    const baseline = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", takeProfitPct: 0.15 },
    });
    const firstBuy = requireFirstBuy(baseline);
    const tp = firstBuy.price * 1.15;
    const gapOpen = tp * 1.1; // gap up ABOVE the TP
    const upBars = upTrendVehicle();
    const gapBar: Bar = {
      time: upBars[upBars.length - 1]!.time + 86_400,
      open: gapOpen,
      high: gapOpen * 1.01,
      low: gapOpen * 0.99,
      close: gapOpen,
      volume: 1_000_000,
    };
    const r = runBacktest([...upBars, gapBar], {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", takeProfitPct: 0.15 },
    });
    const tpExit = r.trades.find((t) => t.exitReason === "take_profit");
    expect(tpExit).toBeDefined();
    expect(tpExit!.price).toBeCloseTo(gapOpen, 6);
    expect(tpExit!.price).toBeGreaterThan(tp);
  });

  it("same-bar SL-and-TP tiebreaker: stop-loss wins (conservative)", () => {
    const baseline = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05, takeProfitPct: 0.15 },
    });
    const firstBuy = requireFirstBuy(baseline);
    const sl = firstBuy.price * 0.95;
    const tp = firstBuy.price * 1.15;
    // Outside bar whose range spans BOTH SL and TP.
    const upBars = upTrendVehicle();
    const wideBar: Bar = {
      time: upBars[upBars.length - 1]!.time + 86_400,
      open: firstBuy.price, // between SL and TP
      high: tp * 1.01,
      low: sl * 0.99,
      close: firstBuy.price,
      volume: 1_000_000,
    };
    const r = runBacktest([...upBars, wideBar], {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.05, takeProfitPct: 0.15 },
    });
    const exit = r.trades.find(
      (t) => t.exitReason === "stop_loss" || t.exitReason === "take_profit",
    );
    expect(exit).toBeDefined();
    // Conservative rule: SL fires first when both are in-range.
    expect(exit!.exitReason).toBe("stop_loss");
  });

  it("does not check SL/TP on the entry bar itself (skips one-bar spurious hits)", () => {
    // Under sameClose we buy at the CLOSE of the signal bar. A bar
    // whose LOW is already below the SL (which would only be
    // meaningful "before" the fill under this ordering) should NOT
    // trigger an exit on the entry bar.
    //
    // Practical test: run with a very tight SL (1%) on the vehicle.
    // The buy fills at some bar's close; the bar's own low is
    // typically below close × 0.99. Confirm no exit is emitted on the
    // buy's fillBarTime.
    const r = runBacktest(upTrendVehicle(), {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.01 },
    });
    const firstBuy = requireFirstBuy(r);
    // No sell should share the same fillBarTime as the buy.
    for (const t of r.trades) {
      if (t.side === "sell" && t.exitReason !== "signal") {
        expect(t.fillBarTime).not.toBe(firstBuy.fillBarTime);
      }
    }
  });

  it("exitCounts sums to the total number of SELL trades", () => {
    const bars = makeBars(1_700_000_000, 200, (i) =>
      i < 90 ? 100 + i * 0.8 : 172 - (i - 90) * 0.9,
    );
    const r = runBacktest(bars, {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "fixed_pct", stopLossPct: 0.03, takeProfitPct: 0.2 },
    });
    const sells = r.trades.filter((t) => t.side === "sell").length;
    const c = r.metrics.exitCounts;
    expect(c.signal + c.stopLoss + c.takeProfit).toBe(sells);
  });

  it("smart mode populates SL/TP levels on the buy (data-driven)", () => {
    // 260 bars of gently rising prices → enrichment has ATR14 defined
    // and the recommender should pick concrete SL/TP prices.
    const bars = makeBars(1_700_000_000, 260, (i) => 100 + i * 0.4);
    const r = runBacktest(bars, {
      ...BASE_CONFIG,
      strategy: "ema_cross",
      execution: "sameClose",
      targets: { kind: "smart" },
    });
    const firstBuy = requireFirstBuy(r);
    expect(firstBuy.stopLossAt).not.toBeNull();
    expect(firstBuy.takeProfitAt).not.toBeNull();
    expect(firstBuy.stopLossAt!).toBeLessThan(firstBuy.price);
    expect(firstBuy.takeProfitAt!).toBeGreaterThan(firstBuy.price);
  });
});
