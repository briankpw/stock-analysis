# Key Stock — Keysight Analysis Dashboard (Node.js rewrite)

A single-page stock analysis dashboard for **Keysight Technologies (KEYS)** — but any US ticker works. Rewritten in Node.js / Next.js 15 to replace an earlier Streamlit version, primarily to escape three families of bugs (pyarrow segfaults on Python 3.13, curl_cffi thread-crashes, Streamlit widget-state churn).

Feature parity with the Python app:

- **Overview** — verdict card with 0-100 score, latest signals (Trend/RSI/MACD/Bollinger), positive/negative findings breakdown.
- **Ratios** — six metric groups (Price & Volume, Valuation, Profitability, Financial Health, Growth, Dividend) with beginner-mode tooltips.
- **Price & Volume** — candlestick + volume chart with SMA (20/50/200) and Bollinger overlays via TradingView `lightweight-charts`.
- **Technical Indicators** — RSI(14), MACD(12/26/9), daily-returns histogram.
- **News** — Yahoo Finance headlines, scored with a finance-tuned VADER lexicon (~120 finance-specific terms) blended with the standard VADER model. Bullish / bearish / neutral badges, time-weighted overall verdict, filter tabs.
- **Paper Trading** — simulated brokerage with SQLite persistence, weighted-average cost basis, order log.
- **Alert Bot** — SMA-crossover, RSI-reversion, and MACD-cross strategies evaluated on a background worker; deduplicates alerts per bar, can send Telegram messages via `sendMessage`.
- **PWA + mobile-responsive** — installable on iOS/Android, dark/light theme toggle, Beginner/Advanced experience toggle.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + custom design tokens for dark/light theme
- **Radix UI** primitives (`@radix-ui/react-tabs`, `-tooltip`, `-slot`)
- **`yahoo-finance2`** for market data (rate-limit aware, in-memory TTL cache)
- **`vader-sentiment`** for the news sentiment baseline, blended with our own finance lexicon
- **`better-sqlite3`** for the paper-trading and bot state
- **`lightweight-charts`** (~230 kB) for candlestick + volume + indicator charts
- **`tsx`** to run the TypeScript worker without a compile step
- **`zustand`** for client state (persisted to localStorage)

## Quick start (development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in the ticker + Telegram credentials (optional)
cp .env.example .env.local

# 3. Run UI + bot worker together (Ctrl-C to stop)
npm run dev:all

# open http://localhost:5001/overview
```

Or one-shot: `./start.command` — installs, builds if needed, kills port squatters, and opens the browser.

## Individual scripts

| Command | Description |
| --- | --- |
| `npm run dev` | UI in dev mode (hot reload, Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build on `:5001` (5000 is the default macOS AirPlay port) |
| `npm run worker` | Bot worker only (uses `tsx` under the hood) |
| `npm run dev:all` | UI + worker together |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `next lint` |

## Configuration

All configuration lives in environment variables (see `.env.example`):

| Var | Default | Purpose |
| --- | --- | --- |
| `STOCK_TICKER` | `KEYS` | Default ticker shown on first load |
| `COMPANY_NAME` | `Keysight Technologies` | Display label for the default ticker |
| `DEFAULT_PERIOD` | `1y` | Default history window |
| `DEFAULT_INTERVAL` | `1d` | Default bar interval |
| `CACHE_TTL_SECONDS` | `900` | Yahoo Finance response cache TTL (see [Data freshness](#data-freshness--live-vs-cached)) |
| `PORTFOLIO_CACHE_TTL_SECONDS` | `21600` | In-memory portfolios/PTR cache TTL (6 h; persistent SWR TTLs are separate — see the freshness section) |
| `SEC_USER_AGENT` | *(empty)* | Required in production. Real contact string (e.g. `"Your Name your.email@yourdomain.com"`); SEC blocks requests without one |
| `PAPER_STARTING_CASH` | `100000` | Starting cash for the paper account |
| `PAPER_COMMISSION` | `0` | Per-trade commission |
| `BOT_LOOKBACK_PERIOD` | `1y` | Bar window the bot fetches on every tick |
| `BOT_LOOKBACK_INTERVAL` | `1d` | Bar interval for the bot |
| `BOT_POLL_INTERVAL_SECONDS` | `900` | Seconds between worker ticks (minimum enforced: 60) |
| `BOT_NOTIFY_MAX_AGE_DAYS` | `2` | Rolling age floor for news / trade / insider alerts — older events are skipped |
| `BOT_DB_PATH` | `./data/bot.db` | SQLite file (auto-created) |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | @BotFather token; blank disables alerts |
| `TELEGRAM_CHAT_ID` | *(empty)* | Chat id from @userinfobot |

## Docker deploy (Portainer-friendly)

```bash
# Build + run both containers (UI on :5001, worker in the background)
docker compose up -d --build

# Tail logs
docker compose logs -f ui
docker compose logs -f worker

# Stop
docker compose down
```

In Portainer:
1. Add a new stack, paste `docker-compose.yml`.
2. In "Environment variables" set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (optional) and any overrides.
3. Deploy. The SQLite volume `key-stock-data` persists across restarts.

## Telegram alerts (optional)

1. Message `@BotFather` on Telegram → `/newbot` → follow the wizard to get a **bot token**.
2. Message `@userinfobot` → copy your **chat id**.
3. Put both into `.env.local` (dev) or the Compose environment (Docker).
4. On the **Alert Bot** page, click **Send test alert**. If it lands in your Telegram, you're wired up.
5. Enable the strategies you want. The worker will fire alerts on the first bar where a signal crosses (deduped per `ticker` × `strategy` × `bar_ts`).

## Design notes

### Why not sharp/canvas for icons?

The PWA icons in `public/icons/` are generated by `scripts/gen-icons.mjs`, a ~150-line pure-Node PNG writer. No native dependency needed — this keeps the Docker build minimal.

### Yahoo Finance rate limits

Yahoo throttles high-frequency callers with 429s and blank payloads. Mitigations:

1. **In-memory TTL cache** (`CACHE_TTL_SECONDS`, default 15 min) so repeated same-ticker requests hit the cache.
2. **Exponential backoff** on transient failures (4 attempts, 1.5s base, jittered).
3. **`RateLimitedError`** propagated up so the UI can render a targeted warning banner instead of a red error screen.

There is no `curl_cffi` equivalent for Node.js — Yahoo can still block us if we get greedy. If you hit persistent 429s, lengthen `CACHE_TTL_SECONDS` and increase `BOT_POLL_INTERVAL_SECONDS`.

### Data freshness — live vs cached

Not every module fetches on every request. Data flows fall into three tiers so external APIs (Yahoo, SEC EDGAR, CNN) aren't hammered while the UI still feels fresh.

#### Summary matrix

| Module / data | Source | Freshness | Storage |
| --- | --- | --- | --- |
| Price charts, indicators, technical signal, resonance, bundle | Yahoo Finance | **15 min** TTL cache | In-memory `Map` |
| Live quotes (My Portfolio, segments) | Yahoo Finance | 15 min TTL + HTTP `s-maxage=30s` | In-memory + edge cache |
| Company info, holders | Yahoo Finance | 15 min TTL | In-memory |
| News headlines | Yahoo Finance + local | 15 min TTL for fetch; permanent in DB | In-memory + SQLite `news_items` |
| Fear & Greed Index | CNN DataViz | **30 min** TTL | In-memory |
| Politician trades (STOCK Act) | House Clerk + PTR PDFs | Cached, **6 h** refresh | SQLite `portfolio_snapshots` (SWR) |
| Person insider filings (Form 3/4/5) | SEC EDGAR | Cached, **2 h** refresh | SQLite `portfolio_snapshots` (SWR) |
| Fund 13F holdings | SEC EDGAR | Cached, **24 h** refresh | SQLite `portfolio_snapshots` (SWR) |
| Market segments / heatmap | Yahoo Finance (per-member) | Piggybacks on the 15-min quote/history cache | In-memory |
| Watchlist, holdings CSV, paper trading | Local only | Live from DB | SQLite (source of truth) |
| All alert configurations & notification history | Local only | Live from DB | SQLite (source of truth) |
| Push / Telegram delivery | Bot worker | Every 15-min tick | SQLite state + external send |
| UI state (ticker, locale, sidebar, tabs) | Local only | Live | zustand + `localStorage` |

#### Tier A — Live / real-time on every request

These call an external API on the request path, gated only by a short in-process TTL to avoid hammering the provider.

- **Yahoo Finance** — `lib/data.ts` sets up a 500-entry LRU with `defaultTtlMs = CACHE_TTL_SECONDS * 1000` (**default 900 s = 15 min**). Consumed by `fetchHistory`, `fetchQuote`, `fetchInfo`, `fetchNews`, `fetchBundle`, `fetchHolders`. Backing routes: `/api/bundle`, `/api/quotes`, `/api/news`, `/api/holders`, `/api/segments`, `/api/segments/[id]`, `/api/paper`, `/api/paper/recommend`, `/api/technical-alerts/test`, `/api/resonance-alerts/test`, `/api/portfolio/risks`.
- **CNN Fear & Greed** — `lib/fear-greed.ts`: 30-min module-scoped cache. CNN publishes once per US business day, so this is conservative.
- **`/api/quotes`** additionally sends `Cache-Control: public, max-age=30, s-maxage=30` so refresh bursts on the Positions page get soaked by the edge instead of thrown at Yahoo.
- **Retry / rate-limit**: Yahoo calls run through a 4-attempt exponential-backoff wrapper with a 15 s per-call deadline; permanent errors (invalid ticker, 404) short-circuit. Rate-limits surface as a typed `RateLimitedError`.

#### Tier B — Cached with stale-while-revalidate

Data that's expensive to fetch and slow-changing gets a **persistent SQLite snapshot** that survives process restarts. The route serves the snapshot instantly and kicks off a background refresh when expired.

- **Portfolios (people / politicians / funds)** — `lib/portfolios-cache/coordinator.ts`:
  ```
  politician: 6 h   — House Clerk feed updates ~daily
  person:     2 h   — SEC 4-hour filing latency
  fund:      24 h   — 13Fs are quarterly
  ```
  `/api/portfolios` calls `getCachedPolitician / getCachedPerson / getCachedFund`, which read `portfolio_snapshots` synchronously and only touch the network when either (a) the row doesn't exist yet, or (b) the row is expired *and* nothing else is refreshing it (in-flight dedup). On refresh failure the stale payload is kept and `last_error` recorded; next refresh is pushed out 15 min so a hard-down upstream can't be pounded. The bot worker also walks expired rows on its 15-min tick, so idle apps stay warm.
- **Portfolios directory + PTR text** — 6 h in-memory TTL cache on top (`lib/portfolios.ts`, env `PORTFOLIO_CACHE_TTL_SECONDS=21600`), plus a 10-min *failure* cache so we don't retry broken PTR URLs on every page load.
- **Ticker → CIK map** (for stock-watch insider monitoring) — 24 h in-memory cache in `lib/stock-watch/ticker-cik.ts`.
- **News items** — the Yahoo fetch is 15-min TTL, but every result is upserted into SQLite `news_items` (dedup by `ticker + link`). Reading `/api/news` returns the accumulated history — old headlines stay visible after Yahoo drops them.

#### Tier C — Local-only (SQLite is source of truth, no external fetch)

Read/written synchronously in the route handler with **zero network calls**.

- **Config / state**: `bot_state`, `watchlist`, `holdings` / `holdings_meta`, `paper_portfolio` / `paper_positions` / `paper_trades`, `portfolio_presets`.
- **Alert configurations** (every user-facing "enable notification" toggle): `technical_alerts`, `resonance_alerts`, `master_alerts`, `portfolio_watches`, `stock_watches`, `news_subscriptions`, `portfolio_risk_watches`, `push_subscriptions`.
- **Notification history / dedup**: `portfolio_notifications`, `stock_notifications`, `news_notifications`.

#### Client-side caching

- **Zustand + `persist` (localStorage)**, survives reloads:
  - `key-stock-ui` — current ticker, locale, sidebar collapsed state, active tabs
  - `key-stock-holdings-prefs` — My Portfolio table settings
  - `key-stock-portfolio-risk-prefs` — risk-notification enabled toggle + min-severity
  - `portfolios:v1` — recently-viewed people/politicians/funds
- **Module-scoped in-memory caches inside hooks** — one shared cache per hook module, fanned out to all React subscribers so multiple components hitting the same endpoint dedupe to a single request. Used by `use-technical-alerts`, `use-resonance-alerts`, `use-master-alerts`, `use-portfolio-watches`, `use-stock-watches`, `use-news-subscriptions`, `use-push-notifications`, `use-holdings`, `use-watchlist`.

#### Bot worker's role

Separate from HTTP requests: `worker.ts` runs `runForever()` every `BOT_POLL_INTERVAL_SECONDS` (**default 900 s = 15 min**). Each tick refreshes expired `portfolio_snapshots` rows the user has actually opened, then walks each alert channel's watch table, computes signals, and sends new notifications via Telegram + Web-Push. External fetches inside the tick still hit the same 15-min / 30-min / 2–24 h freshness windows above — the worker doesn't bypass any cache.

#### Practical takeaways

- If you see a stale price, hit **Refresh data** — `invalidateCache(ticker)` in `lib/data.ts` wipes just that ticker.
- Portfolios show a "cached, fetched X min ago" line because the SWR layer surfaces `meta.fetchedAt` on every response.
- Setting `CACHE_TTL_SECONDS=0` disables the Yahoo cache entirely (useful for demos, painful for rate limits).
- `PORTFOLIO_CACHE_TTL_SECONDS` controls the in-memory portfolios cache; the persistent SWR TTLs (6 h / 2 h / 24 h) are hardcoded because they're tied to how often each upstream actually updates.
- `SEC_USER_AGENT` must be set to a real contact string in production — SEC will block requests otherwise.

### Finance-tuned sentiment

The stock `vader-sentiment` npm package doesn't expose a mutable lexicon (unlike the Python one), so we compute two scores in parallel: the default VADER compound score, and a lexicon score using our ~120-entry finance dictionary (`beat`, `plunge`, `downgrade`, `bullish`, …). When any finance terms match we blend 60% finance / 40% VADER; otherwise VADER carries. Empirically this classifies headlines identically to the Python overlay in every one of our test cases.

## License

Not for redistribution — internal project. Yahoo Finance data is subject to Yahoo's terms of service.
