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
  // Two processes (ui + worker) share this file. WAL mode makes readers
  // non-blocking, but write<->write collisions can still fire SQLITE_BUSY
  // when both containers boot simultaneously and race on schema creation.
  // A 5s wait is generous — every write path in the app finishes in <10ms.
  db.pragma("busy_timeout = 5000");

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

    -- Custom "portfolios" presets - Politicians / Fund managers / People
    -- that the user adds beyond the built-in list. payload_json stores
    -- the category-specific fields (party/chamber for politicians,
    -- firm/manager/cik for funds, name/role/cik for people) so we don't
    -- churn the schema when we add new preset types.
    CREATE TABLE IF NOT EXISTS portfolio_presets (
      id TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('politician','fund','person')),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (category, id)
    );

    CREATE INDEX IF NOT EXISTS idx_portfolio_presets_category
      ON portfolio_presets(category, created_at DESC);

    -- Portfolio-watch rules. Each row is one active alert rule.
    -- The 'kind' column picks the axis:
    --   'person' - every trade by (category, preset_id) tuple
    --   'ticker' - every trade of a symbol across all tracked presets
    -- actions_json is a JSON array like ["BUY","SELL"] filtering which
    -- SEC/House action codes should fire the notification.
    CREATE TABLE IF NOT EXISTS portfolio_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('person','ticker')),
      category TEXT CHECK (category IN ('people','politicians','funds')),
      preset_id TEXT,
      ticker TEXT,
      actions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (kind, category, preset_id, ticker)
    );

    CREATE INDEX IF NOT EXISTS idx_portfolio_watches_kind
      ON portfolio_watches(kind);

    -- Portfolio notifications: both dedup surface (event_id primary key
    -- means the poller never resends) AND a history log the /bot page
    -- can render. matched_watches_json records which rule(s) fired so
    -- the user can trace an alert back to the toggle they enabled.
    CREATE TABLE IF NOT EXISTS portfolio_notifications (
      event_id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      preset_name TEXT NOT NULL,
      ticker TEXT,
      company_name TEXT,
      action TEXT NOT NULL,
      action_label TEXT NOT NULL,
      trade_date TEXT,
      filing_date TEXT,
      amount_label TEXT,
      source_url TEXT,
      matched_watches_json TEXT NOT NULL,
      notified_at TEXT NOT NULL,
      telegram_ok INTEGER,
      telegram_detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pn_notified_at
      ON portfolio_notifications(notified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pn_ticker
      ON portfolio_notifications(ticker);
    CREATE INDEX IF NOT EXISTS idx_pn_preset
      ON portfolio_notifications(category, preset_id);

    -- Stock-level insider-transaction watches. Keyed by ticker (which is
    -- also the natural PK — we only ever have one watch per symbol). The
    -- CIK column is resolved lazily on first save; it stays null if
    -- SEC's company_tickers.json doesn't recognise the symbol, and the
    -- engine simply skips those on tick.
    CREATE TABLE IF NOT EXISTS stock_watches (
      ticker TEXT PRIMARY KEY,
      cik TEXT,
      actions_json TEXT NOT NULL DEFAULT '["BUY","SELL"]',
      created_at TEXT NOT NULL
    );

    -- Insider-transaction notifications history + dedup. event_id is
    -- deterministic across re-fetches so we never Telegram-push the same
    -- row twice.
    CREATE TABLE IF NOT EXISTS stock_notifications (
      event_id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      issuer_cik TEXT,
      issuer_name TEXT,
      reporter_name TEXT NOT NULL,
      reporter_cik TEXT,
      reporter_relation TEXT,
      action TEXT NOT NULL,
      action_label TEXT NOT NULL,
      shares REAL,
      price_per_share REAL,
      trade_date TEXT,
      filing_date TEXT,
      source_url TEXT,
      notified_at TEXT NOT NULL,
      telegram_ok INTEGER,
      telegram_detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_stock_notif_notified_at
      ON stock_notifications(notified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stock_notif_ticker
      ON stock_notifications(ticker);

    -- Per-ticker accumulated news headlines. The News API upserts here
    -- on every fetch (dedupped by ticker + link), so the on-page list
    -- grows over time instead of collapsing to whatever Yahoo returned
    -- in the last request.
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      link TEXT NOT NULL,
      title TEXT NOT NULL,
      publisher TEXT,
      summary TEXT,
      published_at TEXT NOT NULL,
      score REAL,
      label TEXT,
      impact TEXT,
      first_seen_at TEXT NOT NULL,
      UNIQUE (ticker, link)
    );

    CREATE INDEX IF NOT EXISTS idx_news_items_ticker_pub
      ON news_items(ticker, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_items_ticker_seen
      ON news_items(ticker, first_seen_at DESC);

    -- Per-ticker news subscriptions. On subscribe we silent-seed the
    -- current headlines into news_items so the first background tick
    -- doesn't Telegram-blast the initial batch.
    CREATE TABLE IF NOT EXISTS news_subscriptions (
      ticker TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    -- News notifications history + dedup. event_id is 'ticker:link',
    -- which matches the ticker+link uniqueness of news_items.
    CREATE TABLE IF NOT EXISTS news_notifications (
      event_id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      title TEXT NOT NULL,
      publisher TEXT,
      link TEXT NOT NULL,
      published_at TEXT NOT NULL,
      score REAL,
      label TEXT,
      notified_at TEXT NOT NULL,
      telegram_ok INTEGER,
      telegram_detail TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_news_notif_notified_at
      ON news_notifications(notified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_notif_ticker
      ON news_notifications(ticker);
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

  // ---- Schema versioning + forward-only migrations ---------------------
  // Every additive change to the schema goes into the `MIGRATIONS` array
  // as a new function. Existing databases will run only the migrations
  // whose index is >= their recorded `schema_version`; fresh databases
  // run every migration in order. This lets us evolve the schema without
  // manual ALTER-in-console cargo-culting.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const currentRow = db
    .prepare("SELECT version FROM schema_version WHERE id = 1")
    .get() as { version: number } | undefined;
  const currentVersion = currentRow?.version ?? 0;
  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migrate = MIGRATIONS[i]!;
    migrate(db);
  }
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO schema_version (id, version, updated_at) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at",
  ).run(MIGRATIONS.length, now);

  _db = db;
  return db;
}

/**
 * Additive migrations. Each entry runs at most once per database — the
 * `schema_version` row records how many have executed so far. When adding
 * a new migration, append to this array; never renumber or reorder.
 */
const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1: no-op sentinel so newly-created databases still record a version.
  () => {},
  // v2: web-push subscriptions. One row per (endpoint) — a browser +
  // installed PWA + device combination. p256dh / auth are the two
  // encryption params required by the Web Push API; user_agent + label
  // are display-only. last_used_at is refreshed every successful send
  // so the /bot page can show "quiet since …" for stale devices.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        label TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_push_subs_created
        ON push_subscriptions(created_at DESC);
    `);
  },
];

/** Testing / cleanup helper. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Run `fn` inside a single SQLite transaction. Useful for batching multiple
 * inserts (notifications, signals, watches) so WAL fsyncs happen once per
 * batch rather than per row. Rethrows on failure so callers can decide
 * whether to log / surface the error.
 *
 * The callback is synchronous — better-sqlite3 doesn't support async work
 * inside `db.transaction()`. Callers should stage all async work (fetches,
 * API calls) BEFORE opening the transaction.
 */
export function runInTransaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}
