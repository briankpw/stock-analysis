/**
 * Simulated brokerage account — all state persisted in the same SQLite DB
 * as the bot. This mirrors the semantics of `src/paper_trading.py`:
 *
 * * Single portfolio (id = 1), positions keyed by symbol.
 * * Cost basis is *weighted-average* on buys.
 * * Sells reduce the position at avg cost — realised P&L is embedded in
 *   the `cash` balance and rendered separately via the trade log.
 * * All orders execute at the price the caller passes in (the UI defaults
 *   to the most recent close).
 */

import { getDb } from "./db";
import { settings } from "./config";

export type Side = "buy" | "sell";

export interface Position {
  symbol: string;
  shares: number;
  avgCost: number;
  /** Optional stop-loss trigger price. Auto-sells the whole position when
   *  the live price falls to/below this level. `null` disables the guard. */
  stopLoss: number | null;
  /** Optional take-profit trigger price. Auto-sells the whole position when
   *  the live price rises to/above this level. `null` disables the guard. */
  takeProfit: number | null;
  updatedAt: string;
}

export interface Portfolio {
  cash: number;
  startingCash: number;
  positions: Position[];
  createdAt: string;
  updatedAt: string;
}

export interface Trade {
  id: number;
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  commission: number;
  cashAfter: number;
  note: string | null;
  createdAt: string;
}

export function getPortfolio(): Portfolio {
  const db = getDb();
  const row = db
    .prepare("SELECT cash, starting_cash, created_at, updated_at FROM paper_portfolio WHERE id = 1")
    .get() as {
      cash: number;
      starting_cash: number;
      created_at: string;
      updated_at: string;
    };
  const positions = db
    .prepare(
      "SELECT symbol, shares, avg_cost, stop_loss, take_profit, updated_at " +
        "FROM paper_positions ORDER BY symbol",
    )
    .all() as Array<{
      symbol: string;
      shares: number;
      avg_cost: number;
      stop_loss: number | null;
      take_profit: number | null;
      updated_at: string;
    }>;
  return {
    cash: row.cash,
    startingCash: row.starting_cash,
    positions: positions.map((p) => ({
      symbol: p.symbol,
      shares: p.shares,
      avgCost: p.avg_cost,
      stopLoss: p.stop_loss,
      takeProfit: p.take_profit,
      updatedAt: p.updated_at,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function recentTrades(limit = 50): Trade[] {
  const rows = getDb()
    .prepare(
      "SELECT id, symbol, side, shares, price, commission, cash_after, note, created_at " +
        "FROM paper_trades ORDER BY created_at DESC LIMIT ?",
    )
    .all(limit) as Array<{
      id: number;
      symbol: string;
      side: Side;
      shares: number;
      price: number;
      commission: number;
      cash_after: number;
      note: string | null;
      created_at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    side: r.side,
    shares: r.shares,
    price: r.price,
    commission: r.commission,
    cashAfter: r.cash_after,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/**
 * Execute a buy/sell order. Throws with a user-friendly message if the
 * order can't clear (insufficient cash / shares).
 *
 * When `input.stopLoss` and/or `input.takeProfit` are set on a **buy**,
 * the resulting position row is created with those guards already in
 * place — i.e. a "bracket order". This mirrors the standard broker UI
 * where users attach protective levels to the entry ticket instead of
 * having to open the position, then remember to configure targets in
 * a second step (which they often forget, negating the whole point of
 * having SL/TP).
 *
 * Bracket fields are validated identically to `setPositionTargets` and
 * only applied when the buy clears. Sells ignore them.
 */
export function placeOrder(input: {
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  note?: string;
  stopLoss?: number | null;
  takeProfit?: number | null;
}): Trade {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbol is required");
  if (!Number.isFinite(input.shares) || input.shares <= 0) {
    throw new Error("Shares must be a positive number");
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error("Price must be a positive number");
  }
  // Validate the bracket levels *before* touching the DB so we fail
  // fast rather than mid-transaction with a partial buy on the books.
  //
  // Deliberately relaxed: we only enforce the invariants that are
  // *always* wrong (non-positive prices, take-profit ≤ stop-loss).
  //
  // The previous version also rejected `stopLoss >= input.price` and
  // `takeProfit <= input.price` as "instant-kill traps", but that
  // assumes a fresh entry — when a user is *averaging into* an
  // existing position at a price above or below their current avg
  // cost, a perfectly sensible SL/TP relative to the blended cost
  // basis can be on the "wrong" side of the incremental fill price.
  // Example: hold 10 @ $100, buy 10 more @ $50 (new avg $75), want
  // SL at $60 — a legitimate protective stop that the old check
  // rejected because $60 > $50. Delegating this "is this level
  // sensible right now?" check to the client (which knows the live
  // price, not just `input.price`) keeps the server honest and
  // matches how real brokers behave: they'll accept any bracket
  // where SL < TP and immediately fire it if the market's already
  // through the level.
  if (input.side === "buy") {
    if (
      input.stopLoss !== undefined &&
      input.stopLoss !== null &&
      (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0)
    ) {
      throw new Error("Stop-loss must be a positive number");
    }
    if (
      input.takeProfit !== undefined &&
      input.takeProfit !== null &&
      (!Number.isFinite(input.takeProfit) || input.takeProfit <= 0)
    ) {
      throw new Error("Take-profit must be a positive number");
    }
    if (
      input.stopLoss !== undefined &&
      input.stopLoss !== null &&
      input.takeProfit !== undefined &&
      input.takeProfit !== null &&
      input.takeProfit <= input.stopLoss
    ) {
      throw new Error("Take-profit must be above stop-loss");
    }
  }
  const commission = settings.paper.commission;
  const notional = input.shares * input.price;

  const db = getDb();
  return db.transaction((): Trade => {
    const port = db
      .prepare("SELECT cash FROM paper_portfolio WHERE id = 1")
      .get() as { cash: number };
    const pos = db
      .prepare(
        "SELECT shares, avg_cost, stop_loss, take_profit FROM paper_positions WHERE symbol = ?",
      )
      .get(symbol) as
        | {
            shares: number;
            avg_cost: number;
            stop_loss: number | null;
            take_profit: number | null;
          }
        | undefined;

    let newCash = port.cash;
    if (input.side === "buy") {
      const cost = notional + commission;
      if (cost > port.cash + 1e-6) {
        throw new Error(
          `Insufficient cash: need $${cost.toFixed(2)}, have $${port.cash.toFixed(2)}`,
        );
      }
      newCash = port.cash - cost;

      const oldShares = pos?.shares ?? 0;
      const oldCost = pos?.avg_cost ?? 0;
      const newShares = oldShares + input.shares;
      const newAvg =
        newShares === 0
          ? 0
          : (oldShares * oldCost + input.shares * input.price) / newShares;

      // Bracket-order targets. When the caller passed either level,
      // apply it to the resulting position row. When they omitted a
      // level (undefined), preserve whatever was already on the row —
      // adding to an existing position shouldn't wipe existing guards.
      // Passing an explicit null clears the guard.
      const nextStopLoss =
        input.stopLoss === undefined ? (pos?.stop_loss ?? null) : input.stopLoss;
      const nextTakeProfit =
        input.takeProfit === undefined
          ? (pos?.take_profit ?? null)
          : input.takeProfit;

      db.prepare(
        "INSERT INTO paper_positions (symbol, shares, avg_cost, stop_loss, take_profit, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(symbol) DO UPDATE SET " +
          "shares = excluded.shares, avg_cost = excluded.avg_cost, " +
          "stop_loss = excluded.stop_loss, take_profit = excluded.take_profit, " +
          "updated_at = excluded.updated_at",
      ).run(
        symbol,
        newShares,
        newAvg,
        nextStopLoss,
        nextTakeProfit,
        new Date().toISOString(),
      );
    } else {
      const owned = pos?.shares ?? 0;
      if (owned + 1e-9 < input.shares) {
        throw new Error(
          `Insufficient shares of ${symbol}: need ${input.shares}, have ${owned}`,
        );
      }
      const proceeds = notional - commission;
      newCash = port.cash + proceeds;
      const newShares = owned - input.shares;
      if (newShares <= 1e-9) {
        db.prepare("DELETE FROM paper_positions WHERE symbol = ?").run(symbol);
      } else {
        db.prepare(
          "UPDATE paper_positions SET shares = ?, updated_at = ? WHERE symbol = ?",
        ).run(newShares, new Date().toISOString(), symbol);
      }
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE paper_portfolio SET cash = ?, updated_at = ? WHERE id = 1")
      .run(newCash, now);

    const info = db
      .prepare(
        "INSERT INTO paper_trades (symbol, side, shares, price, commission, cash_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        symbol,
        input.side,
        input.shares,
        input.price,
        commission,
        newCash,
        input.note ?? null,
        now,
      );
    return {
      id: Number(info.lastInsertRowid),
      symbol,
      side: input.side,
      shares: input.shares,
      price: input.price,
      commission,
      cashAfter: newCash,
      note: input.note ?? null,
      createdAt: now,
    };
  })();
}


/**
 * Set (or clear) the stop-loss / take-profit targets on an open position.
 * Passing `null` for either field disables that guard. Throws when the
 * position doesn't exist or the requested levels are self-contradictory
 * (e.g. take-profit below stop-loss).
 */
export function setPositionTargets(input: {
  symbol: string;
  stopLoss: number | null;
  takeProfit: number | null;
}): Position {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbol is required");
  if (input.stopLoss !== null) {
    if (!Number.isFinite(input.stopLoss) || input.stopLoss <= 0) {
      throw new Error("Stop-loss must be a positive number");
    }
  }
  if (input.takeProfit !== null) {
    if (!Number.isFinite(input.takeProfit) || input.takeProfit <= 0) {
      throw new Error("Take-profit must be a positive number");
    }
  }
  if (
    input.stopLoss !== null &&
    input.takeProfit !== null &&
    input.takeProfit <= input.stopLoss
  ) {
    throw new Error("Take-profit must be above stop-loss");
  }

  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      "UPDATE paper_positions SET stop_loss = ?, take_profit = ?, updated_at = ? WHERE symbol = ?",
    )
    .run(input.stopLoss, input.takeProfit, now, symbol);
  if (info.changes === 0) {
    throw new Error(`No open position for ${symbol}`);
  }
  const row = db
    .prepare(
      "SELECT symbol, shares, avg_cost, stop_loss, take_profit, updated_at FROM paper_positions WHERE symbol = ?",
    )
    .get(symbol) as {
      symbol: string;
      shares: number;
      avg_cost: number;
      stop_loss: number | null;
      take_profit: number | null;
      updated_at: string;
    };
  return {
    symbol: row.symbol,
    shares: row.shares,
    avgCost: row.avg_cost,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    updatedAt: row.updated_at,
  };
}


export type TriggerReason = "stop-loss" | "take-profit";

export interface TriggerEvent {
  symbol: string;
  reason: TriggerReason;
  level: number;
  price: number;
  trade: Trade;
}

/**
 * Walk every open position and auto-execute a full sell at the supplied
 * live price when the stop-loss / take-profit level has been breached.
 *
 * `prices` maps ticker symbols to their most recent price. Missing or
 * null entries are skipped (we don't fire guards on stale data).
 *
 * The check is:
 *   - stop-loss triggers when `price <= stopLoss`
 *   - take-profit triggers when `price >= takeProfit`
 *
 * Take-profit is checked first because a gap-up-then-fill bar can straddle
 * both levels and the profit path is the friendlier close to record.
 * Returns one `TriggerEvent` per position that fired — the caller can
 * surface these to the user (banner / toast / Telegram in the future).
 */
export function evaluateTargets(prices: Record<string, number | null>): TriggerEvent[] {
  const port = getPortfolio();
  const events: TriggerEvent[] = [];
  for (const p of port.positions) {
    const price = prices[p.symbol];
    if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) {
      continue;
    }
    let reason: TriggerReason | null = null;
    let level: number | null = null;
    if (p.takeProfit !== null && price >= p.takeProfit) {
      reason = "take-profit";
      level = p.takeProfit;
    } else if (p.stopLoss !== null && price <= p.stopLoss) {
      reason = "stop-loss";
      level = p.stopLoss;
    }
    if (!reason || level === null) continue;
    try {
      const trade = placeOrder({
        symbol: p.symbol,
        side: "sell",
        shares: p.shares,
        price,
        note:
          reason === "stop-loss"
            ? `Stop-loss triggered @ $${level.toFixed(2)} (last $${price.toFixed(2)})`
            : `Take-profit triggered @ $${level.toFixed(2)} (last $${price.toFixed(2)})`,
      });
      events.push({ symbol: p.symbol, reason, level, price, trade });
    } catch (err) {
      // Defensive: if something races us to a partial sell (or any
      // other placeOrder-side failure), skip this position — it will
      // be reevaluated on the next GET tick. Log at warn level so a
      // *persistent* failure (e.g. a bug in placeOrder itself, not
      // just a benign race) doesn't hide in silence.
      console.warn(
        `[paper] evaluateTargets: ${p.symbol} ${reason} guard failed to fire @ $${price.toFixed(2)} — will retry next tick.`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
  }
  return events;
}


/** Reset everything to the starting cash. Used by the UI's "Reset" button. */
export function resetPortfolio(startingCash?: number): void {
  const now = new Date().toISOString();
  const cash = startingCash ?? settings.paper.startingCash;
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "UPDATE paper_portfolio SET cash = ?, starting_cash = ?, updated_at = ? WHERE id = 1",
    ).run(cash, cash, now);
    db.prepare("DELETE FROM paper_positions").run();
    db.prepare("DELETE FROM paper_trades").run();
  })();
}


/**
 * Snapshot with live prices supplied by the caller (usually the last close
 * fetched by the UI). Returns the market value / unrealised P&L for each
 * position plus the portfolio total.
 */
export interface Valuation {
  cash: number;
  startingCash: number;
  positions: Array<Position & { last: number | null; marketValue: number | null; unrealised: number | null }>;
  marketValue: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
}

export function valuePortfolio(prices: Record<string, number | null>): Valuation {
  const port = getPortfolio();
  let marketValue = 0;
  const positions = port.positions.map((p) => {
    const last = prices[p.symbol] ?? null;
    const mv = last === null ? null : last * p.shares;
    const unreal = last === null ? null : (last - p.avgCost) * p.shares;
    if (mv !== null) marketValue += mv;
    return { ...p, last, marketValue: mv, unrealised: unreal };
  });
  const totalValue = port.cash + marketValue;
  const totalPnl = totalValue - port.startingCash;
  const totalPnlPct = port.startingCash > 0 ? totalPnl / port.startingCash : 0;
  return {
    cash: port.cash,
    startingCash: port.startingCash,
    positions,
    marketValue,
    totalValue,
    totalPnl,
    totalPnlPct,
  };
}
