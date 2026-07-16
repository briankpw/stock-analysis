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
| `CACHE_TTL_SECONDS` | `900` | Yahoo Finance response cache TTL |
| `PAPER_STARTING_CASH` | `100000` | Starting cash for the paper account |
| `PAPER_COMMISSION` | `0` | Per-trade commission |
| `BOT_LOOKBACK_PERIOD` | `1y` | Bar window the bot fetches on every tick |
| `BOT_LOOKBACK_INTERVAL` | `1d` | Bar interval for the bot |
| `BOT_POLL_INTERVAL_SECONDS` | `900` | Seconds between worker ticks (minimum enforced: 60) |
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

### Finance-tuned sentiment

The stock `vader-sentiment` npm package doesn't expose a mutable lexicon (unlike the Python one), so we compute two scores in parallel: the default VADER compound score, and a lexicon score using our ~120-entry finance dictionary (`beat`, `plunge`, `downgrade`, `bullish`, …). When any finance terms match we blend 60% finance / 40% VADER; otherwise VADER carries. Empirically this classifies headlines identically to the Python overlay in every one of our test cases.

## License

Not for redistribution — internal project. Yahoo Finance data is subject to Yahoo's terms of service.
