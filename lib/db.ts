/**
 * Single SQLite database shared by the paper-trading portfolio, the bot's
 * state/history, and the watchlist. Uses `better-sqlite3` (synchronous, WAL
 * mode, single-process). The Python codebase used two files (paper_trading
 * JSON + bot.db); we consolidate into one file here because SQLite handles
 * concurrent readers/writers just fine within a single process.
 */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { settings } from "./config";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = settings.bot.dbPath;
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  // ---- Schema (idempotent) ----------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      strategy TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL,
      reason TEXT NOT NULL,
      bar_ts TEXT,
      created_at TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_signals_ticker_ts ON signals(ticker, created_at DESC);

    CREATE TABLE IF NOT EXISTS strategy_last_bar (
      ticker TEXT NOT NULL,
      strategy TEXT NOT NULL,
      bar_ts TEXT NOT NULL,
      PRIMARY KEY (ticker, strategy)
    );

    CREATE TABLE IF NOT EXISTS paper_portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cash REAL NOT NULL,
      starting_cash REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      symbol TEXT PRIMARY KEY,
      shares REAL NOT NULL,
      avg_cost REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      commission REAL NOT NULL,
      cash_after REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol_ts ON paper_trades(symbol, created_at DESC);

    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY,
      display_name TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Seed the singleton portfolio row on first boot.
  const existing = db.prepare("SELECT id FROM paper_portfolio WHERE id = 1").get();
  if (!existing) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO paper_portfolio (id, cash, starting_cash, created_at, updated_at) VALUES (1, ?, ?, ?, ?)",
    ).run(settings.paper.startingCash, settings.paper.startingCash, now, now);
  }

  // Seed default watchlist with the configured ticker.
  db.prepare(
    "INSERT OR IGNORE INTO watchlist (symbol, display_name, created_at) VALUES (?, ?, ?)",
  ).run(settings.ticker, settings.companyName, new Date().toISOString());

  _db = db;
  return db;
}

/** Testing / cleanup helper. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
