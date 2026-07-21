/**
 * Simulated brokerage — persisted in SQLite alongside the bot's state.
 *
 * ## Multi-portfolio model (v15+)
 *
 * Every function that touches ledger data (`getPortfolio`, `placeOrder`,
 * `recentTrades`, `setPositionTargets`, `evaluateTargets`,
 * `resetPortfolio`, `valuePortfolio`) is scoped by `portfolioId`.
 * There is no ambient "default portfolio" — callers must supply the
 * id, and it must reference an existing row in `paper_portfolio`. Use
 * `listPortfolios()` at the API boundary to resolve the client's
 * `activePortfolioId` (or fall back to the first row) before calling
 * anything else.
 *
 * Each portfolio is a fully isolated sub-account:
 *
 *   * Its own cash + starting cash (unshared with siblings).
 *   * Its own set of positions, keyed on `(portfolio_id, symbol)`.
 *     Selling AAPL in one portfolio never mutates another portfolio's
 *     AAPL row — the compound PK guarantees this at the DB layer.
 *   * Its own trade log. `paper_analytics.ts` is portfolio-agnostic:
 *     hand it a scoped `Trade[]` and the same replay engine works.
 *
 * ## Invariants
 *
 *   * Cost basis is *weighted-average* on buys (matches
 *     `paper-analytics.ts` — the two paths must agree byte-for-byte).
 *   * Sells reduce the position at avg cost — realised P&L is embedded
 *     in `cash` and reconstructed by replaying trades.
 *   * All orders execute at the caller-supplied price. The UI defaults
 *     to the most recent close.
 *   * Bracket-order fields (`stopLoss` / `takeProfit`) attach to the
 *     resulting position row when set on a buy. See `placeOrder`.
 *   * A portfolio's `id` never changes; renaming updates `name` only.
 *     Deletion is a hard DELETE that cascades to positions + trades
 *     (FK ON DELETE CASCADE in the schema).
 */

import { getDb } from "./db";
import { settings } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  id: number;
  name: string;
  cash: number;
  startingCash: number;
  positions: Position[];
  createdAt: string;
  updatedAt: string;
  /** Non-null when the portfolio is soft-archived (reserved for future
   *  use — the current UI always deletes hard rather than archives). */
  archivedAt: string | null;
}

/** Just the identity fields — used by the portfolio picker to render the
 *  dropdown without pulling positions/trades. */
export interface PortfolioSummary {
  id: number;
  name: string;
  cash: number;
  startingCash: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Trade {
  id: number;
  /** The portfolio this trade belongs to. Denormalised into the type so
   *  the analytics module doesn't need a second lookup to know which
   *  portfolio a trade came from. */
  portfolioId: number;
  symbol: string;
  side: Side;
  shares: number;
  price: number;
  commission: number;
  cashAfter: number;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Portfolio CRUD
// ---------------------------------------------------------------------------

/**
 * List every portfolio ordered by (archived first? no — active first),
 * then alphabetical by name. Used by the portfolio picker and by the
 * API to resolve an implicit "no id supplied" to the first active row.
 */
export function listPortfolios(): PortfolioSummary[] {
  const rows = getDb()
    .prepare(
      "SELECT id, name, cash, starting_cash, archived_at, created_at, updated_at " +
        "FROM paper_portfolio " +
        // NULLs sort first with the default ASC ordering in SQLite, which
        // happens to give us "active portfolios first, archived last".
        "ORDER BY archived_at IS NOT NULL, LOWER(name) ASC",
    )
    .all() as Array<{
      id: number;
      name: string;
      cash: number;
      starting_cash: number;
      archived_at: string | null;
      created_at: string;
      updated_at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cash: r.cash,
    startingCash: r.starting_cash,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Load one portfolio (with its positions) by id. Throws when the id
 * doesn't exist — callers should validate at the API layer and return
 * a 404, not surface the raw error.
 */
export function getPortfolio(portfolioId: number): Portfolio {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, name, cash, starting_cash, archived_at, created_at, updated_at " +
        "FROM paper_portfolio WHERE id = ?",
    )
    .get(portfolioId) as
      | {
          id: number;
          name: string;
          cash: number;
          starting_cash: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
  if (!row) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }
  const positions = db
    .prepare(
      "SELECT symbol, shares, avg_cost, stop_loss, take_profit, updated_at " +
        "FROM paper_positions WHERE portfolio_id = ? ORDER BY symbol",
    )
    .all(portfolioId) as Array<{
      symbol: string;
      shares: number;
      avg_cost: number;
      stop_loss: number | null;
      take_profit: number | null;
      updated_at: string;
    }>;
  return {
    id: row.id,
    name: row.name,
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
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Normalise a user-supplied portfolio name. Trims whitespace, collapses
 * repeated internal spaces, and caps length at 60 chars. Rejects empty
 * strings and control characters — the name shows up in the picker + on
 * every trade log entry so we keep it printable.
 */
function normalisePortfolioName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) {
    throw new Error("Portfolio name is required");
  }
  if (trimmed.length > 60) {
    throw new Error("Portfolio name must be 60 characters or fewer");
  }
  // Control-char check (tab / newline / etc.) — the trim above catches
  // trailing whitespace but not, say, an embedded \n mid-string.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("Portfolio name contains invalid control characters");
  }
  return trimmed;
}

/**
 * Create a new (empty) portfolio. `startingCash` defaults to the app
 * config value; the same amount seeds `cash` so a fresh portfolio
 * starts with zero P&L. Returns the created summary.
 *
 * The UNIQUE constraint on `name` is enforced by SQLite; we translate
 * the raw SQLITE_CONSTRAINT_UNIQUE error into a friendly message so
 * the API layer can return a clean 400 without regex-parsing SQL.
 */
export function createPortfolio(input: {
  name: string;
  startingCash?: number;
}): PortfolioSummary {
  const name = normalisePortfolioName(input.name);
  const startingCash =
    input.startingCash !== undefined && Number.isFinite(input.startingCash) && input.startingCash > 0
      ? input.startingCash
      : settings.paper.startingCash;
  const now = new Date().toISOString();
  const db = getDb();
  try {
    const info = db
      .prepare(
        "INSERT INTO paper_portfolio (name, cash, starting_cash, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run(name, startingCash, startingCash, now, now);
    return {
      id: Number(info.lastInsertRowid),
      name,
      cash: startingCash,
      startingCash,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  } catch (err) {
    // better-sqlite3 exposes `code` on the thrown error; UNIQUE
    // violations are `SQLITE_CONSTRAINT_UNIQUE`. We surface a
    // domain-specific message rather than the raw SQL text.
    const code = (err as { code?: string })?.code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error(`A portfolio named "${name}" already exists`);
    }
    throw err;
  }
}

export function renamePortfolio(portfolioId: number, newName: string): PortfolioSummary {
  const name = normalisePortfolioName(newName);
  const now = new Date().toISOString();
  const db = getDb();
  try {
    const info = db
      .prepare("UPDATE paper_portfolio SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, now, portfolioId);
    if (info.changes === 0) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error(`A portfolio named "${name}" already exists`);
    }
    throw err;
  }
  const row = db
    .prepare(
      "SELECT id, name, cash, starting_cash, archived_at, created_at, updated_at " +
        "FROM paper_portfolio WHERE id = ?",
    )
    .get(portfolioId) as {
      id: number;
      name: string;
      cash: number;
      starting_cash: number;
      archived_at: string | null;
      created_at: string;
      updated_at: string;
    };
  return {
    id: row.id,
    name: row.name,
    cash: row.cash,
    startingCash: row.starting_cash,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Hard-delete a portfolio. FK ON DELETE CASCADE (see the v15 migration)
 * takes care of `paper_positions` and `paper_trades` in the same
 * statement — no manual cleanup needed here. Refuses to delete the
 * very last portfolio because the UI depends on at least one row
 * existing to render the picker.
 */
export function deletePortfolio(portfolioId: number): void {
  const db = getDb();
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM paper_portfolio")
    .get() as { n: number };
  if (remaining.n <= 1) {
    throw new Error("Cannot delete the last portfolio");
  }
  const info = db
    .prepare("DELETE FROM paper_portfolio WHERE id = ?")
    .run(portfolioId);
  if (info.changes === 0) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }
}

/**
 * Bulk-insert a list of trades and rebuild the resulting positions in a
 * single transaction. Used by the "materialise backtest as paper
 * portfolio" flow to seed a fresh portfolio from simulated trades
 * without having to POST N times to `/api/paper`.
 *
 * The trades are inserted verbatim (respecting their `createdAt`
 * ordering), and cash + positions are recomputed via the same math
 * `placeOrder` uses so the final state is identical to what would
 * result from placing the trades one-by-one via the normal path. The
 * caller must have already created the portfolio.
 *
 * Trades are inserted chronologically — any input order is sorted
 * ascending before replay so cost-basis math flows correctly.
 */
export function importTrades(
  portfolioId: number,
  input: Array<{
    symbol: string;
    side: Side;
    shares: number;
    price: number;
    commission?: number;
    note?: string | null;
    createdAt: string;
  }>,
): { insertedCount: number; finalCash: number } {
  if (input.length === 0) {
    const port = getPortfolio(portfolioId);
    return { insertedCount: 0, finalCash: port.cash };
  }
  const db = getDb();
  return db.transaction(() => {
    const port = db
      .prepare(
        "SELECT id, cash, starting_cash FROM paper_portfolio WHERE id = ?",
      )
      .get(portfolioId) as
        | { id: number; cash: number; starting_cash: number }
        | undefined;
    if (!port) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }
    // Reset to starting cash + drop any positions so the replay yields
    // a clean, reproducible state (idempotent regardless of what was
    // in the portfolio before). Trade log is preserved-then-cleared
    // via DELETE because we can't compose a "clear then re-insert"
    // any other way inside a single transaction.
    db.prepare("DELETE FROM paper_positions WHERE portfolio_id = ?").run(portfolioId);
    db.prepare("DELETE FROM paper_trades WHERE portfolio_id = ?").run(portfolioId);
    let cash = port.starting_cash;
    // Per-symbol running weighted-avg state — mirrors the placeOrder
    // math so the final positions row aligns with what an interactive
    // sequence of buys/sells would have produced.
    const state = new Map<string, { shares: number; avgCost: number }>();

    const sorted = [...input].sort((a, b) => {
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return 0;
    });
    const insertTrade = db.prepare(
      "INSERT INTO paper_trades (portfolio_id, symbol, side, shares, price, commission, cash_after, note, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );

    for (const t of sorted) {
      const symbol = t.symbol.trim().toUpperCase();
      const commission = t.commission ?? 0;
      const notional = t.shares * t.price;
      const st = state.get(symbol) ?? { shares: 0, avgCost: 0 };
      if (t.side === "buy") {
        cash -= notional + commission;
        const newShares = st.shares + t.shares;
        const newAvg =
          newShares === 0
            ? 0
            : (st.shares * st.avgCost + t.shares * t.price) / newShares;
        st.shares = newShares;
        st.avgCost = newAvg;
      } else {
        cash += notional - commission;
        st.shares = Math.max(0, st.shares - t.shares);
        if (st.shares <= 1e-9) {
          st.shares = 0;
          st.avgCost = 0;
        }
      }
      state.set(symbol, st);
      insertTrade.run(
        portfolioId,
        symbol,
        t.side,
        t.shares,
        t.price,
        commission,
        cash,
        t.note ?? null,
        t.createdAt,
      );
    }

    // Materialise the final per-symbol state into paper_positions.
    const insertPosition = db.prepare(
      "INSERT INTO paper_positions (portfolio_id, symbol, shares, avg_cost, stop_loss, take_profit, updated_at) " +
        "VALUES (?, ?, ?, ?, NULL, NULL, ?)",
    );
    const now = new Date().toISOString();
    for (const [symbol, st] of state) {
      if (st.shares > 1e-9) {
        insertPosition.run(portfolioId, symbol, st.shares, st.avgCost, now);
      }
    }
    db.prepare(
      "UPDATE paper_portfolio SET cash = ?, updated_at = ? WHERE id = ?",
    ).run(cash, now, portfolioId);

    return { insertedCount: sorted.length, finalCash: cash };
  })();
}

// ---------------------------------------------------------------------------
// Trade log
// ---------------------------------------------------------------------------

export function recentTrades(portfolioId: number, limit = 50): Trade[] {
  const rows = getDb()
    .prepare(
      "SELECT id, portfolio_id, symbol, side, shares, price, commission, cash_after, note, created_at " +
        "FROM paper_trades WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(portfolioId, limit) as Array<{
      id: number;
      portfolio_id: number;
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
    portfolioId: r.portfolio_id,
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

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Execute a buy/sell order against `portfolioId`. Throws with a user-
 * friendly message if the order can't clear (insufficient cash /
 * shares) or the portfolio doesn't exist.
 *
 * Bracket-order fields (`stopLoss` / `takeProfit`) attach to the
 * resulting position row when set on a buy — see the block comment
 * inside for the "why we don't reject SL >= price" reasoning.
 */
export function placeOrder(
  portfolioId: number,
  input: {
    symbol: string;
    side: Side;
    shares: number;
    price: number;
    note?: string;
    stopLoss?: number | null;
    takeProfit?: number | null;
  },
): Trade {
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
  // See the pre-v15 revision of this file for the full rationale on
  // why "SL >= price" and "TP <= price" are *not* rejected here.
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
      .prepare("SELECT cash FROM paper_portfolio WHERE id = ?")
      .get(portfolioId) as { cash: number } | undefined;
    if (!port) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }
    const pos = db
      .prepare(
        "SELECT shares, avg_cost, stop_loss, take_profit FROM paper_positions " +
          "WHERE portfolio_id = ? AND symbol = ?",
      )
      .get(portfolioId, symbol) as
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
        "INSERT INTO paper_positions (portfolio_id, symbol, shares, avg_cost, stop_loss, take_profit, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(portfolio_id, symbol) DO UPDATE SET " +
          "shares = excluded.shares, avg_cost = excluded.avg_cost, " +
          "stop_loss = excluded.stop_loss, take_profit = excluded.take_profit, " +
          "updated_at = excluded.updated_at",
      ).run(
        portfolioId,
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
        db.prepare(
          "DELETE FROM paper_positions WHERE portfolio_id = ? AND symbol = ?",
        ).run(portfolioId, symbol);
      } else {
        db.prepare(
          "UPDATE paper_positions SET shares = ?, updated_at = ? " +
            "WHERE portfolio_id = ? AND symbol = ?",
        ).run(newShares, new Date().toISOString(), portfolioId, symbol);
      }
    }

    const now = new Date().toISOString();
    db.prepare(
      "UPDATE paper_portfolio SET cash = ?, updated_at = ? WHERE id = ?",
    ).run(newCash, now, portfolioId);

    const info = db
      .prepare(
        "INSERT INTO paper_trades (portfolio_id, symbol, side, shares, price, commission, cash_after, note, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        portfolioId,
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
      portfolioId,
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
export function setPositionTargets(
  portfolioId: number,
  input: {
    symbol: string;
    stopLoss: number | null;
    takeProfit: number | null;
  },
): Position {
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
      "UPDATE paper_positions SET stop_loss = ?, take_profit = ?, updated_at = ? " +
        "WHERE portfolio_id = ? AND symbol = ?",
    )
    .run(input.stopLoss, input.takeProfit, now, portfolioId, symbol);
  if (info.changes === 0) {
    throw new Error(`No open position for ${symbol}`);
  }
  const row = db
    .prepare(
      "SELECT symbol, shares, avg_cost, stop_loss, take_profit, updated_at " +
        "FROM paper_positions WHERE portfolio_id = ? AND symbol = ?",
    )
    .get(portfolioId, symbol) as {
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

// ---------------------------------------------------------------------------
// SL / TP evaluation
// ---------------------------------------------------------------------------

export type TriggerReason = "stop-loss" | "take-profit";

export interface TriggerEvent {
  symbol: string;
  reason: TriggerReason;
  level: number;
  price: number;
  trade: Trade;
}

/**
 * Walk every open position in `portfolioId` and auto-execute a full sell
 * at the supplied live price when the stop-loss / take-profit level has
 * been breached. Take-profit is checked before stop-loss so a gap-up-
 * then-fill bar that straddles both levels records the friendlier
 * outcome (see the pre-v15 comment for the full reasoning).
 */
export function evaluateTargets(
  portfolioId: number,
  prices: Record<string, number | null>,
): TriggerEvent[] {
  const port = getPortfolio(portfolioId);
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
      const trade = placeOrder(portfolioId, {
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
      // *persistent* failure (a bug in placeOrder itself, not just a
      // benign race) doesn't hide in silence.
      console.warn(
        `[paper:${portfolioId}] evaluateTargets: ${p.symbol} ${reason} guard failed to fire @ $${price.toFixed(2)} — will retry next tick.`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Reset / valuation
// ---------------------------------------------------------------------------

/** Wipe positions + trades for one portfolio and reset its cash. */
export function resetPortfolio(portfolioId: number, startingCash?: number): void {
  const now = new Date().toISOString();
  const cash = startingCash ?? settings.paper.startingCash;
  const db = getDb();
  db.transaction(() => {
    const info = db
      .prepare(
        "UPDATE paper_portfolio SET cash = ?, starting_cash = ?, updated_at = ? WHERE id = ?",
      )
      .run(cash, cash, now, portfolioId);
    if (info.changes === 0) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }
    db.prepare("DELETE FROM paper_positions WHERE portfolio_id = ?").run(portfolioId);
    db.prepare("DELETE FROM paper_trades WHERE portfolio_id = ?").run(portfolioId);
  })();
}

/**
 * Snapshot with live prices supplied by the caller (usually the last close
 * fetched by the UI). Returns the market value / unrealised P&L for each
 * position plus the portfolio total.
 */
export interface Valuation {
  portfolioId: number;
  name: string;
  cash: number;
  startingCash: number;
  positions: Array<Position & { last: number | null; marketValue: number | null; unrealised: number | null }>;
  marketValue: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
}

export function valuePortfolio(
  portfolioId: number,
  prices: Record<string, number | null>,
): Valuation {
  const port = getPortfolio(portfolioId);
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
    portfolioId: port.id,
    name: port.name,
    cash: port.cash,
    startingCash: port.startingCash,
    positions,
    marketValue,
    totalValue,
    totalPnl,
    totalPnlPct,
  };
}
