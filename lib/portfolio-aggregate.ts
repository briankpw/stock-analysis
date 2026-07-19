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
 * Cost-basis method: **FIFO** (First-In-First-Out).
 *   • Matches what US retail brokers (MooMoo, Schwab, Fidelity, IBKR,
 *     Robinhood, etc.) report on their statements and tax forms, so
 *     the app's realized-P&L number reconciles cleanly with what the
 *     user sees in their broker account.
 *   • Sells consume the oldest lots first; realized P&L is computed
 *     against each consumed lot's own cost basis (not a running
 *     weighted average).
 *   • The `avgCost` field shown on the position card is the *weighted
 *     average of the remaining open lots* — i.e. the true cost basis
 *     of the shares still held, not a historical mean that ignores
 *     which lots were already sold.
 *   • Note: FIFO and weighted-average produce the SAME total P&L
 *     (`realized + unrealized`) over the life of a position — they
 *     only differ in when gain is booked. This app was previously
 *     weighted-average, so on a fresh import the "realized" and
 *     "avg cost" columns will shift for any position that has had at
 *     least one sell; the total ("realized + unrealized") stays the
 *     same.
 *
 * The rows are ordered chronologically before folding so that sells
 * consume lots in the order they were bought.
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
 * stays 0 — realized P&L is booked at the moment of a sell. The value
 * is the sum over FIFO-consumed lots of
 * `(sellPrice − lotCostPerShare) × chunkShares` minus a proportional
 * share of the sell commission — i.e. the sell row books exactly the
 * P&L attributed to the specific lots it closed.
 *
 * The `lot*` fields (populated on Buy rows only) are the parallel
 * "which of my earlier buys made money?" view. They trace which
 * sells later consumed shares from this specific lot and attribute
 * the per-share realized P&L back to the buy. Because we're on FIFO
 * everywhere, the sum of every `lotRealizedPnl` across a position's
 * Buy rows equals the sum of every `realizedPnl` across its Sell rows
 * — the two views are just different lenses on the same numbers.
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

  // --- FIFO lot attribution (Buy rows only; null on Sell / Watch) ------

  /** Shares originally bought in this lot (same as `shares` for Buys).
   *  Kept as a separate field so the UI can compute "sold X of Y". */
  lotOriginalShares: number | null;
  /** Shares from this buy lot that were later consumed by FIFO sells. */
  lotSharesSold: number | null;
  /** Shares from this buy lot still open (originalShares − sharesSold). */
  lotSharesRemaining: number | null;
  /** Cost basis per share for this lot, including this buy's commission
   *  folded in (matches the position-level convention). */
  lotCostPerShare: number | null;
  /** Realized P&L attributable to this specific buy lot: sum over
   *  every sell chunk that consumed FIFO shares from this lot of
   *  `(sellPrice − lotCostPerShare) × chunkShares − proportional
   *  sellCommission`. Positive = this buy ended up profitable when
   *  sold, negative = this buy was sold at a loss. */
  lotRealizedPnl: number | null;
  /** `open` (nothing sold), `partial` (some sold, some held), or
   *  `closed` (fully drained by later sells). */
  lotStatus: "open" | "partial" | "closed" | null;
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
   * Weighted average cost per share of the currently-held (i.e. still-
   * open under FIFO) shares. Sells reduce this by draining oldest
   * lots first, so after a partial sell the number reflects only the
   * lots that survived — not a historical mean across every share
   * ever bought. Null when `netShares === 0` (fully closed) — a cost
   * basis on zero shares is a divide-by-zero we deliberately don't
   * fudge.
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
   * Profit already booked from sells. Each sell realizes P&L against
   * the cost basis of the specific FIFO lots it consumed (oldest
   * first), so this number matches what a US retail broker reports
   * on the same trade sequence. Positive = took profit, negative =
   * took loss.
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

  /**
   * Machine-readable warnings the folder emitted while chewing on this
   * position's rows — CSV data problems the user needs to know about
   * because they cause the summary numbers to disagree with the
   * broker statement.
   *
   * Currently produced:
   *   * `oversell` — one or more Sell rows tried to drain shares this
   *     position had never bought (transferred-in position not
   *     imported, actual short sell, or CSV row order error). The
   *     unmatched shares are still counted in `soldShares` and their
   *     proceeds still flow into `totalProceeds`, but no realized P&L
   *     is booked for them (no cost basis to net against) and
   *     `netShares` is left negative so the UI can flag the mismatch.
   *   * `zero_shares_buy` — one or more Buy rows had `shares === 0` or
   *     a non-positive share count and were skipped entirely (would
   *     otherwise divide by zero in the cost-per-share formula).
   *
   * Empty when the fold ran cleanly — the UI hides the warning strip
   * on an empty array so this is a zero-cost addition for the happy
   * path.
   */
  dataWarnings: PositionDataWarning[];
}

/**
 * Structured warning emitted when the aggregator finds a row it
 * couldn't fold cleanly. Kept as a discriminated union so the UI can
 * render a specific message per kind rather than a generic "check
 * your CSV" toast.
 */
export type PositionDataWarning =
  | {
      kind: "oversell";
      /** Total shares that had no matching buy lot to consume. */
      unmatchedShares: number;
      /** Total cash the user still received for these shares — kept
       *  in `totalProceeds` but excluded from `realizedPnl`. */
      unmatchedProceeds: number;
    }
  | {
      kind: "zero_shares_buy";
      /** How many Buy rows had a non-positive share count and were
       *  dropped from the fold. */
      rowsSkipped: number;
    };

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

  // Data-quality trackers — surfaced via `Position.dataWarnings` at the
  // end of the fold so the UI can flag rows that couldn't be settled
  // cleanly. Accumulated (not emitted per-row) so we emit at most one
  // warning of each kind per position rather than a spam list.
  let unmatchedSellShares = 0;
  let unmatchedSellProceeds = 0;
  let zeroSharesBuyRowsSkipped = 0;

  // Running weighted-average cost basis. Reset to null when the
  // position goes flat, so a re-entry starts fresh.
  let avgCost: number | null = null;

  let firstTradeDate: string | null = null;
  let lastTradeDate: string | null = null;

  // Trade timeline — pushed to as we fold. Each entry captures the
  // running state *after* the trade so the drilldown UI can render
  // "at this point you held X shares at avg $Y" without redoing math.
  const trades: TradeEvent[] = [];

  // Parallel FIFO lot queue for `lot*` attribution. Each buy pushes a
  // lot; sells drain the oldest lots first. When shares are drained
  // from a lot we attribute the realized P&L back to the buy event
  // that opened that lot (mutating the already-pushed TradeEvent by
  // its index — safe because we're the sole reference during the
  // fold). Lots are NOT shifted out of the array when depleted (we
  // just skip them) so their eventIndex stays valid for later
  // attribution.
  interface Lot {
    eventIdx: number;
    originalShares: number;
    costPerShare: number; // includes buy commission per share
    remainingShares: number;
    attributedRealized: number;
  }
  const lots: Lot[] = [];

  for (const row of sorted) {
    if (row.transactionDate) {
      firstTradeDate ??= row.transactionDate;
      lastTradeDate = row.transactionDate;
    }
    const commission = row.commission ?? 0;
    totalCommission += commission;

    let realizedThisTrade = 0;
    let cashFlow: number | null = null;
    // Snapshot the event index we're about to push — used below to
    // set the lot's `eventIdx` back-reference on Buys.
    const eventIdx = trades.length;

    if (
      row.type === "Buy" &&
      row.shares != null &&
      row.shares > 0 &&
      row.costPerShare != null
    ) {
      const spend = row.shares * row.costPerShare + commission;
      totalInvested += spend;
      cashFlow = -spend;

      // Update running average cost: weighted by shares held vs. shares
      // added. Commission is folded into the buy's per-share cost so
      // the user's real cost basis reflects brokerage. The
      // `row.shares > 0` gate above prevents a divide-by-zero here:
      // some broker exports emit `shares=0` rows for edge cases like
      // reinvested-dividend-with-cash-price=0, which would otherwise
      // produce `Infinity` and poison every downstream weighted-avg
      // computation with `NaN`.
      const newCostPerShare = (row.shares * row.costPerShare + commission) / row.shares;
      if (netShares <= 0 || avgCost == null) {
        avgCost = newCostPerShare;
      } else {
        avgCost = (avgCost * netShares + newCostPerShare * row.shares) / (netShares + row.shares);
      }
      netShares += row.shares;
      boughtShares += row.shares;
      buyCount += 1;

      // Open a new FIFO lot mirroring this buy.
      lots.push({
        eventIdx,
        originalShares: row.shares,
        costPerShare: newCostPerShare,
        remainingShares: row.shares,
        attributedRealized: 0,
      });
    } else if (
      row.type === "Buy" &&
      row.shares != null &&
      row.shares <= 0
    ) {
      // Explicitly zero/negative Buy — a malformed row we're refusing
      // to fold in (would otherwise divide by zero above). Count it
      // so the UI can surface a "N rows skipped" warning; still push
      // a TradeEvent below so the drilldown timeline shows the raw
      // row wasn't invisibly dropped.
      zeroSharesBuyRowsSkipped += 1;
    } else if (row.type === "Sell" && row.shares != null && row.costPerShare != null) {
      const proceeds = row.shares * row.costPerShare - commission;
      totalProceeds += proceeds;
      cashFlow = proceeds;

      // FIFO lot drain — walk the lots oldest-first, consuming shares
      // until this sell is filled. Realized P&L is computed on each
      // consumed chunk using that specific lot's own cost basis (the
      // whole point of FIFO). Sell commission is split proportionally
      // across the consumed lots so nothing is double-counted.
      let toSell = row.shares;
      const consumed: Array<{ lot: Lot; shares: number }> = [];
      for (const lot of lots) {
        if (toSell <= 1e-9) break;
        if (lot.remainingShares <= 1e-9) continue;
        const take = Math.min(lot.remainingShares, toSell);
        lot.remainingShares -= take;
        consumed.push({ lot, shares: take });
        toSell -= take;
      }
      const totalConsumed = consumed.reduce((s, c) => s + c.shares, 0);
      // Book realized P&L on the drained shares. If the user oversells
      // (data error / short-selling that we don't fully model) we
      // simply book P&L on whatever we could drain; the excess sale is
      // treated as a bare cash flow with no cost basis to net against.
      if (totalConsumed > 1e-9) {
        for (const c of consumed) {
          const grossPnl = (row.costPerShare - c.lot.costPerShare) * c.shares;
          const commissionShare = commission * (c.shares / totalConsumed);
          const chunkPnl = grossPnl - commissionShare;
          c.lot.attributedRealized += chunkPnl;
          realizedThisTrade += chunkPnl;
        }
        realizedPnl += realizedThisTrade;
      }
      // Any shares this sell tried to consume but couldn't drain from
      // an open lot are "oversells" — either bad data (missing prior
      // Buy row, transferred-in position not in the CSV), a genuine
      // short sale we don't fully model, or a broker split-lot
      // reconciliation. Track the residual so the UI can surface a
      // "N shares sold without a matching buy — check your CSV"
      // warning; the proceeds themselves still land in `totalProceeds`
      // above so the cash-flow view stays accurate, but they do NOT
      // land in `realizedPnl` (there's no cost basis to net against).
      const unmatched = row.shares - totalConsumed;
      if (unmatched > 1e-9) {
        unmatchedSellShares += unmatched;
        // Proportional share of the sell proceeds that couldn't be
        // matched to a lot. Kept just for the warning payload — not
        // used in any subsequent math.
        unmatchedSellProceeds += proceeds * (unmatched / row.shares);
      }

      netShares -= row.shares;
      soldShares += row.shares;
      sellCount += 1;

      // Under FIFO, the sold shares came from specific lots, so the
      // remaining shares' cost basis is the weighted mean of what's
      // LEFT — not the pre-sell running average. Recompute from the
      // surviving lots so the position card and the sell row's
      // "After · avg" column both reflect the true basis of what the
      // user still holds. This is the crucial FIFO-vs-weighted-avg
      // divergence: weighted-avg would leave `avgCost` unchanged
      // after a sell, hiding the fact that (say) selling the cheap
      // shares first pushed the remaining basis up.
      if (netShares > 1e-9) {
        let sumCost = 0;
        let sumShares = 0;
        for (const lot of lots) {
          if (lot.remainingShares > 1e-9) {
            sumCost += lot.remainingShares * lot.costPerShare;
            sumShares += lot.remainingShares;
          }
        }
        avgCost = sumShares > 1e-9 ? sumCost / sumShares : null;
      } else {
        // Position fully closed (`netShares` at 0) OR oversold
        // (`netShares` negative) — clear the basis either way so a
        // subsequent re-buy establishes a fresh one. We intentionally
        // do NOT clamp `netShares` to 0 here anymore: if the fold
        // ended up short, we want that negative number to survive to
        // the UI so the mismatch is visible. Historically we clamped
        // and silently hid the discrepancy; the `unmatchedSellShares`
        // accumulator above now carries the same information but
        // surfaces it explicitly via `dataWarnings`.
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
      // Lot fields default to null and get filled in below for Buys.
      lotOriginalShares: null,
      lotSharesSold: null,
      lotSharesRemaining: null,
      lotCostPerShare: null,
      lotRealizedPnl: null,
      lotStatus: null,
    });
  }

  // Fold FIFO lot attribution back onto each Buy event. We do this
  // as a post-pass rather than inline so the lot's `attributedRealized`
  // includes every sell up to *end of history*, not just what had
  // happened by the moment of the buy.
  for (const lot of lots) {
    const ev = trades[lot.eventIdx];
    if (!ev) continue;
    const sold = lot.originalShares - lot.remainingShares;
    ev.lotOriginalShares = lot.originalShares;
    ev.lotSharesSold = sold;
    ev.lotSharesRemaining = lot.remainingShares;
    ev.lotCostPerShare = lot.costPerShare;
    ev.lotRealizedPnl = lot.attributedRealized;
    ev.lotStatus =
      lot.remainingShares <= 1e-9
        ? "closed"
        : sold > 1e-9
          ? "partial"
          : "open";
  }

  const investedNow = avgCost != null ? avgCost * netShares : 0;

  const dataWarnings: PositionDataWarning[] = [];
  if (unmatchedSellShares > 1e-9) {
    dataWarnings.push({
      kind: "oversell",
      unmatchedShares: unmatchedSellShares,
      unmatchedProceeds: unmatchedSellProceeds,
    });
  }
  if (zeroSharesBuyRowsSkipped > 0) {
    dataWarnings.push({
      kind: "zero_shares_buy",
      rowsSkipped: zeroSharesBuyRowsSkipped,
    });
  }

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
    dataWarnings,
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
