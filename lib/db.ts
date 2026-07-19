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
  // v3: per-position stop-loss / take-profit targets on paper positions.
  // Both nullable — an unset target means the guard is off. Evaluation
  // happens on every paper-trading GET (see paper-trading.ts). SQLite
  // ALTER TABLE only supports single-column adds, and we can't easily
  // detect a partially-migrated schema, so guard each add with a
  // pragma_table_info() check that no-ops when the column exists.
  (db) => {
    const cols = db
      .prepare("PRAGMA table_info(paper_positions)")
      .all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("stop_loss")) {
      db.exec("ALTER TABLE paper_positions ADD COLUMN stop_loss REAL");
    }
    if (!names.has("take_profit")) {
      db.exec("ALTER TABLE paper_positions ADD COLUMN take_profit REAL");
    }
  },
  // v4: per-ticker technical-signal alert rules. Each row is a single
  // alert configuration keyed by ticker (only one rule per symbol);
  // the worker's `runTechnicalTick()` reads them on every loop.
  //
  //   * `daily_time` — HH:MM (24-hour) in `timezone`; null = no digest.
  //     The engine fires a "here's today's verdict" push once per local
  //     day when the current time has passed this instant.
  //   * `notify_on_change` — boolean; when true the engine ALSO fires
  //     whenever the verdict band crosses (e.g. hold → buy), subject to
  //     `min_strength`.
  //   * `min_strength` — 'all' | 'buy_sell' | 'strong_only'; gates the
  //     change alerts so a user who only wants Strong Buy / Strong Sell
  //     isn't buried under HOLD ↔ BUY chatter.
  //   * `last_digest_local_date` — YYYY-MM-DD (in `timezone`) of the
  //     last digest fired, so we never send two digests in the same
  //     local day even when the worker's tick cadence is much shorter.
  //   * `last_verdict` / `last_score` — snapshot from the previous
  //     evaluation, used to detect band crossings for the on-change
  //     path.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS technical_alerts (
        ticker TEXT PRIMARY KEY,
        daily_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        notify_on_change INTEGER NOT NULL DEFAULT 1,
        min_strength TEXT NOT NULL DEFAULT 'buy_sell',
        last_verdict TEXT,
        last_score REAL,
        last_digest_local_date TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_technical_alerts_created
        ON technical_alerts(created_at DESC);
    `);
  },
  // v5: per-ticker 6-Signal Resonance alerts. Parallel to
  // `technical_alerts` — a user might want a daily digest on the
  // Technical Signal but only *event-driven* pings on the Resonance
  // (fresh buy/sell trigger). Keeping the tables separate rather than
  // reusing `technical_alerts` avoids overloading the `last_verdict`
  // column with two different verdict enums, and lets the two engines
  // evolve their schemas independently.
  //
  //   * `daily_time` — HH:MM in `timezone`; null = no digest.
  //   * `notify_on_change` — when true, fires whenever the resonance
  //     verdict crosses (out → buy, holding → out, buy → sell, …).
  //     Gated by `min_strength`.
  //   * `min_strength` — 'all' | 'trigger_only' | 'strong_only':
  //       - 'all'          → every state change fires
  //       - 'trigger_only' → only fresh `buy` / `sell` triggers fire
  //         (default; skips the frequent holding ↔ out transitions)
  //       - 'strong_only'  → only fresh `buy` / `sell` AND at 6/6
  //         alignment (i.e. real resonance, not just early signal)
  //   * `last_verdict` — snapshot of `ResonanceVerdict` for change
  //     detection (`buy` | `holding` | `sell` | `avoid` | `out` |
  //     `warmup`).
  //   * `last_aligned_count` — snapshot of the bullish 0-6 alignment
  //     count for the digest's "was 4↑, now 6↑" delta.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS resonance_alerts (
        ticker TEXT PRIMARY KEY,
        daily_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        notify_on_change INTEGER NOT NULL DEFAULT 1,
        min_strength TEXT NOT NULL DEFAULT 'trigger_only',
        last_verdict TEXT,
        last_aligned_count INTEGER,
        last_bearish_count INTEGER,
        last_digest_local_date TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_resonance_alerts_created
        ON resonance_alerts(created_at DESC);
    `);
  },
  // v6: portfolio delisting / bankruptcy risk watches. The user's
  // holdings live only in the browser (see `lib/holdings-state.ts`),
  // so the server side maintains just a tiny list of symbols the
  // client has asked to monitor for immediate-action risks. The
  // client bulk-replaces this list whenever the imported CSV
  // changes; the worker walks the list every tick and pushes a
  // notification when a fresh CRITICAL/HIGH signal appears.
  //
  //   * `min_severity` — 'high' or 'critical'. Gates notifications so
  //     the "medium" bucket (single sub-$1 day, moderate drawdown)
  //     doesn't page the user unnecessarily.
  //   * `last_severity` / `last_fingerprint` — snapshot of the
  //     previous evaluation. A fingerprint change is what triggers a
  //     push; storing the severity too keeps the read side cheap for
  //     "how many tickers are risky right now" queries.
  //   * `last_signals_json` — JSON-encoded list of signal IDs from
  //     the most recent evaluation. Not used for decisions, but
  //     useful for /bot debugging + future "show me what changed"
  //     diffs.
  //   * `last_notified_at` — throttling: no more than one push per
  //     ticker per hour even if the fingerprint keeps flipping (rare
  //     but possible when news headlines get pulled/reposted).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_risk_watches (
        ticker TEXT PRIMARY KEY,
        min_severity TEXT NOT NULL DEFAULT 'high',
        last_severity TEXT,
        last_fingerprint TEXT,
        last_signals_json TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_portfolio_risk_watches_created
        ON portfolio_risk_watches(created_at DESC);
    `);
  },
  // v7: server-side storage for the user's imported portfolio (CSV
  // holdings). Before this migration the same data lived only in the
  // browser's localStorage — meaning a user who uploaded on their
  // desktop couldn't see anything on their phone. Now the server is
  // the source of truth and every device pulls from `/api/holdings`,
  // giving us cross-device sync at the cost of one HTTP round-trip
  // on page load.
  //
  //   * `holdings.fingerprint` — deduplicated natural key computed by
  //     `fingerprintRow()` in `lib/portfolio-import.ts`. Using it as
  //     the PK means our server-side merge path is a straight
  //     `INSERT OR IGNORE` per row — the DB itself enforces "one row
  //     per unique trade" without any read-then-write dance.
  //   * `holdings.row_json` — the whole `HoldingRow` blob. Serialising
  //     as JSON keeps the schema forward-compatible with any future
  //     row-shape evolution in `lib/portfolio-import.ts`; we don't
  //     have to migrate this table again just because someone adds
  //     a new column to the CSV parser.
  //   * `holdings_meta` — one-row table (id CHECK 1, same pattern as
  //     `paper_portfolio`) holding the import metadata bar's fields.
  //     Kept separate from `bot_state` so `getState<>()` doesn't get
  //     polluted with a large user-controlled blob, and so wiping the
  //     portfolio is a clean DELETE from two tables without touching
  //     unrelated worker state.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS holdings (
        fingerprint TEXT PRIMARY KEY,
        row_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_holdings_created
        ON holdings(created_at DESC);

      CREATE TABLE IF NOT EXISTS holdings_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        source_filename TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        last_mode TEXT,
        last_added_count INTEGER,
        last_skipped_count INTEGER,
        updated_at TEXT NOT NULL
      );
    `);
  },
  // v8: per-ticker Master Verdict alert rules. Structurally identical
  // to `technical_alerts` (see v4) — same daily-digest + on-change
  // channels, same `AlertStrength` gate, same 5-band `Verdict` — but
  // driven off the *fused* master score instead of the pure technical
  // score. Two separate tables (rather than a `source` column on
  // `technical_alerts`) so users can independently enable/disable each
  // layer without overloading a single rule.
  //
  //   * `daily_time` / `timezone` — same semantics as v4.
  //   * `notify_on_change` / `min_strength` — same semantics as v4.
  //   * `last_verdict` — the previously-notified master band, used to
  //     detect crossings on the on-change path.
  //   * `last_score` — score at the last notification (for the "was
  //     +42, now -18" delta the notifier body includes).
  //   * `last_coverage` — snapshot of `MasterVerdict.coverage` so the
  //     digest can show "coverage rose from 60% to 85% overnight" when
  //     news/sentiment fills back in.
  //   * `last_digest_local_date` — YYYY-MM-DD in `timezone`; prevents
  //     duplicate digests on the same local day.
  //   * `last_notified_at` — ISO timestamp of the most recent send of
  //     either channel (useful for /bot debugging + throttling).
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS master_alerts (
        ticker TEXT PRIMARY KEY,
        daily_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        notify_on_change INTEGER NOT NULL DEFAULT 1,
        min_strength TEXT NOT NULL DEFAULT 'buy_sell',
        last_verdict TEXT,
        last_score REAL,
        last_coverage REAL,
        last_digest_local_date TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_master_alerts_created
        ON master_alerts(created_at DESC);
    `);
  },
  // v9: persistent snapshot cache for the Portfolios page.
  //
  // Historically every visit to /portfolios (politicians, funds,
  // insiders) triggered a live fetch against SEC EDGAR + the House
  // Clerk ZIP + individual PTR PDFs, kept warm only in a
  // process-local in-memory TTL cache. That worked while the tab
  // was hot, but every process restart (Docker redeploy, dev
  // reload, worker crash) meant the next user waited 5-30 seconds
  // for the pipeline to warm back up — bad UX for a page that most
  // people just want to eyeball.
  //
  // This table gives us a stale-while-revalidate layer that
  // survives restarts:
  //
  //   * The API route reads the row synchronously and returns the
  //     `payload_json` immediately. No user-visible fetch.
  //   * If `next_refresh_at <= now`, the coordinator ALSO kicks off
  //     a background refresh — but the response is already on its
  //     way to the client.
  //   * The bot worker's dedicated tick (see
  //     `lib/portfolios-cache/engine.ts`) walks rows where
  //     `next_refresh_at <= now` and refreshes them, so even a
  //     truly idle app keeps the snapshots warm.
  //
  //   * `payload_json` — the whole report blob. Storing as JSON
  //     keeps this migration one-shot regardless of how the report
  //     shapes evolve (PoliticianReport gained `parseStatus` /
  //     `filingsNoStockRows` recently; we don't want a schema
  //     migration every time).
  //   * `fetched_at` — last successful upstream fetch.
  //   * `next_refresh_at` — TTL horizon. Different kinds get
  //     different TTLs (see the coordinator) because politician
  //     data updates daily, 13Fs quarterly, insider filings a few
  //     times a week.
  //   * `last_error` / `last_error_at` — on refresh failure we
  //     KEEP the stale payload so the UI still renders, but we
  //     record why the last fetch failed and push
  //     `next_refresh_at` out by a short backoff. Setting these to
  //     NULL is the definition of "healthy row".
  //   * `visit_count` / `last_visited_at` — the bot worker only
  //     refreshes rows the user has actually opened; a row with
  //     `visit_count = 0` is defensive (a coordinator write path
  //     that fired without a preceding read) but the engine treats
  //     it as "worth keeping fresh anyway".
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        preset_kind      TEXT NOT NULL
          CHECK (preset_kind IN ('politician','person','fund')),
        preset_id        TEXT NOT NULL,
        payload_json     TEXT NOT NULL,
        fetched_at       TEXT NOT NULL,
        next_refresh_at  TEXT NOT NULL,
        last_error       TEXT,
        last_error_at    TEXT,
        visit_count      INTEGER NOT NULL DEFAULT 0,
        last_visited_at  TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (preset_kind, preset_id)
      );

      CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_refresh
        ON portfolio_snapshots(next_refresh_at);
      CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_kind_visit
        ON portfolio_snapshots(preset_kind, last_visited_at DESC);
    `);
  },
  // v10: per-market-segment 6-Signal Resonance alert rules.
  //
  // Structurally identical to `resonance_alerts` (v5) but keyed by
  // `segment_id` (e.g. `ai`, `semiconductors`) instead of `ticker`.
  // We could have overloaded `resonance_alerts` with a nullable
  // segment column, but that would:
  //   * conflate two conceptually distinct subscriptions in one row
  //     (a user might legitimately want both "AI sector" AND a
  //     straight `AIQ` alert with different strength gates), and
  //   * force every read of a per-ticker rule to remember to filter
  //     out segment rows — a foot-gun waiting to trip a future
  //     refactor.
  //
  // Everything else — daily digest, on-change gate, strength enum,
  // last-verdict bookkeeping — follows the ticker table exactly so
  // the two engines can be kept in lockstep. The alert content is
  // computed off the segment's proxy ETF (resolved via `findSegment`
  // in `lib/segments.ts`), so the resonance math is identical; only
  // the display name and cache key differ.
  //
  //   * `segment_id` — stable slug from `lib/segments.ts` (`ai`,
  //     `cybersecurity`, ...). Never mutated once a rule exists.
  //   * `min_strength` — same `all` | `trigger_only` | `strong_only`
  //     enum as the per-ticker table. Kept identical so the UI can
  //     share one strength-picker component.
  //   * `last_verdict` / `last_aligned_count` / `last_bearish_count`
  //     — snapshots for on-change detection, mirroring the ticker
  //     table.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sector_resonance_alerts (
        segment_id TEXT PRIMARY KEY,
        daily_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        notify_on_change INTEGER NOT NULL DEFAULT 1,
        min_strength TEXT NOT NULL DEFAULT 'trigger_only',
        last_verdict TEXT,
        last_aligned_count INTEGER,
        last_bearish_count INTEGER,
        last_digest_local_date TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sector_resonance_alerts_created
        ON sector_resonance_alerts(created_at DESC);
    `);
  },
  // v11: per-market-segment Technical Signal alert rules.
  //
  // Structural mirror of `technical_alerts` (v4) but keyed by
  // `segment_id` instead of `ticker`. Same "daily digest + on-change"
  // schema, same strength enum (`all` / `buy_sell` / `strong_only`),
  // same last-verdict bookkeeping. The engine resolves each
  // `segment_id` to its proxy ETF at tick time and evaluates the
  // technical scorer on that ETF's bars — so the compute path is
  // identical to the per-ticker one, only the notification headline
  // (segment name + proxy tag) differs.
  //
  // A separate table (rather than a nullable `segment_id` on
  // `technical_alerts`) is used for the same reasons as
  // `sector_resonance_alerts` (v10): a user may legitimately want
  // both "AI sector" AND a straight `AIQ` alert with different
  // strength gates, and every read of a per-ticker rule would
  // otherwise need to remember to filter segment rows.
  //
  //   * `segment_id` — stable slug from `lib/segments.ts` (`ai`,
  //     `cybersecurity`, ...). Never mutated once a rule exists.
  //   * `min_strength` — `all` | `buy_sell` | `strong_only` enum
  //     matches the per-ticker table so both tables can share one
  //     strength-picker component.
  //   * `last_verdict` / `last_score` — snapshots for on-change
  //     detection, mirroring the ticker table.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sector_technical_alerts (
        segment_id TEXT PRIMARY KEY,
        daily_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        notify_on_change INTEGER NOT NULL DEFAULT 1,
        min_strength TEXT NOT NULL DEFAULT 'buy_sell',
        last_verdict TEXT,
        last_score REAL,
        last_digest_local_date TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sector_technical_alerts_created
        ON sector_technical_alerts(created_at DESC);
    `);
  },
  // v12: cross-process tick lock table.
  //
  // Replaces the previous in-memory `Set<string>` in
  // `lib/bot/store.ts` which only prevented overlap WITHIN a single
  // Node process. In a real deployment the UI container and the
  // worker container are two distinct processes; both call the same
  // tick engines (worker on a schedule, UI via /api/*/test), and
  // both used to freely re-enter the same tick body. That in turn
  // meant two processes could:
  //   1. Both read `technical_alerts.last_verdict = 'hold'`.
  //   2. Both compute `verdict = 'buy'`.
  //   3. Both push a "verdict changed" notification.
  //   4. Both write `'buy'` back — one becomes a no-op UPDATE.
  //
  // A DB-backed lock closes that race because SQLite serialises
  // writes at the file lock level. `expires_at` provides a stale-
  // lock recovery path — if a process crashes mid-tick without
  // releasing, the next tick will see the expired lock and take it.
  //
  //   * `name` — tick identity ("technical", "resonance", …), same
  //     as the string passed to `tryLockTick` today.
  //   * `acquired_at` / `expires_at` — timestamps in ISO 8601. The
  //     lock is considered valid only when `expires_at > now`.
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_locks (
        name        TEXT PRIMARY KEY,
        acquired_at TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bot_locks_expires
        ON bot_locks(expires_at);
    `);
  },
  // v13: drop the legacy `signals` and `strategy_last_bar` tables.
  //
  // These were owned by the removed SMA/RSI/MACD strategy tick (see
  // the `lib/bot/store.ts` header comment). Every write and read
  // path was deleted in July 2026, so the tables just accumulated
  // orphaned rows on existing installations and confused new devs
  // reading `.schema` output. Safe to drop unconditionally — no
  // remaining code references them.
  (db) => {
    db.exec(`
      DROP INDEX IF EXISTS idx_signals_ticker_ts;
      DROP TABLE IF EXISTS signals;
      DROP TABLE IF EXISTS strategy_last_bar;
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
