/**
 * Paper-trading analytics.
 *
 * The `paper_trades` table records every buy/sell as an immutable event,
 * but the DB never persists *realised P&L* per trade — realised gains
 * are folded straight into `paper_portfolio.cash` when the sell clears.
 * That was fine for a "what's my balance?" view, but the user needs
 * per-symbol earnings ("how much did I make on APH?") and portfolio-
 * wide performance ("what's my win rate?"), so this module reconstructs
 * realised P&L by replaying the trade log.
 *
 * Design principles:
 *
 * * **Pure.** No I/O. Input is the raw `Trade[]` from the store; output
 *   is fully-typed analytics objects. Easy to unit-test, easy to embed
 *   inside another endpoint's response.
 * * **Deterministic weighted-average cost basis.** Matches
 *   `placeOrder()` so a sell computes P&L against the *same* avg cost
 *   the position would have shown at that moment.
 * * **Chronological replay.** Trades come out of the DB newest-first for
 *   display; we resort ascending before replaying so cost-basis math
 *   flows in trade order.
 * * **Handles round-tripping.** If a symbol has been fully sold and
 *   re-bought, the cost basis resets — the second cycle's P&L is
 *   independent of the first, matching real broker semantics.
 *
 * NOT tracked yet (future work): short positions, dividends,
 * corporate actions (splits), fees beyond the flat commission the
 * order path already applies.
 */

import type { Trade } from "./paper-trading";

// ---------------------------------------------------------------------------
// Trade-level P&L (attached to each sell during replay)
// ---------------------------------------------------------------------------

export interface EnrichedTrade extends Trade {
  /** Realised P&L on this trade — populated for sells only. Positive =
   *  gain, negative = loss. `null` for buys and for sells that closed
   *  more shares than the running cost basis accounted for (defensive). */
  realizedPnl: number | null;
  /** Realised P&L as a fraction of the cost basis consumed by this sell.
   *  0.05 = "sold at a 5% gain". `null` when `realizedPnl` is null. */
  realizedPnlPct: number | null;
  /** Cost basis (avg cost × shares) that this sell consumed. Useful for
   *  the trade-log tooltip. `null` for buys. */
  costBasisSold: number | null;

  // --- FIFO lot attribution (Buy rows only; null on Sell) ---------------
  //
  // A second lens on the same data: instead of "how much did *this
  // sell* realize?", it answers "how much did *this buy* end up
  // making?" by tracing which sells later drained shares from this
  // buy lot (FIFO) and attributing per-lot P&L back to the buy.

  /** Shares originally bought in this lot (same as `shares` on Buys). */
  lotOriginalShares: number | null;
  /** Shares from this buy lot that were later consumed by FIFO sells. */
  lotSharesSold: number | null;
  /** Shares from this buy lot still open. */
  lotSharesRemaining: number | null;
  /** This lot's per-share cost (matches the buy `price` because paper
   *  trading tracks commission on sells only — kept as a field for
   *  parity with the portfolio model and for future evolution). */
  lotCostPerShare: number | null;
  /** Cumulative realized P&L attributed to this buy from later sells. */
  lotRealizedPnl: number | null;
  /** `open` (nothing sold), `partial` (some sold), or `closed`. */
  lotStatus: "open" | "partial" | "closed" | null;
}

// ---------------------------------------------------------------------------
// Per-symbol summary
// ---------------------------------------------------------------------------

export interface SymbolPerformance {
  symbol: string;
  /** Sum of realised P&L across every completed sell of this symbol. */
  realizedPnl: number;
  /** Total commissions paid on all trades of this symbol (buys + sells). */
  totalCommissions: number;
  /** Total capital deployed (∑ buy notional). Denominator for
   *  "return on invested capital" style figures. */
  totalBought: number;
  /** Total proceeds from sells (∑ sell notional). */
  totalSold: number;
  /** Number of individual sell trades that closed at a profit. */
  winCount: number;
  /** Number of individual sell trades that closed at a loss. */
  lossCount: number;
  /** Number of individual sell trades that closed at exactly $0
   *  (rare — same price in and out). Kept separate from wins/losses
   *  so win rate stays honest. */
  breakEvenCount: number;
  /** Total number of round trips this symbol has completed (shares
   *  reached zero after a sell). Distinct from `winCount` — a single
   *  round trip can span multiple sells and multiple buys. */
  roundTrips: number;
  /** Best (largest positive) realised P&L on a single sell trade. */
  bestTrade: number | null;
  /** Worst (largest negative) realised P&L on a single sell trade. */
  worstTrade: number | null;
  /** Currently-open position size in shares (0 = flat). Useful so the
   *  UI can show "5 shares still open" next to the realised figure. */
  openShares: number;
  /** Average cost of the currently-open shares. `null` when flat. */
  openAvgCost: number | null;
  /** ISO timestamp of the most recent trade — used for sorting. */
  lastTradeAt: string;
  /** ISO timestamp of the first trade — useful for "hold time" type stats. */
  firstTradeAt: string;
}

// ---------------------------------------------------------------------------
// Portfolio-wide summary
// ---------------------------------------------------------------------------

export interface PortfolioAnalytics {
  /** Sum of realised P&L across every symbol. Equals total cash gain
   *  from trading, minus commissions. */
  totalRealizedPnl: number;
  /** Every commission paid across every trade. */
  totalCommissions: number;
  /** Total number of trades executed (buys + sells). */
  tradeCount: number;
  /** Number of individual sell trades ever executed. Denominator for
   *  `winRate`. */
  sellCount: number;
  /** Fraction (0..1) of sells that closed at a gain. `null` when no
   *  sells have executed yet. */
  winRate: number | null;
  /** Mean realised P&L across winning sells only. `null` when no wins. */
  averageWin: number | null;
  /** Mean realised P&L across losing sells only (kept as a negative
   *  number for symmetry with `averageWin`). `null` when no losses. */
  averageLoss: number | null;
  /** Ratio |averageWin / averageLoss| — a key risk-reward number that
   *  compresses the two averages into one. `null` when either half
   *  is missing. */
  payoffRatio: number | null;
  /** Number of distinct symbols the user has ever traded. */
  symbolCount: number;
  /** Number of symbols with an open position right now. */
  openSymbolCount: number;
  /** Best-performing symbol by realised P&L. `null` when nothing traded. */
  bestSymbol: SymbolPerformance | null;
  /** Worst-performing symbol by realised P&L. `null` when nothing traded. */
  worstSymbol: SymbolPerformance | null;
}

// ---------------------------------------------------------------------------
// Combined return shape
// ---------------------------------------------------------------------------

export interface PaperAnalyticsResult {
  perSymbol: SymbolPerformance[];
  portfolio: PortfolioAnalytics;
  enrichedTrades: EnrichedTrade[];
}

// ---------------------------------------------------------------------------
// Replay engine
// ---------------------------------------------------------------------------

interface ReplayState {
  shares: number;
  avgCost: number;
  /**
   * FIFO lot queue for this symbol. Each Buy pushes a lot; Sells
   * drain the oldest lots first. When a lot closes we DON'T shift
   * it out of the queue — we just leave `remainingShares === 0` so
   * the `tradeId` back-reference stays valid for later attribution
   * on the enriched trade output. Cheap: the queue is only as long
   * as the number of buys, per symbol.
   */
  lots: LotState[];
}

interface LotState {
  tradeId: number;
  originalShares: number;
  costPerShare: number;
  remainingShares: number;
  attributedRealized: number;
}

/**
 * Walk trades in chronological order, maintaining a per-symbol
 * (shares, avgCost) state, and compute realised P&L for every sell.
 *
 * @param trades Trades in any order — we clone + sort ascending before
 *               replay so callers don't have to.
 */
export function computePaperAnalytics(trades: Trade[]): PaperAnalyticsResult {
  if (trades.length === 0) {
    return {
      perSymbol: [],
      portfolio: emptyPortfolio(),
      enrichedTrades: [],
    };
  }

  // Ascending by created_at so cost basis math flows in trade order.
  // Stable secondary sort by id keeps trades placed at identical
  // timestamps (unusual, but possible under a stubbed clock) in insert
  // order.
  const chrono = [...trades].sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return a.id - b.id;
  });

  const state = new Map<string, ReplayState>();
  const perSymbol = new Map<string, SymbolPerformance>();
  const enrichedByOriginalId = new Map<number, EnrichedTrade>();

  const initPerf = (symbol: string, firstAt: string): SymbolPerformance => ({
    symbol,
    realizedPnl: 0,
    totalCommissions: 0,
    totalBought: 0,
    totalSold: 0,
    winCount: 0,
    lossCount: 0,
    breakEvenCount: 0,
    roundTrips: 0,
    bestTrade: null,
    worstTrade: null,
    openShares: 0,
    openAvgCost: null,
    lastTradeAt: firstAt,
    firstTradeAt: firstAt,
  });

  // Track every lot we've ever opened by trade id — a flat map means
  // the second-pass fold onto enriched trades is O(1) per buy.
  const lotByBuyId = new Map<number, LotState>();

  for (const t of chrono) {
    const symbol = t.symbol;
    const st = state.get(symbol) ?? { shares: 0, avgCost: 0, lots: [] };
    const perf =
      perSymbol.get(symbol) ?? initPerf(symbol, t.createdAt);
    perf.totalCommissions += t.commission;
    perf.lastTradeAt = t.createdAt;

    let realizedPnl: number | null = null;
    let realizedPnlPct: number | null = null;
    let costBasisSold: number | null = null;

    if (t.side === "buy") {
      // Weighted-average cost basis. Matches `placeOrder()` in
      // lib/paper-trading.ts — the two paths must agree byte-for-byte
      // so the analytics number for the *current* open position aligns
      // with the ledger's `avg_cost`.
      const newShares = st.shares + t.shares;
      const newAvg =
        newShares === 0
          ? 0
          : (st.shares * st.avgCost + t.shares * t.price) / newShares;
      st.shares = newShares;
      st.avgCost = newAvg;
      perf.totalBought += t.shares * t.price;

      // Open a FIFO lot mirroring this buy. Cost per share is the
      // pure trade price — paper trading (unlike the imported
      // portfolio) doesn't fold buy commission into avg cost;
      // commission is only debited from cash at trade time. We
      // preserve that convention here so lot P&L reconciles cleanly
      // with the ledger's avg cost.
      const lot: LotState = {
        tradeId: t.id,
        originalShares: t.shares,
        costPerShare: t.price,
        remainingShares: t.shares,
        attributedRealized: 0,
      };
      st.lots.push(lot);
      lotByBuyId.set(t.id, lot);
    } else {
      // Sell path: compute P&L on the shares we can actually account
      // for from the running cost basis. If a sell exceeds `st.shares`
      // (shouldn't happen — placeOrder enforces it) we cap the P&L
      // calculation to what we tracked, and leave realizedPnl null so
      // the UI doesn't display a nonsense figure.
      const sellShares = t.shares;
      const closable = Math.min(sellShares, st.shares);
      if (closable > 0) {
        costBasisSold = closable * st.avgCost;
        realizedPnl = closable * (t.price - st.avgCost) - t.commission;
        realizedPnlPct =
          costBasisSold > 0 ? realizedPnl / costBasisSold : null;
        if (realizedPnl > 0) perf.winCount += 1;
        else if (realizedPnl < 0) perf.lossCount += 1;
        else perf.breakEvenCount += 1;
        perf.realizedPnl += realizedPnl;
        if (perf.bestTrade === null || realizedPnl > perf.bestTrade) {
          perf.bestTrade = realizedPnl;
        }
        if (perf.worstTrade === null || realizedPnl < perf.worstTrade) {
          perf.worstTrade = realizedPnl;
        }
      }

      // FIFO lot drain — walk the lots oldest-first, consuming
      // shares until this sell is filled, and attribute per-lot P&L
      // back onto each buy that funded it. Sell commission is
      // distributed proportionally across the consumed lots so the
      // sum stays honest.
      let toSell = closable;
      const consumed: Array<{ lot: LotState; shares: number }> = [];
      for (const lot of st.lots) {
        if (toSell <= 1e-9) break;
        if (lot.remainingShares <= 1e-9) continue;
        const take = Math.min(lot.remainingShares, toSell);
        lot.remainingShares -= take;
        consumed.push({ lot, shares: take });
        toSell -= take;
      }
      const totalConsumed = consumed.reduce((s, c) => s + c.shares, 0);
      if (totalConsumed > 1e-9) {
        for (const c of consumed) {
          const grossPnl = (t.price - c.lot.costPerShare) * c.shares;
          const commissionShare = t.commission * (c.shares / totalConsumed);
          c.lot.attributedRealized += grossPnl - commissionShare;
        }
      }

      perf.totalSold += t.shares * t.price;
      const preSellShares = st.shares;
      st.shares = Math.max(0, st.shares - sellShares);
      if (st.shares <= 1e-9) {
        st.shares = 0;
        st.avgCost = 0;
        // Only count a round trip when the sell actually closed a real
        // position — a "phantom sell" against zero shares (only reachable
        // via manual DB tampering) shouldn't be counted.
        if (preSellShares > 1e-9) perf.roundTrips += 1;
      }
    }

    state.set(symbol, st);
    perSymbol.set(symbol, perf);
    // Sells don't own a lot — lot fields stay null. Buys get their
    // lot back-referenced in the second pass below (attribution runs
    // through end of history first).
    enrichedByOriginalId.set(t.id, {
      ...t,
      realizedPnl,
      realizedPnlPct,
      costBasisSold,
      lotOriginalShares: null,
      lotSharesSold: null,
      lotSharesRemaining: null,
      lotCostPerShare: null,
      lotRealizedPnl: null,
      lotStatus: null,
    });
  }

  // Second pass: fold FIFO lot attribution onto every Buy in the
  // enriched output now that the whole history has been replayed.
  for (const [tradeId, lot] of lotByBuyId) {
    const enriched = enrichedByOriginalId.get(tradeId);
    if (!enriched) continue;
    const sold = lot.originalShares - lot.remainingShares;
    enriched.lotOriginalShares = lot.originalShares;
    enriched.lotSharesSold = sold;
    enriched.lotSharesRemaining = lot.remainingShares;
    enriched.lotCostPerShare = lot.costPerShare;
    enriched.lotRealizedPnl = lot.attributedRealized;
    enriched.lotStatus =
      lot.remainingShares <= 1e-9
        ? "closed"
        : sold > 1e-9
          ? "partial"
          : "open";
  }

  // Snapshot the still-open position for each symbol so the UI can show
  // "X open shares @ avg $Y" alongside the realised numbers.
  for (const [symbol, st] of state) {
    const perf = perSymbol.get(symbol);
    if (perf) {
      perf.openShares = st.shares;
      perf.openAvgCost = st.shares > 0 ? st.avgCost : null;
    }
  }

  const perSymbolList = [...perSymbol.values()].sort(
    (a, b) => b.realizedPnl - a.realizedPnl,
  );

  // Preserve the original (usually newest-first) trade order that
  // callers passed in — the analytics enrichment mustn't shuffle the
  // log display.
  const enrichedTrades = trades.map(
    (t) =>
      enrichedByOriginalId.get(t.id) ?? {
        ...t,
        realizedPnl: null,
        realizedPnlPct: null,
        costBasisSold: null,
        lotOriginalShares: null,
        lotSharesSold: null,
        lotSharesRemaining: null,
        lotCostPerShare: null,
        lotRealizedPnl: null,
        lotStatus: null,
      },
  );

  return {
    perSymbol: perSymbolList,
    portfolio: summarisePortfolio(perSymbolList, enrichedTrades, trades.length),
    enrichedTrades,
  };
}

function summarisePortfolio(
  perSymbol: SymbolPerformance[],
  enrichedTrades: EnrichedTrade[],
  tradeCount: number,
): PortfolioAnalytics {
  if (perSymbol.length === 0) return emptyPortfolio();

  const totalRealizedPnl = perSymbol.reduce((s, p) => s + p.realizedPnl, 0);
  const totalCommissions = perSymbol.reduce(
    (s, p) => s + p.totalCommissions,
    0,
  );

  // Walk the enriched trade log once to compute exact per-sell averages.
  // These match `perSymbol.realizedPnl` in aggregate but avoid the
  // "average of averages" bias that a per-symbol reduction would
  // introduce (a symbol with five small wins would be weighted the
  // same as one with a single huge win).
  let winCount = 0;
  let lossCount = 0;
  let breakEvenCount = 0;
  let winSum = 0;
  let lossSum = 0;
  for (const t of enrichedTrades) {
    if (t.side !== "sell" || t.realizedPnl === null) continue;
    if (t.realizedPnl > 0) {
      winCount += 1;
      winSum += t.realizedPnl;
    } else if (t.realizedPnl < 0) {
      lossCount += 1;
      lossSum += t.realizedPnl;
    } else {
      breakEvenCount += 1;
    }
  }
  const sellCount = winCount + lossCount + breakEvenCount;
  const averageWin = winCount > 0 ? winSum / winCount : null;
  const averageLoss = lossCount > 0 ? lossSum / lossCount : null;
  const payoffRatio =
    averageWin !== null && averageLoss !== null && averageLoss !== 0
      ? Math.abs(averageWin / averageLoss)
      : null;
  const winRate = sellCount > 0 ? winCount / sellCount : null;

  const openSymbols = perSymbol.filter((p) => p.openShares > 0);
  const best =
    perSymbol.length > 0
      ? perSymbol.reduce((a, b) => (a.realizedPnl >= b.realizedPnl ? a : b))
      : null;
  const worst =
    perSymbol.length > 0
      ? perSymbol.reduce((a, b) => (a.realizedPnl <= b.realizedPnl ? a : b))
      : null;

  return {
    totalRealizedPnl,
    totalCommissions,
    tradeCount,
    sellCount,
    winRate,
    averageWin,
    averageLoss,
    payoffRatio,
    symbolCount: perSymbol.length,
    openSymbolCount: openSymbols.length,
    bestSymbol: best,
    worstSymbol: worst,
  };
}

function emptyPortfolio(): PortfolioAnalytics {
  return {
    totalRealizedPnl: 0,
    totalCommissions: 0,
    tradeCount: 0,
    sellCount: 0,
    winRate: null,
    averageWin: null,
    averageLoss: null,
    payoffRatio: null,
    symbolCount: 0,
    openSymbolCount: 0,
    bestSymbol: null,
    worstSymbol: null,
  };
}
