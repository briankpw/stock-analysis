/**
 * Portfolio aggregation — turn a stream of transaction rows into
 * position-level and portfolio-level summaries.
 *
 * The raw `HoldingRow[]` from `portfolio-import.ts` is one row per
 * transaction (Buy / Sell / watch-header). To answer "how much do I
 * hold?" and "how much have I made?" we need to fold those rows down
 * into a single number per (portfolio × symbol) pair, then optionally
 * roll those up per currency for grand totals.
 *
 * Cost-basis method: **weighted average cost** (not FIFO/LIFO).
 *   • Simplest to reason about visually.
 *   • Matches what most retail brokers show ("average cost per share").
 *   • Handles partial sells cleanly — a sell doesn't change the average
 *     cost of the shares still held, it just realizes the diff between
 *     the sell price and the current average.
 *
 * The rows are ordered chronologically before folding so that sells
 * following buys realize against the correct running average.
 *
 * All math stays in the security's own currency — no FX conversion.
 * Grand totals are therefore bucketed *per currency* (USD / HKD / SGD /
 * …) so we never mix apples and oranges.
 */

import type { HoldingRow } from "./portfolio-import";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single (portfolio, symbol) position — the row-level unit the
 * grouped positions table renders.
 *
 * `realizedPnl` captures profit already booked from sells; it counts
 * even after the position is fully closed. `unrealizedPnl` needs a
 * live price (see `attachLiveQuote`) and stays null until one is
 * supplied.
 */
/**
 * A single trade event within a position, enriched with the running
 * state *after* the trade was applied. Fed to the drilldown panel so
 * users can see how their average cost and share count evolved bar-
 * by-bar without redoing the fold in the UI.
 *
 * `realizedPnl` is non-zero only on Sell rows. On Buy / Watch rows it
 * stays 0 — realized P&L is booked at the moment of a sell.
 */
export interface TradeEvent {
  /** Original CSV row this event was derived from — passed through so
   *  the UI can show fields we don't lift to the top level (notes,
   *  accounting flags, etc.) without needing a second lookup. */
  row: HoldingRow;
  /** "Buy" | "Sell" | null (watch-header rows). */
  type: HoldingRow["type"];
  /** Shares in this trade (positive number even for sells — direction
   *  comes from `type`). Null on watch rows. */
  shares: number | null;
  /** Price per share paid / received. Null on watch rows. */
  price: number | null;
  /** Commission paid for this trade. */
  commission: number;
  /** Total cash flow — negative on buys (money out), positive on sells
   *  (money in). Null on watch rows. */
  cashFlow: number | null;
  /** Realized P&L booked by this trade. 0 unless this is a Sell. */
  realizedPnl: number;
  /** Net shares held **after** this trade was applied. */
  runningShares: number;
  /** Weighted-average cost per share **after** this trade was applied.
   *  Null when the position is flat (a fresh basis will be established
   *  on the next Buy). */
  runningAvgCost: number | null;
  /** Cumulative realized P&L up to and including this trade. */
  runningRealizedPnl: number;
}

export interface Position {
  portfolio: string;
  symbol: string;
  name: string;
  displaySymbol: string | null;
  currency: string;

  /**
   * The chronological trade timeline for this position. Ordered
   * oldest → newest so the drilldown panel can show trades top-to-
   * bottom (the UI reverses on demand). Watch-header rows are
   * included so purely-watched symbols still appear.
   */
  trades: TradeEvent[];

  /** How many shares are currently held (bought − sold). */
  netShares: number;
  /** Total shares ever bought (informational). */
  boughtShares: number;
  /** Total shares ever sold (informational). */
  soldShares: number;
  /** Number of Buy transactions in this position. */
  buyCount: number;
  /** Number of Sell transactions in this position. */
  sellCount: number;

  /**
   * Weighted-average cost per share of the currently-held shares. Null
   * when `netShares === 0` (fully closed) — a cost basis on zero shares
   * is a divide-by-zero we deliberately don't fudge.
   */
  avgCost: number | null;
  /** Dollar amount currently deployed in the position (avgCost × netShares). */
  investedNow: number;
  /** Lifetime money spent buying (shares × cost + commission). */
  totalInvested: number;
  /** Lifetime money received from sells (shares × price − commission). */
  totalProceeds: number;
  /**
   * Total commission paid across all trades in this position. Kept
   * separately so users can see "how much did brokerage eat".
   */
  totalCommission: number;

  /**
   * Profit already booked from sells, computed against the running
   * average cost at the moment of each sell. Positive = took profit,
   * negative = took loss.
   */
  realizedPnl: number;

  /** Earliest transaction date in the position (ISO or raw MSP string). */
  firstTradeDate: string | null;
  /** Latest transaction date in the position. */
  lastTradeDate: string | null;

  // --- Live-price fields (populated by `attachLiveQuote`) --------------

  /** Latest market price. Null until a quote is attached. */
  price: number | null;
  /** Yesterday's close (or the last available close). Null until a quote is attached. */
  previousClose: number | null;
  /** Current market value = price × netShares. Null if either input is null. */
  marketValue: number | null;
  /** Unrealized profit = (price − avgCost) × netShares. Null if price/avgCost missing. */
  unrealizedPnl: number | null;
  /** Unrealized profit as % of invested capital. */
  unrealizedPnlPct: number | null;
  /**
   * Position-level daily change = (price − previousClose) × netShares.
   * Null if either input is null. This is the dollar amount you gained
   * or lost *today* on this position alone.
   */
  dayChange: number | null;
  /** Daily change as % of previous close. */
  dayChangePct: number | null;
  /**
   * `realizedPnl + unrealizedPnl` — the "how much have I earned overall
   * (booked + on paper)" number. Null when we don't have a live price.
   */
  totalPnl: number | null;
}

/**
 * A per-currency grand-total bucket. When a user has USD and HKD trades
 * mixed in the same portfolio, we surface two separate totals rather
 * than fake an FX-converted sum.
 */
export interface CurrencyTotals {
  currency: string;
  /** Number of open (netShares > 0) positions in this bucket. */
  openPositions: number;
  /** Number of closed (netShares === 0) positions in this bucket. */
  closedPositions: number;
  /** Sum of `investedNow` across open positions. */
  invested: number;
  /**
   * Sum of `marketValue` across open positions. Null when no live
   * quotes are attached to any open position in the bucket.
   */
  marketValue: number | null;
  /** Sum of `unrealizedPnl` across open positions. Null if no quotes. */
  unrealizedPnl: number | null;
  /** Sum of `realizedPnl` across every position (open + closed). */
  realizedPnl: number;
  /** `realizedPnl + unrealizedPnl`. Null if quotes missing. */
  totalPnl: number | null;
  /** Sum of `dayChange` across open positions. Null if quotes missing. */
  dayChange: number | null;
  /** Weighted daily change % vs. previous close market value. */
  dayChangePct: number | null;
  /** Sum of commissions ever paid in this currency. */
  commissions: number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Parse the various date formats MSP uses into a comparable millisecond
 * timestamp for chronological sorting. The raw MSP field looks like
 * `"2018-11-01 GMT+0800"` — the leading YYYY-MM-DD is what we care
 * about; timezone can be off by a few hours and still sort correctly.
 */
function tradeMs(row: HoldingRow): number {
  const raw = row.transactionDate;
  if (!raw) return 0;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  // Force UTC so system-timezone changes don't shuffle order.
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return Date.UTC(y, mo, d);
}

/**
 * Group and reduce raw `HoldingRow[]` into `Position[]`. Watch-only
 * rows (type = null) are kept as zero-share stubs so the user still
 * sees a card for them (with "not held" chip in the UI).
 */
export function aggregatePositions(rows: HoldingRow[]): Position[] {
  const groups = new Map<string, HoldingRow[]>();
  for (const r of rows) {
    const key = `${r.portfolio}\u0000${r.symbol}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(r);
  }

  const positions: Position[] = [];
  for (const bucket of groups.values()) {
    positions.push(reducePosition(bucket));
  }

  // Default sort: open positions first (highest market value first if
  // we know it, else highest invested), then closed positions by most
  // recent trade date, then watch-only entries.
  positions.sort((a, b) => {
    const openA = a.netShares > 0 ? 1 : 0;
    const openB = b.netShares > 0 ? 1 : 0;
    if (openA !== openB) return openB - openA;
    // Both open → higher invested first (proxy for weight).
    if (openA === 1) return b.investedNow - a.investedNow;
    // Both closed / watch → most recent trade first.
    const dA = a.lastTradeDate ?? "";
    const dB = b.lastTradeDate ?? "";
    return dB.localeCompare(dA);
  });

  return positions;
}

/**
 * Fold a single (portfolio, symbol) bucket into a `Position`. Runs the
 * trades in chronological order, tracking a running average cost per
 * share so partial sells realize P&L correctly.
 */
function reducePosition(bucket: HoldingRow[]): Position {
  // Sort chronologically — a sell at t=1 must not settle against a buy
  // that only happens at t=2.
  const sorted = [...bucket].sort((a, b) => tradeMs(a) - tradeMs(b));

  // Pull identity fields from the first non-empty row (they should be
  // consistent across the bucket by construction — same symbol +
  // portfolio — but display-friendly fields can be missing on watch
  // rows).
  const anchor = sorted.find((r) => r.name) ?? sorted[0]!;

  let netShares = 0;
  let boughtShares = 0;
  let soldShares = 0;
  let buyCount = 0;
  let sellCount = 0;

  let totalInvested = 0;
  let totalProceeds = 0;
  let totalCommission = 0;
  let realizedPnl = 0;

  // Running weighted-average cost basis. Reset to null when the
  // position goes flat, so a re-entry starts fresh.
  let avgCost: number | null = null;

  let firstTradeDate: string | null = null;
  let lastTradeDate: string | null = null;

  // Trade timeline — pushed to as we fold. Each entry captures the
  // running state *after* the trade so the drilldown UI can render
  // "at this point you held X shares at avg $Y" without redoing math.
  const trades: TradeEvent[] = [];

  for (const row of sorted) {
    if (row.transactionDate) {
      firstTradeDate ??= row.transactionDate;
      lastTradeDate = row.transactionDate;
    }
    const commission = row.commission ?? 0;
    totalCommission += commission;

    let realizedThisTrade = 0;
    let cashFlow: number | null = null;

    if (row.type === "Buy" && row.shares != null && row.costPerShare != null) {
      const spend = row.shares * row.costPerShare + commission;
      totalInvested += spend;
      cashFlow = -spend;

      // Update running average cost: weighted by shares held vs. shares
      // added. Commission is folded into the buy's per-share cost so
      // the user's real cost basis reflects brokerage.
      const newCostPerShare = (row.shares * row.costPerShare + commission) / row.shares;
      if (netShares <= 0 || avgCost == null) {
        avgCost = newCostPerShare;
      } else {
        avgCost = (avgCost * netShares + newCostPerShare * row.shares) / (netShares + row.shares);
      }
      netShares += row.shares;
      boughtShares += row.shares;
      buyCount += 1;
    } else if (row.type === "Sell" && row.shares != null && row.costPerShare != null) {
      const proceeds = row.shares * row.costPerShare - commission;
      totalProceeds += proceeds;
      cashFlow = proceeds;

      // Realize P&L against the running average cost of the currently-
      // held shares. If the user oversells (data error / short) we
      // still record proceeds but skip the P&L (avgCost is null / stale).
      if (avgCost != null && netShares > 0) {
        const soldFromHoldings = Math.min(row.shares, netShares);
        realizedThisTrade = (row.costPerShare - avgCost) * soldFromHoldings - commission;
        realizedPnl += realizedThisTrade;
      }
      netShares -= row.shares;
      soldShares += row.shares;
      sellCount += 1;
      // When the position closes, clear the running cost so a
      // subsequent re-buy establishes a fresh basis.
      if (netShares <= 1e-9) {
        netShares = Math.max(netShares, 0);
        avgCost = null;
      }
    }
    // else: watch-only row (type === null) — no cash flow, just tracked.

    trades.push({
      row,
      type: row.type,
      shares: row.shares,
      price: row.costPerShare,
      commission,
      cashFlow,
      realizedPnl: realizedThisTrade,
      runningShares: netShares,
      runningAvgCost: avgCost,
      runningRealizedPnl: realizedPnl,
    });
  }

  const investedNow = avgCost != null ? avgCost * netShares : 0;

  return {
    portfolio: anchor.portfolio,
    symbol: anchor.symbol,
    name: anchor.name || anchor.symbol,
    displaySymbol: anchor.displaySymbol,
    currency: anchor.currency,
    trades,
    netShares,
    boughtShares,
    soldShares,
    buyCount,
    sellCount,
    avgCost,
    investedNow,
    totalInvested,
    totalProceeds,
    totalCommission,
    realizedPnl,
    firstTradeDate,
    lastTradeDate,
    // Live fields — filled in by `attachLiveQuote`.
    price: null,
    previousClose: null,
    marketValue: null,
    unrealizedPnl: null,
    unrealizedPnlPct: null,
    dayChange: null,
    dayChangePct: null,
    totalPnl: null,
  };
}

// ---------------------------------------------------------------------------
// Live-quote enrichment
// ---------------------------------------------------------------------------

/** Minimal shape the aggregator needs from a live quote fetch. */
export interface LiveQuote {
  price: number | null;
  previousClose: number | null;
}

/**
 * Fold a lookup of live quotes into an array of positions, returning
 * new objects (immutable in-place is intentionally avoided so React
 * memo boundaries downstream can rely on identity).
 *
 * Positions whose symbol has no quote in the map are returned
 * untouched (live fields stay null). This is deliberate — a partial
 * quote outage should degrade gracefully rather than blanking every
 * row.
 */
export function attachLiveQuotes(
  positions: Position[],
  quotes: Record<string, LiveQuote | undefined>,
): Position[] {
  return positions.map((p) => {
    const q = quotes[p.symbol];
    if (!q) return p;
    const price = q.price;
    const previousClose = q.previousClose;

    const marketValue = price != null ? price * p.netShares : null;
    const unrealizedPnl =
      price != null && p.avgCost != null && p.netShares > 0
        ? (price - p.avgCost) * p.netShares
        : null;
    const unrealizedPnlPct =
      unrealizedPnl != null && p.investedNow > 0
        ? unrealizedPnl / p.investedNow
        : null;
    const dayChange =
      price != null && previousClose != null && p.netShares > 0
        ? (price - previousClose) * p.netShares
        : null;
    const dayChangePct =
      price != null && previousClose != null && previousClose !== 0
        ? (price - previousClose) / previousClose
        : null;
    const totalPnl =
      unrealizedPnl != null ? p.realizedPnl + unrealizedPnl : null;

    return {
      ...p,
      price,
      previousClose,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      dayChange,
      dayChangePct,
      totalPnl,
    };
  });
}

// ---------------------------------------------------------------------------
// Currency roll-up
// ---------------------------------------------------------------------------

/**
 * Roll up positions into per-currency totals. Positions with different
 * currencies stay in their own buckets — we never sum across FX.
 * Empty-string currency (missing from CSV) is coalesced into `"?"` so
 * the UI can label it clearly.
 */
export function totalsByCurrency(positions: Position[]): CurrencyTotals[] {
  const buckets = new Map<string, CurrencyTotals>();

  for (const p of positions) {
    const key = p.currency || "?";
    let b = buckets.get(key);
    if (!b) {
      b = {
        currency: key,
        openPositions: 0,
        closedPositions: 0,
        invested: 0,
        marketValue: null,
        unrealizedPnl: null,
        realizedPnl: 0,
        totalPnl: null,
        dayChange: null,
        dayChangePct: null,
        commissions: 0,
      };
      buckets.set(key, b);
    }
    b.commissions += p.totalCommission;
    b.realizedPnl += p.realizedPnl;
    if (p.netShares > 0) {
      b.openPositions += 1;
      b.invested += p.investedNow;
      if (p.marketValue != null) b.marketValue = (b.marketValue ?? 0) + p.marketValue;
      if (p.unrealizedPnl != null) b.unrealizedPnl = (b.unrealizedPnl ?? 0) + p.unrealizedPnl;
      if (p.dayChange != null) b.dayChange = (b.dayChange ?? 0) + p.dayChange;
    } else if (p.boughtShares > 0) {
      b.closedPositions += 1;
    }
  }

  // Second pass: fill in derived totals now that we have raw sums.
  for (const b of buckets.values()) {
    if (b.unrealizedPnl != null) b.totalPnl = b.realizedPnl + b.unrealizedPnl;
    if (b.dayChange != null && b.marketValue != null) {
      // Portfolio-level daily change % is `dayChange / (marketValue − dayChange)`,
      // i.e. previous-close basis for the whole bucket.
      const prevBasis = b.marketValue - b.dayChange;
      b.dayChangePct = prevBasis !== 0 ? b.dayChange / prevBasis : null;
    }
  }

  return [...buckets.values()].sort((a, b) => {
    // Bucket with the most open positions floats to the top.
    if (a.openPositions !== b.openPositions) return b.openPositions - a.openPositions;
    return a.currency.localeCompare(b.currency);
  });
}

// ---------------------------------------------------------------------------
// Utility helpers exported for UI
// ---------------------------------------------------------------------------

/** Distinct list of symbols we need live quotes for. Sorted for stable IO. */
export function uniqueOpenSymbols(positions: Position[]): string[] {
  const set = new Set<string>();
  for (const p of positions) {
    if (p.netShares > 0) set.add(p.symbol);
  }
  return [...set].sort();
}
