/**
 * Environment-driven configuration. Server-only — client code should read from
 * `NEXT_PUBLIC_*` variables directly.
 */

const _env = (key: string, def: string) => process.env[key]?.trim() || def;

export const settings = {
  ticker: _env("STOCK_TICKER", "KEYS").toUpperCase(),
  companyName: _env("COMPANY_NAME", "Keysight Technologies"),
  defaultPeriod: _env("DEFAULT_PERIOD", "1y"),
  defaultInterval: _env("DEFAULT_INTERVAL", "1d"),
  cacheTtlSeconds: Number(_env("CACHE_TTL_SECONDS", "900")),
  timezone: _env("TZ", "UTC"),
  paper: {
    startingCash: Number(_env("PAPER_STARTING_CASH", "100000")),
    commission: Number(_env("PAPER_COMMISSION", "0")),
  },
  bot: {
    lookbackPeriod: _env("BOT_LOOKBACK_PERIOD", "1y"),
    lookbackInterval: _env("BOT_LOOKBACK_INTERVAL", "1d"),
    pollIntervalSeconds: Number(_env("BOT_POLL_INTERVAL_SECONDS", "900")),
    dbPath: _env("BOT_DB_PATH", "./data/bot.db"),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
  },
  portfolios: {
    // Politician trades (STOCK Act) update daily-ish; 13F filings are quarterly.
    // Cache aggressively — the datasets are chunky and third-party rate limits
    // (particularly SEC's 10 req/sec) will bite if we don't.
    cacheTtlSeconds: Number(_env("PORTFOLIO_CACHE_TTL_SECONDS", "21600")),
    // SEC explicitly requires a User-Agent identifying the requester. Override
    // via env in production; otherwise a placeholder is used.
    // See: https://www.sec.gov/os/webmaster-faq#code-support
    secUserAgent: _env(
      "SEC_USER_AGENT",
      "Key Stock Dashboard research@example.com",
    ),
  },
} as const;

export const SUPPORTED_PERIODS = [
  "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max",
] as const;
export type Period = (typeof SUPPORTED_PERIODS)[number];

export const SUPPORTED_INTERVALS = [
  "1d", "5d", "1wk", "1mo", "3mo",
] as const;
export type Interval = (typeof SUPPORTED_INTERVALS)[number];

export function telegramConfigured(): boolean {
  return Boolean(settings.bot.telegramBotToken && settings.bot.telegramChatId);
}
