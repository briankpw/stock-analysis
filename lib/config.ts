/**
 * Environment-driven configuration. Server-only — client code should read from
 * `NEXT_PUBLIC_*` variables directly.
 */

import fs from "node:fs";

const _env = (key: string, def: string) => process.env[key]?.trim() || def;

/**
 * Docker-standard `<VAR>_FILE` convention — used by every reputable image
 * (Postgres, MySQL, Redis, …) so secrets can be delivered via a bind-mounted
 * file rather than a plain env var visible in `docker inspect`.
 *
 * Precedence:
 *   1. `<VAR>_FILE` — read the mount and use its trimmed contents.
 *   2. `<VAR>`      — fall back to the inline env value.
 *   3. `""`         — empty string when neither is set.
 *
 * File read errors log a warning and fall back to (2). We intentionally
 * do not throw — a missing/unreadable secret file should degrade to the
 * "no notifications" mode rather than take the whole app down.
 */
function _envOrFile(key: string): string {
  const filePath = process.env[`${key}_FILE`]?.trim();
  if (filePath) {
    try {
      return fs.readFileSync(filePath, "utf8").trim();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config] Failed to read ${key}_FILE at ${filePath}, falling back to ${key} env:`,
        (err as Error).message,
      );
    }
  }
  return process.env[key]?.trim() ?? "";
}

const _secUserAgent = _env(
  "SEC_USER_AGENT",
  "Key Stock Dashboard research@example.com",
);

/**
 * Public URL the app is served from, e.g. `https://stocks.example.com` or
 * `http://192.168.1.5:5001`. Optional — leave unset for local development
 * or when the app is only ever hit at the container's own host:port.
 *
 * Currently consumed by:
 *   * middleware.ts — accepted as an authoritative same-origin baseline
 *     for the CSRF check, so requests still pass when a reverse proxy
 *     rewrites the `Host` header.
 *
 * Reserved for future use by:
 *   * Deep-link footers in Telegram notifications ("Open in dashboard").
 *   * Absolute OG / canonical tags in <head>.
 *   * Redirect URIs during any future auth flow.
 *
 * Parsing rules:
 *   * Trailing slashes are stripped so `appUrl + "/foo"` never doubles up.
 *   * Invalid URLs log a warning and fall back to empty (no fail-fast —
 *     it's an optional config).
 */
function _parseAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    // strip trailing slash on the path portion (keeps query / hash intact)
    u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] APP_URL is not a valid URL (${raw}); ignoring — CSRF fallback will use the request's Host header only.`,
    );
    return "";
  }
}
const _appUrl = _parseAppUrl();

// SEC's Fair Access policy explicitly requires a real contact so they can
// reach out before throttling. Shipping the placeholder to production means
// SEC will happily 403 every EDGAR request — that manifests as broken
// insider-watches, empty search, cratered fund pages, etc.
//
// We fail fast at import time in production only. Development / test builds
// still boot with the placeholder so `npm run dev` on a fresh clone doesn't
// need a config edit before it can start.
//
// The `NEXT_PHASE` guard skips this during `next build` — the placeholder
// is fine when we're just emitting bytecode; the check should fire when a
// real server (or the worker) actually tries to serve traffic.
const _isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (
  !_isBuildPhase &&
  process.env.NODE_ENV === "production" &&
  /example\.com/i.test(_secUserAgent)
) {
  throw new Error(
    "SEC_USER_AGENT is still set to the placeholder. Set it to a real " +
      "contact email (e.g. 'Your Name your.email@yourdomain.com') before " +
      "starting in production — SEC will otherwise block every request.",
  );
}

export const settings = {
  ticker: _env("STOCK_TICKER", "KEYS").toUpperCase(),
  companyName: _env("COMPANY_NAME", "Keysight Technologies"),
  defaultPeriod: _env("DEFAULT_PERIOD", "1y"),
  defaultInterval: _env("DEFAULT_INTERVAL", "1d"),
  cacheTtlSeconds: Number(_env("CACHE_TTL_SECONDS", "900")),
  timezone: _env("TZ", "UTC"),
  // Empty string when unset; consumers should check truthiness before use.
  // Normalised (trailing slashes stripped, invalid values downgraded to "").
  appUrl: _appUrl,
  paper: {
    startingCash: Number(_env("PAPER_STARTING_CASH", "100000")),
    commission: Number(_env("PAPER_COMMISSION", "0")),
  },
  bot: {
    lookbackPeriod: _env("BOT_LOOKBACK_PERIOD", "1y"),
    lookbackInterval: _env("BOT_LOOKBACK_INTERVAL", "1d"),
    pollIntervalSeconds: Number(_env("BOT_POLL_INTERVAL_SECONDS", "900")),
    dbPath: _env("BOT_DB_PATH", "./data/bot.db"),
    telegramBotToken: _envOrFile("TELEGRAM_BOT_TOKEN"),
    telegramChatId: _envOrFile("TELEGRAM_CHAT_ID"),
    // Rolling age floor for news / trade / insider alerts (days). Events
    // older than this are silently skipped by every engine — see
    // `lib/bot/recency.ts` for the rationale (Yahoo re-syndication, late
    // Form 4 amendments, lagged PTRs). Default is 2 days = today + the
    // previous UTC day. Set to 0 to disable the gate.
    notifyMaxAgeDays: Math.max(0, Number(_env("BOT_NOTIFY_MAX_AGE_DAYS", "2"))),
  },
  portfolios: {
    // Politician trades (STOCK Act) update daily-ish; 13F filings are quarterly.
    // Cache aggressively — the datasets are chunky and third-party rate limits
    // (particularly SEC's 10 req/sec) will bite if we don't.
    cacheTtlSeconds: Number(_env("PORTFOLIO_CACHE_TTL_SECONDS", "21600")),
    // See the fail-fast check above — this is validated at import time in
    // production so a public deploy never runs with the placeholder.
    secUserAgent: _secUserAgent,
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
