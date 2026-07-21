import { describe, it, expect } from "vitest";

import { computePaperAnalytics, type EnrichedTrade } from "./paper-analytics";
import type { Trade } from "./paper-trading";

/**
 * `paper-analytics.ts` is the source of truth for every user-visible
 * per-symbol P&L number in the paper-trading UI (recent trades,
 * per-symbol earnings, portfolio-wide win rate, payoff ratio). It is
 * pure and deterministic — no I/O, no clock — so it's the highest-
 * leverage module in the repo to have a real test suite around.
 *
 * These tests cover the invariants that would silently corrupt the
 * user's understanding of their performance if they regressed:
 *
 *   * Weighted-average cost basis matches placeOrder() (so a sell's
 *     realised P&L lines up with the ledger's avg_cost).
 *   * Round-trip counting is idempotent — no double-counts on
 *     partial fills, no phantom counts on zero-share sells.
 *   * Trade ordering preservation — the input order (usually
 *     newest-first for display) must survive the ascending replay
 *     round-trip.
 *   * Portfolio-wide metrics (winRate, averageWin, averageLoss,
 *     payoffRatio) reflect *per-trade* statistics, not the
 *     "average of averages" bias a naive per-symbol reduction
 *     would introduce.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Sequential id generator so each `trade({...})` call gets a unique id
 * without the caller having to track it. Reset between describe blocks
 * for readable diffs when a test fails.
 */
let nextId = 1;
const resetIds = () => {
  nextId = 1;
};

/**
 * Build a `Trade` with sensible defaults. Deliberately verbose in the
 * signature so future fields on Trade will fail to compile here and
 * force the test author to think about them.
 */
function trade(partial: Partial<Trade> & Pick<Trade, "symbol" | "side" | "shares" | "price">): Trade {
  return {
    id: partial.id ?? nextId++,
    // Analytics is portfolio-agnostic — every test uses the same
    // arbitrary portfolio id so the field is required (post-v15
    // schema) without contaminating any of the analytics math.
    portfolioId: partial.portfolioId ?? 1,
    symbol: partial.symbol,
    side: partial.side,
    shares: partial.shares,
    price: partial.price,
    // Default commission mirrors `settings.paper.commission` at time of
    // writing — kept as an explicit number so a config change doesn't
    // silently invalidate every test's realised-P&L number.
    commission: partial.commission ?? 0,
    cashAfter: partial.cashAfter ?? 100_000,
    note: partial.note ?? null,
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Rounding helper — floating-point comparisons in a replay-heavy test
 * suite either use `.toBeCloseTo` everywhere (noisy) or a shared
 * tolerance helper (this). 8 decimals is well below any realistic
 * price granularity but tight enough to catch off-by-one weighting.
 */
const nearly = (x: number) => Math.round(x * 1e8) / 1e8;

// ---------------------------------------------------------------------------
// Empty & degenerate inputs
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — empty & degenerate inputs", () => {
  it("returns an all-zero result for an empty trade list", () => {
    const res = computePaperAnalytics([]);
    expect(res.perSymbol).toEqual([]);
    expect(res.enrichedTrades).toEqual([]);
    expect(res.portfolio.totalRealizedPnl).toBe(0);
    expect(res.portfolio.tradeCount).toBe(0);
    expect(res.portfolio.sellCount).toBe(0);
    expect(res.portfolio.winRate).toBeNull();
    expect(res.portfolio.averageWin).toBeNull();
    expect(res.portfolio.averageLoss).toBeNull();
    expect(res.portfolio.payoffRatio).toBeNull();
    expect(res.portfolio.bestSymbol).toBeNull();
    expect(res.portfolio.worstSymbol).toBeNull();
    expect(res.portfolio.symbolCount).toBe(0);
    expect(res.portfolio.openSymbolCount).toBe(0);
  });

  it("returns null P&L for a single buy (nothing realised yet)", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 150 }),
    ]);
    expect(res.enrichedTrades).toHaveLength(1);
    expect(res.enrichedTrades[0].realizedPnl).toBeNull();
    expect(res.enrichedTrades[0].realizedPnlPct).toBeNull();
    expect(res.enrichedTrades[0].costBasisSold).toBeNull();
    expect(res.perSymbol[0]).toMatchObject({
      symbol: "AAPL",
      realizedPnl: 0,
      openShares: 10,
      openAvgCost: 150,
      totalBought: 1500,
      totalSold: 0,
      winCount: 0,
      lossCount: 0,
      roundTrips: 0,
    });
    expect(res.portfolio.winRate).toBeNull();
    expect(res.portfolio.openSymbolCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Simple round trips
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — simple round trips", () => {
  it("computes gain on a straightforward buy-then-sell win", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 120, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const sell = res.enrichedTrades.find((t) => t.side === "sell")!;
    expect(sell.realizedPnl).toBe(200); // 10 * (120 - 100)
    expect(sell.realizedPnlPct).toBeCloseTo(200 / 1000);
    expect(sell.costBasisSold).toBe(1000);
    const perf = res.perSymbol[0];
    expect(perf.realizedPnl).toBe(200);
    expect(perf.winCount).toBe(1);
    expect(perf.lossCount).toBe(0);
    expect(perf.breakEvenCount).toBe(0);
    expect(perf.roundTrips).toBe(1);
    expect(perf.openShares).toBe(0);
    expect(perf.openAvgCost).toBeNull();
    expect(perf.bestTrade).toBe(200);
    expect(perf.worstTrade).toBe(200);
  });

  it("computes loss on a buy-then-sell loss", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100 }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 80, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const perf = res.perSymbol[0];
    expect(perf.realizedPnl).toBe(-200);
    expect(perf.winCount).toBe(0);
    expect(perf.lossCount).toBe(1);
    expect(perf.worstTrade).toBe(-200);
  });

  it("classifies a break-even exit as neither win nor loss", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100 }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 100, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const perf = res.perSymbol[0];
    expect(perf.realizedPnl).toBe(0);
    expect(perf.winCount).toBe(0);
    expect(perf.lossCount).toBe(0);
    expect(perf.breakEvenCount).toBe(1);
    expect(res.portfolio.winRate).toBe(0); // 0 wins / 1 sell
  });

  it("subtracts sell commission from realised P&L", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, commission: 1 }),
      trade({
        symbol: "AAPL",
        side: "sell",
        shares: 10,
        price: 120,
        commission: 2,
        createdAt: "2026-01-02T00:00:00Z",
      }),
    ]);
    const sell = res.enrichedTrades.find((t) => t.side === "sell")!;
    // 10 * (120 - 100) - 2 = 198 (buy commission is NOT re-deducted;
    // it was already priced into the cost basis at buy time via
    // placeOrder's cash effect, but the analytics track it separately
    // in totalCommissions).
    expect(sell.realizedPnl).toBe(198);
    const perf = res.perSymbol[0];
    expect(perf.totalCommissions).toBe(3); // 1 + 2
  });
});

// ---------------------------------------------------------------------------
// Weighted-average cost basis
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — weighted-average cost basis", () => {
  it("averages cost across two buys at different prices", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 200, createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 20, price: 200, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    // avg = (10*100 + 10*200) / 20 = 150 → sell at 200 → 20 * 50 = 1000 gain
    const perf = res.perSymbol[0];
    expect(perf.realizedPnl).toBe(1000);
    expect(perf.totalBought).toBe(3000);
    expect(perf.totalSold).toBe(4000);
    expect(perf.openShares).toBe(0);
    expect(perf.roundTrips).toBe(1);
  });

  it("preserves the running cost basis across a partial sell", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100 }),
      trade({ symbol: "AAPL", side: "sell", shares: 6, price: 150, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const perf = res.perSymbol[0];
    // Sold 6 @ 150 against cost basis 100 → 6 * 50 = 300 realised.
    expect(perf.realizedPnl).toBe(300);
    expect(perf.openShares).toBe(4);
    // Avg cost should NOT change on a sell — it stays at the buy price.
    expect(perf.openAvgCost).toBe(100);
    expect(perf.roundTrips).toBe(0); // still open, no round trip yet
  });
});

// ---------------------------------------------------------------------------
// Multiple round trips
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — multiple round trips", () => {
  it("resets cost basis between independent cycles and counts each round trip", () => {
    resetIds();
    const res = computePaperAnalytics([
      // Cycle 1: buy 10 @ 100, sell 10 @ 120 (+200 gain)
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 120, createdAt: "2026-01-02T00:00:00Z" }),
      // Cycle 2: buy 5 @ 200, sell 5 @ 180 (-100 loss). The new cost
      // basis MUST be 200 — the previous cycle's 100 avg should not
      // leak in and turn a real loss into a phantom win.
      trade({ symbol: "AAPL", side: "buy", shares: 5, price: 200, createdAt: "2026-01-03T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 5, price: 180, createdAt: "2026-01-04T00:00:00Z" }),
    ]);
    const perf = res.perSymbol[0];
    expect(perf.realizedPnl).toBe(100); // 200 win + (-100 loss)
    expect(perf.winCount).toBe(1);
    expect(perf.lossCount).toBe(1);
    expect(perf.roundTrips).toBe(2);
    expect(perf.bestTrade).toBe(200);
    expect(perf.worstTrade).toBe(-100);
  });

  it("does NOT increment roundTrips when a sell can't consume any shares", () => {
    // This is the "phantom sell" defensive case — should only be
    // reachable via manual DB tampering, but the guard was worth
    // adding after an audit and the test locks it in.
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 100 }),
    ]);
    const perf = res.perSymbol[0];
    expect(perf.roundTrips).toBe(0);
    expect(perf.realizedPnl).toBe(0);
    // Sell trade against no position → realizedPnl left null (nothing
    // to close), matches the documented "defensive" branch.
    expect(res.enrichedTrades[0].realizedPnl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trade ordering + enrichment invariants
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — ordering & enrichment", () => {
  it("preserves the caller's trade order in enrichedTrades even when input is newest-first", () => {
    resetIds();
    // Simulate the DB `recentTrades(...)` shape: newest-first.
    const input: Trade[] = [
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 120, createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
    ];
    const res = computePaperAnalytics(input);
    // Same order out as in.
    expect(res.enrichedTrades.map((t) => t.id)).toEqual([input[0].id, input[1].id]);
    // Realised P&L still correct despite the reverse-order input —
    // internal replay handles the sort.
    const enrichedSell = res.enrichedTrades.find((t) => t.side === "sell")!;
    expect(enrichedSell.realizedPnl).toBe(200);
  });

  it("uses trade.id as a stable secondary sort for identical timestamps", () => {
    resetIds();
    const ts = "2026-01-01T00:00:00Z";
    // Same timestamp — id order is our only signal. Buy id must
    // replay first, otherwise the sell has no cost basis and
    // realizedPnl comes back null.
    const buy: Trade = trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: ts, id: 1 });
    const sell: Trade = trade({ symbol: "AAPL", side: "sell", shares: 10, price: 110, createdAt: ts, id: 2 });
    // Pass the sell first to force the sort branch to matter.
    const res = computePaperAnalytics([sell, buy]);
    const enrichedSell = res.enrichedTrades.find((t) => t.id === 2)!;
    expect(enrichedSell.realizedPnl).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Multiple symbols + portfolio-wide metrics
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — multiple symbols & portfolio metrics", () => {
  it("aggregates per-symbol into portfolio totals and picks best/worst", () => {
    resetIds();
    const res = computePaperAnalytics([
      // AAPL: +300
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 130, createdAt: "2026-01-02T00:00:00Z" }),
      // MSFT: -50
      trade({ symbol: "MSFT", side: "buy", shares: 10, price: 200, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "MSFT", side: "sell", shares: 10, price: 195, createdAt: "2026-01-02T00:00:00Z" }),
      // NVDA: +1000
      trade({ symbol: "NVDA", side: "buy", shares: 5, price: 500, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "NVDA", side: "sell", shares: 5, price: 700, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(res.perSymbol).toHaveLength(3);
    expect(res.portfolio.totalRealizedPnl).toBe(300 - 50 + 1000); // 1250
    expect(res.portfolio.tradeCount).toBe(6);
    expect(res.portfolio.sellCount).toBe(3);
    expect(res.portfolio.winRate).toBeCloseTo(2 / 3);
    expect(res.portfolio.bestSymbol?.symbol).toBe("NVDA");
    expect(res.portfolio.worstSymbol?.symbol).toBe("MSFT");
    expect(res.portfolio.symbolCount).toBe(3);
    expect(res.portfolio.openSymbolCount).toBe(0);
  });

  it("computes payoffRatio as |avgWin / avgLoss| across all sells", () => {
    resetIds();
    const res = computePaperAnalytics([
      // Two winners: +100, +300 → avgWin = 200
      trade({ symbol: "A", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "A", side: "sell", shares: 10, price: 110, createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "B", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "B", side: "sell", shares: 10, price: 130, createdAt: "2026-01-02T00:00:00Z" }),
      // One loser: -50 → avgLoss = -50
      trade({ symbol: "C", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "C", side: "sell", shares: 10, price: 95, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(res.portfolio.averageWin).toBe(200);
    expect(res.portfolio.averageLoss).toBe(-50);
    expect(res.portfolio.payoffRatio).toBe(4); // |200 / -50|
    expect(res.portfolio.winRate).toBeCloseTo(2 / 3);
  });

  it("leaves averageLoss null (and payoffRatio null) when nothing has lost", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 110, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(res.portfolio.averageWin).toBe(100);
    expect(res.portfolio.averageLoss).toBeNull();
    expect(res.portfolio.payoffRatio).toBeNull();
    expect(res.portfolio.winRate).toBe(1);
  });

  it("counts open positions separately from closed round trips", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 120, createdAt: "2026-01-02T00:00:00Z" }),
      // MSFT still open
      trade({ symbol: "MSFT", side: "buy", shares: 5, price: 200, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    expect(res.portfolio.symbolCount).toBe(2);
    expect(res.portfolio.openSymbolCount).toBe(1);
    expect(res.portfolio.sellCount).toBe(1);
    const msft = res.perSymbol.find((p) => p.symbol === "MSFT")!;
    expect(msft.openShares).toBe(5);
    expect(msft.openAvgCost).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Floating-point residuals
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — floating-point handling", () => {
  it("treats sub-nano-share residuals as flat (no phantom open position)", () => {
    resetIds();
    // Contrived: sell 0.9999999999 of a share we bought as 1. The
    // resulting residual is ~1e-10 and the code path clamps to zero
    // + counts a round trip.
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 1, price: 100 }),
      trade({
        symbol: "AAPL",
        side: "sell",
        shares: 0.9999999999,
        price: 110,
        createdAt: "2026-01-02T00:00:00Z",
      }),
    ]);
    const perf = res.perSymbol[0];
    expect(perf.openShares).toBe(0);
    expect(perf.openAvgCost).toBeNull();
    expect(perf.roundTrips).toBe(1);
  });

  it("keeps weighted avg stable across many small buys", () => {
    resetIds();
    // 100 buys of 1 share at $100 → avg should stay $100 with no
    // accumulated float drift beyond ~1e-10.
    const trades: Trade[] = [];
    for (let i = 0; i < 100; i++) {
      trades.push(
        trade({
          symbol: "AAPL",
          side: "buy",
          shares: 1,
          price: 100,
          createdAt: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
        }),
      );
    }
    const res = computePaperAnalytics(trades);
    const perf = res.perSymbol[0];
    expect(perf.openShares).toBe(100);
    expect(nearly(perf.openAvgCost!)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Type surface sanity checks
// ---------------------------------------------------------------------------

describe("computePaperAnalytics — return type", () => {
  it("annotates every buy with null realizedPnl", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100 }),
    ]);
    const enriched: EnrichedTrade = res.enrichedTrades[0];
    expect(enriched.realizedPnl).toBeNull();
    expect(enriched.realizedPnlPct).toBeNull();
    expect(enriched.costBasisSold).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FIFO lot attribution
// ---------------------------------------------------------------------------
//
// The `lot*` fields on `EnrichedTrade` are a second lens on the same
// data: instead of "how much did *this sell* realize?", they answer
// "how much did *this specific buy* end up making?" by tracing which
// sells later drained shares from this buy lot (FIFO) and attributing
// per-lot P&L back to the buy row.
//
// These invariants matter more than most: if the FIFO math is off,
// the user will look at a buy and mis-read it as profitable when it
// wasn't (or vice-versa), and there's no easy way for them to spot
// the bug from the UI.

describe("computePaperAnalytics — FIFO lot attribution", () => {
  it("fresh buy has open lot status and zero attributed P&L", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100 }),
    ]);
    const buy = res.enrichedTrades[0];
    expect(buy.lotStatus).toBe("open");
    expect(buy.lotOriginalShares).toBe(10);
    expect(buy.lotSharesSold).toBe(0);
    expect(buy.lotSharesRemaining).toBe(10);
    expect(buy.lotCostPerShare).toBe(100);
    expect(buy.lotRealizedPnl).toBe(0);
  });

  it("fully-closed single buy has closed status and total sell P&L attributed to it", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 120, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const buy = res.enrichedTrades.find((t) => t.side === "buy")!;
    const sell = res.enrichedTrades.find((t) => t.side === "sell")!;
    expect(buy.lotStatus).toBe("closed");
    expect(buy.lotSharesSold).toBe(10);
    expect(buy.lotSharesRemaining).toBe(0);
    expect(buy.lotRealizedPnl).toBe(200); // 10 * (120 - 100)
    // Sell's own realized (weighted-avg) still populated and matches
    // the pure per-lot P&L in this single-lot scenario.
    expect(sell.realizedPnl).toBe(200);
    // Sells never carry a lot themselves.
    expect(sell.lotOriginalShares).toBeNull();
    expect(sell.lotStatus).toBeNull();
  });

  it("partially-sold buy has partial status and P&L only on the sold portion", () => {
    resetIds();
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy", shares: 10, price: 100, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 6, price: 130, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    const buy = res.enrichedTrades.find((t) => t.side === "buy")!;
    expect(buy.lotStatus).toBe("partial");
    expect(buy.lotSharesSold).toBe(6);
    expect(buy.lotSharesRemaining).toBe(4);
    expect(buy.lotRealizedPnl).toBe(180); // 6 * (130 - 100)
  });

  it("FIFO drains the OLDEST lot first — cheap shares go before expensive ones", () => {
    resetIds();
    // Buy 10 @ $50, then 10 @ $80 → sell 10 @ $100. FIFO says the
    // sell consumes the $50 lot entirely; the $80 lot is untouched.
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy",  shares: 10, price: 50,  createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy",  shares: 10, price: 80,  createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 100, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    const buys = res.enrichedTrades.filter((t) => t.side === "buy");
    // Sort by createdAt for stable indexing regardless of input order.
    buys.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    // First (cheap) buy: fully drained, attributed $500 (10 × $50).
    expect(buys[0].lotStatus).toBe("closed");
    expect(buys[0].lotSharesSold).toBe(10);
    expect(buys[0].lotRealizedPnl).toBe(500);
    // Second (expensive) buy: untouched, no realized attribution.
    expect(buys[1].lotStatus).toBe("open");
    expect(buys[1].lotSharesSold).toBe(0);
    expect(buys[1].lotRealizedPnl).toBe(0);
  });

  it("sell spanning multiple lots splits P&L per lot at each lot's own cost", () => {
    resetIds();
    // Buy 5 @ $50 + Buy 5 @ $80, then sell 10 @ $100 → FIFO consumes
    // 5 from the $50 lot (P&L = 5 × 50 = $250) and 5 from the $80
    // lot (P&L = 5 × 20 = $100). Each buy gets its own share.
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy",  shares: 5,  price: 50,  createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy",  shares: 5,  price: 80,  createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 100, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    const buys = res.enrichedTrades.filter((t) => t.side === "buy");
    buys.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(buys[0].lotStatus).toBe("closed");
    expect(buys[0].lotRealizedPnl).toBe(250);
    expect(buys[1].lotStatus).toBe("closed");
    expect(buys[1].lotRealizedPnl).toBe(100);
    // FIFO totals sum to the same magnitude as the weighted-avg
    // realized on the sell row (they must agree when all buys are
    // fully consumed — the reconciliation only diverges on partial
    // fills). 350 both ways in this scenario.
    expect(buys[0].lotRealizedPnl! + buys[1].lotRealizedPnl!).toBe(350);
    const sell = res.enrichedTrades.find((t) => t.side === "sell")!;
    expect(sell.realizedPnl).toBe(350); // 10 * (100 - avg $65)
  });

  it("distributes sell commission proportionally across consumed lots", () => {
    resetIds();
    // Buy 5 @ $50 + Buy 5 @ $80, then sell 10 @ $100 with $10 commission.
    // Each lot supplies half the sold shares, so each absorbs half
    // ($5) of the commission.
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy",  shares: 5,  price: 50,  createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy",  shares: 5,  price: 80,  createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 100, commission: 10, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    const buys = res.enrichedTrades.filter((t) => t.side === "buy");
    buys.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    // Lot 1: gross $250 − $5 commission share = $245.
    expect(nearly(buys[0].lotRealizedPnl!)).toBe(245);
    // Lot 2: gross $100 − $5 commission share = $95.
    expect(nearly(buys[1].lotRealizedPnl!)).toBe(95);
  });

  it("a Buy after the position went flat starts a fresh lot — no cross-cycle bleed", () => {
    resetIds();
    // Round trip 1: Buy 10 @ $50, sell 10 @ $70 (P&L $200).
    // Then round trip 2: Buy 10 @ $60, sell 10 @ $80 (P&L $200).
    // Each buy should be attributed only to sells that consumed
    // from it — no leakage from cycle 1 into cycle 2 or vice-versa.
    const res = computePaperAnalytics([
      trade({ symbol: "AAPL", side: "buy",  shares: 10, price: 50, createdAt: "2026-01-01T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 70, createdAt: "2026-01-02T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "buy",  shares: 10, price: 60, createdAt: "2026-01-03T00:00:00Z" }),
      trade({ symbol: "AAPL", side: "sell", shares: 10, price: 80, createdAt: "2026-01-04T00:00:00Z" }),
    ]);
    const buys = res.enrichedTrades.filter((t) => t.side === "buy");
    buys.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    expect(buys[0].lotRealizedPnl).toBe(200); // 10 × ($70-$50)
    expect(buys[1].lotRealizedPnl).toBe(200); // 10 × ($80-$60)
    expect(buys[0].lotStatus).toBe("closed");
    expect(buys[1].lotStatus).toBe("closed");
  });
});
