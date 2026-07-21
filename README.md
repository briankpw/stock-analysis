# Key Stock — Keysight Analysis Dashboard (Node.js rewrite)

A single-page stock analysis dashboard for **Keysight Technologies (KEYS)** — but any US ticker works. Rewritten in Node.js / Next.js 15 to replace an earlier Streamlit version, primarily to escape three families of bugs (pyarrow segfaults on Python 3.13, curl_cffi thread-crashes, Streamlit widget-state churn).

Feature parity with the Python app:

- **Overview** — verdict card with 0-100 score, latest signals (Trend/RSI/MACD/Bollinger), positive/negative findings breakdown.
- **Ratios** — six metric groups (Price & Volume, Valuation, Profitability, Financial Health, Growth, Dividend) with beginner-mode tooltips.
- **Price & Volume** — candlestick + volume chart with SMA (20/50/200) and Bollinger overlays via TradingView `lightweight-charts`.
- **Technical Indicators** — RSI(14), MACD(12/26/9), daily-returns histogram.
- **News** — Yahoo Finance headlines, scored with a finance-tuned VADER lexicon (~120 finance-specific terms) blended with the standard VADER model. Bullish / bearish / neutral badges, time-weighted overall verdict, filter tabs.
- **Paper Trading** — simulated brokerage with SQLite persistence, weighted-average cost basis, FIFO lot attribution for realised P&L, bracket orders (SL/TP), and multi-portfolio support.
- **Backtest** — replay any strategy against historical bars: 3 composite strategies (Technical / Resonance / Master Verdict) + 7 single-indicator strategies (SMA-X, EMA-X, MACD-X, RSI-Rev, KDJ-X, BB-Rev, S/R). Optional stop-loss / take-profit overlay with a data-driven "Smart pick" mode. Rolling history of the last 100 runs. Save any run as a paper portfolio in one click. See [Backtest engine](#backtest-engine).
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

### Backtest engine

The `/backtest` page (`app/backtest/page.tsx`) is a full-page surface that replays any signal strategy against historical bars from Yahoo Finance and shows how it would have traded a starting cash pile — including how it compares to a passive **buy-and-hold** of the same ticker over the same window. Under the hood everything runs through a single deterministic engine (`lib/signal-backtest.ts::runBacktest`) that emits an equity curve, a chronological trade log, and a metrics summary; the API route (`app/api/signal/backtest`) is a thin wrapper that fetches history + serialises the result.

#### Why it exists

The Overview page tells you what the signal says **today**. The backtest tells you what that same signal *would have said, and traded on,* over the last N years — the honest antidote to "the score is +72 so I should buy". A signal that scores +72 today but chopped through 40 whipsaws over the last two years and finished flat vs. buy-and-hold is very different from one that traded 6 times cleanly and beat the benchmark.

#### Strategies

Ten strategies grouped into three families. Every strategy runs bar-by-bar (`bars.slice(0, i + 1)` — no look-ahead, verified by unit test) and emits a per-bar intent of `bull` / `bear` / `neutral`. The engine goes long on `bull` when flat, exits on `bear` when long, and ignores `neutral`.

| Group | Strategy | Warm-up (bars) | One-liner |
| --- | --- | --- | --- |
| Composite | `technical` | 200 | Weighted vote across 9 checks — the app's default "buy/sell" verdict. |
| Composite | `resonance` | 40 | 6 fast momentum checks aligned at once (moomoo-style: MACD, KDJ, RSI, LWR, BBI, MTM). |
| Composite | `master` | 200 | Master Verdict — fuses Technical + Resonance (fundamentals/news aren't recorded historically). |
| Trend-following | `sma_cross` | 200 | Long while SMA50 > SMA200 ("Golden Cross"). Textbook trend follower. |
| Trend-following | `ema_cross` | 60 | Long while EMA20 > EMA50 — reacts faster than SMA cross, more whipsaws. |
| Trend-following | `macd_cross` | 34 | Long while the MACD(12,26,9) line is above the signal line. |
| Mean-reversion | `rsi_reversion` | 20 | Buy when RSI(14) ≤ 30 (oversold), sell when RSI(14) ≥ 70 (overbought). |
| Mean-reversion | `kdj_cross` | 20 | Long while K is above D (KDJ golden/death cross). Very whippy on trending stocks. |
| Mean-reversion | `bbands_reversion` | 25 | Buy at/below the lower Bollinger band, sell at/above the upper band. |
| Mean-reversion | `sr_bounce` | 60 | Buy when price bounces off nearest support, sell when rejected at nearest resistance. |

Warm-ups are enforced by `minBarsFor(strategy)`. Bars before the warm-up threshold produce no signal (equity stays at starting cash) so a fresh listing with 30 bars won't emit noise from a partially-defined indicator. Each single-indicator strategy carries a **known-weakness** advisory bullet that only shows in Beginner mode (e.g. *"RSI-Rev is fatal in strong trends — RSI can pin above 70 for weeks in a runaway bull"*).

#### Execution timing

Two modes control **when** a signal's fill happens relative to the bar that emitted it:

- **`nextOpen`** *(default, realistic)* — signal on close of bar `i` fills at open of bar `i+1`. Matches "I saw the close, I place a market order overnight". The last bar's signal, if bullish and flat, is flagged as `hasUnfilledFinalSignal: true` so the UI can render *"Would BUY tomorrow at the open"*.
- **`sameClose`** *(simplistic)* — signal on close of bar `i` fills at close of bar `i`. Useful for stress-testing "what if we could time the close perfectly?" scenarios; a Beginner-mode bullet warns that this timing is optimistic.

Buy-and-hold uses the **same fill convention** as the strategy so the comparison is apples-to-apples.

#### Position sizing

| Kind | Behaviour |
| --- | --- |
| `all_in` *(default)* | Buy as many whole shares as available cash allows. |
| `fixed_shares` | Buy exactly N shares each entry, clamped to what's affordable. |
| `percent_equity` | Spend `pct × equity` (equity = cash + open shares × fill price), whole shares only. |

Whole-share rounding matches how a normal broker fills a "spend $X" order — fractional shares would flatter the metrics vs. reality. The engine never leverages: sells always close 100% of the open position.

#### Stop-loss / take-profit overlay

Optional per-run overlay. Off by default so the raw "does the signal work?" story stays untouched. When enabled:

| Mode | What it does |
| --- | --- |
| `off` | No protective exits; only signal flips close a position. |
| `fixed_pct` | Every entry gets the same SL/TP percentage attached (either or both can be blank). |
| `smart` | Per-entry levels derived from `lib/target-recommender.ts` using ATR(14), trend regime, and nearest support/resistance — the same recommender the paper-trading **Smart pick** button uses live. |

**Per-bar order of operations** inside the loop:

1. **Protective exit check** first (on bars *after* the entry bar so the entry price can't spuriously trigger a same-bar exit).
2. **Gap-aware fill**: gap-down open at/below SL fills at **open** (worse than the stop — realistic); gap-up open at/above TP fills at **open** (better than the target); otherwise fill at the SL/TP level itself.
3. **Same-bar SL-and-TP tiebreaker**: if a wide-range outside bar's OHLC includes both levels, the **stop wins**. Real intra-bar order can't be inferred from OHLC alone, so pretending TP fired first would systematically inflate returns.
4. **Signal evaluated after** the exit check — a stop can't be "saved" by a bullish flip on the same bar.

The results panel surfaces an **exit-mix widget** whenever the overlay was on: three chips showing what share of exits were signal-driven, stop-loss, or take-profit. SL/TP sells also get a coloured `SL` / `TP` badge in the trade log.

#### Look-ahead safety

The engine re-enriches on `bars.slice(0, i + 1)` at every bar (not on the full series once) so no indicator ever sees a future bar. This is verified by a unit test that runs the engine on `bars` and again on `bars.slice(0, checkpoint)` and asserts every equity/cash/position point up to `checkpoint - 1` matches to 6 decimal places.

Cost: O(n²) in bar count. Acceptable for the app's biggest window (`max` period = ~30 years of daily bars = ~7500 bars → 30 M enrichment ops, ~2–5 s). Big enough to notice, small enough that we don't need a memoisation layer.

#### Metrics

Every run reports:

| Metric | Meaning |
| --- | --- |
| `totalReturn` | Strategy end-of-window return (fraction of starting cash). |
| `buyHoldReturn` | Passive benchmark over the same window. |
| `cagr` / `buyHoldCagr` | Annualised return. `null` if window < 30 days. |
| `maxDrawdown` / `buyHoldMaxDrawdown` | Deepest peak-to-trough loss along the way. |
| `winRate` | Winning round-trips ÷ total closed round-trips. `null` if none. |
| `payoffRatio` | \|avgWin / avgLoss\|. `null` when either side is empty. |
| `averageWin` / `averageLoss` | Mean realised P&L per winning / losing trade. |
| `tradeCount` / `roundTrips` | Raw and paired counts. |
| `spanDays` | Length of the tested window in days. |
| `exposureFraction` | Fraction of post-warm-up bars during which the strategy held a long. |
| `exitCounts` | Breakdown of SELLs by cause: `{ signal, stopLoss, takeProfit }`. Sums to sell count. Always populated (all zero when overlay is off). |

Commissions and slippage are **not** modelled — the story is "does the signal work?", not "does the signal work at your broker with your fills?". Add commissions before making live trading decisions off any of these numbers.

#### History persistence

Every completed run auto-saves to the SQLite table `backtest_runs` (see `lib/db.ts` v16 and `lib/backtest-store.ts`). The persistence layer:

- Stores the full `config` and `result` blobs as JSON so opening a past run re-renders the identical equity curve, trade log, and metrics — no network re-fetch, no engine re-run.
- Duplicates a handful of summary columns (`total_return`, `buy_hold_return`, `max_drawdown`, `trade_count`, `win_rate`) so the history list can render "ticker · strategy · period" rows without parsing the blob.
- Enforces a rolling cap of **`MAX_HISTORY_ROWS = 100`** — oldest rows are pruned in the same transaction as the insert. Typical blob size is 10–50 KB, worst-case ~250 KB, so the whole table stays under ~25 MB at max cap.

`GET /api/signal/backtest/history` returns the summary list; `GET /api/signal/backtest/history/[id]` returns a full run; `DELETE` on either endpoint removes rows. Clicking a history-list row on `/backtest` re-hydrates every input including the SL/TP overlay so **Re-run** reproduces the exact same test.

Callers who explicitly *don't* want persistence (e.g. a comparison "what-if" preview) can pass `persist: false` in the POST body.

#### Beginner-mode advice

When the sidebar's experience toggle is on **Beginner**, `components/backtest-advice.tsx` renders a plain-English banner above the results with a headline verdict and 3–5 decision-relevant bullets picked based on the actual numbers:

- Drawdown pain-check (dollar amount, not just %).
- Trade-count statistical significance (fewer than 6 → the sample is too thin to trust).
- Win-rate vs payoff-ratio balance (54% × 1.5× is great, 54% × 0.5× is bleeding out).
- Exposure sanity (a "great" return over 8% exposure is likely noise).
- Execution-timing caveat for `sameClose`.
- Strategy-specific known weakness (see the strategies table).
- Overlay-driven bullet: whether stops dominated, TPs dominated, or the levels never actually triggered.

Copy lives entirely in `lib/i18n/dict.ts` under the `backtest.advice.*` namespace so tweaks don't require code changes.

#### Save as paper portfolio

The "Save as paper portfolio" panel converts the trade log into the shape `POST /api/paper/portfolios` expects, stamping `createdAt` from each trade's `fillBarTime` so the paper-trading timeline reflects when the trade **would** have happened (not when the button was pressed). The default portfolio name is `TICKER · <short strategy> <period>` (e.g. `AAPL · EMA-X 2y`).

#### Not implemented (yet)

- Intraday bars (engine is bar-agnostic, but `nextOpen` assumes overnight gaps between bars and Yahoo intraday history is capped at 60 days).
- Commissions per trade.
- Dividends / corporate actions.
- Short selling on bearish signals — flat is flat.
- Trailing stops (only fixed SL/TP is supported; trailing would need per-position high-water tracking and is a bigger feature better handled as its own overlay).
- Historical Fear & Greed — CNN publishes the current value only. `includeFearGreed: true` applies today's value uniformly across all historical bars; the UI surfaces a warning when this is on.

### Finance-tuned sentiment

The stock `vader-sentiment` npm package doesn't expose a mutable lexicon (unlike the Python one), so we compute two scores in parallel: the default VADER compound score, and a lexicon score using our ~120-entry finance dictionary (`beat`, `plunge`, `downgrade`, `bullish`, …). When any finance terms match we blend 60% finance / 40% VADER; otherwise VADER carries. Empirically this classifies headlines identically to the Python overlay in every one of our test cases.

## License

Not for redistribution — internal project. Yahoo Finance data is subject to Yahoo's terms of service.
