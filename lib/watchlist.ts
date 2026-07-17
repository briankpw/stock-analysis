/**
 * Watchlist — the sidebar ticker picker reads from and writes to this
 * table. Symbols are stored uppercased. The default entry is inserted at
 * DB init time (see `lib/db.ts`) so the picker always has at least one
 * option.
 */

import { getDb } from "./db";

export interface WatchlistEntry {
  symbol: string;
  displayName: string;
  createdAt: string;
}

export function listWatchlist(): WatchlistEntry[] {
  const rows = getDb()
    .prepare("SELECT symbol, display_name, created_at FROM watchlist ORDER BY symbol")
    .all() as Array<{ symbol: string; display_name: string | null; created_at: string }>;
  return rows.map((r) => ({
    symbol: r.symbol,
    displayName: r.display_name || r.symbol,
    createdAt: r.created_at,
  }));
}

export function addWatchlist(symbol: string, displayName?: string): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error("Symbol required");
  const stmt = getDb().prepare(
    "INSERT OR REPLACE INTO watchlist (symbol, display_name, created_at) VALUES (?, ?, ?)",
  );
  stmt.run(sym, displayName?.trim() || null, new Date().toISOString());
}

export function removeWatchlist(symbol: string): void {
  const sym = symbol.trim().toUpperCase();
  const db = getDb();
  const remaining = db.prepare("SELECT COUNT(*) as n FROM watchlist").get() as { n: number };
  if (remaining.n <= 1) {
    throw new Error("Cannot remove the last watchlist entry");
  }
  // Cascade into the two per-ticker watch tables so we don't leave the
  // engine polling a symbol the user just removed. News history and the
  // deep notification tables are preserved so the user can still see the
  // trail of past alerts.
  db.transaction(() => {
    db.prepare("DELETE FROM stock_watches WHERE ticker = ?").run(sym);
    db.prepare("DELETE FROM news_subscriptions WHERE ticker = ?").run(sym);
    db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(sym);
  })();
}

export function formatOption(entry: WatchlistEntry): string {
  if (entry.displayName && entry.displayName !== entry.symbol) {
    return `${entry.symbol} — ${entry.displayName}`;
  }
  return entry.symbol;
}
