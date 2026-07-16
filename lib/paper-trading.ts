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
    .prepare("SELECT symbol, shares, avg_cost, updated_at FROM paper_positions ORDER BY symbol")
    .all() as Array<{ symbol: string; shares: number; avg_cost: number; updated_at: string }>;
  return {
    cash: row.cash,
    startingCash: row.starting_cash,
    positions: positions.map((p) => ({
      symbol: p.symbol,
      shares: p.shares,
      avgCost: p.avg_cost,
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
 */
export function placeOrder(input: {
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  note?: string;
}): Trade {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error("Symbol is required");
  if (!Number.isFinite(input.shares) || input.shares <= 0) {
    throw new Error("Shares must be a positive number");
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error("Price must be a positive number");
  }
  const commission = settings.paper.commission;
  const notional = input.shares * input.price;

  const db = getDb();
  return db.transaction((): Trade => {
    const port = db
      .prepare("SELECT cash FROM paper_portfolio WHERE id = 1")
      .get() as { cash: number };
    const pos = db
      .prepare("SELECT shares, avg_cost FROM paper_positions WHERE symbol = ?")
      .get(symbol) as { shares: number; avg_cost: number } | undefined;

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

      db.prepare(
        "INSERT INTO paper_positions (symbol, shares, avg_cost, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(symbol) DO UPDATE SET shares = excluded.shares, avg_cost = excluded.avg_cost, updated_at = excluded.updated_at",
      ).run(symbol, newShares, newAvg, new Date().toISOString());
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
