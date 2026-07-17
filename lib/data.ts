/**
 * Market data fetching via `yahoo-finance2` — the Node.js equivalent of
 * `src/data.py`. Includes an in-memory TTL cache (per ticker + endpoint) and
 * exponential-backoff retry on transient failures.
 *
 * Rate-limit story
 * ----------------
 * Yahoo Finance still applies aggressive rate-limiting server-side (429s and
 * empty payloads). Unlike the Python side there is no `curl_cffi` trick
 * available for Node, so we lean on:
 *   1. Client-side TTL caching (`CACHE_TTL_SECONDS`, default 15 min) so we
 *      don't re-fetch the same endpoint for the same ticker within the
 *      window.
 *   2. Exponential backoff on any thrown error — same 4-attempt/1.5s-base
 *      strategy as the Python implementation.
 *   3. A user-facing `RateLimitedError` so the UI can render a targeted
 *      "Yahoo is throttling us" message instead of a generic red screen.
 */

import YahooFinance from "yahoo-finance2";
import { settings } from "./config";
import type { Bar } from "./indicators";
import { createTtlCache } from "./utils";

// -------- yahoo-finance2 instance --------------------------------------------
// v3.x requires an explicit `new YahooFinance()` — the default export is a
// class, not a pre-instantiated singleton. We keep one instance for the whole
// process (module-level singleton) so cookie jars + auth crumbs are shared.
const yahooFinance = new YahooFinance();

// v3.x prints a "runtime survey" notice + validation warnings on first use;
// both are harmless but noisy for a dashboard. Some builds don't expose these
// helpers, so guard the calls behind runtime feature detection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _yf = yahooFinance as any;
if (typeof _yf.suppressNotices === "function") {
  _yf.suppressNotices(["yahooSurvey", "ripHistorical"]);
}
if (typeof _yf.setGlobalConfig === "function") {
  _yf.setGlobalConfig({ validation: { logErrors: false } });
}


export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}

const RATE_LIMIT_MARKERS = [
  "too many requests",
  "rate limit",
  "429",
  "yfratelimiterror",
];

/**
 * Errors we treat as *permanent* — retrying them just wastes time and
 * quota (invalid ticker, symbol not found, HTTP 4xx that isn't 429).
 * Detected by substring on the message and short-circuit the retry loop.
 */
const PERMANENT_MARKERS = [
  "not found",
  "no data",
  "invalid symbol",
  "invalid ticker",
  "empty history",
  "http 400",
  "http 401",
  "http 403",
  "http 404",
  "http 410",
  "http 422",
];

function isRateLimit(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return RATE_LIMIT_MARKERS.some((m) => msg.includes(m));
}

function isPermanent(err: unknown): boolean {
  if (err instanceof RateLimitedError) return false; // 429 is transient
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (RATE_LIMIT_MARKERS.some((m) => msg.includes(m))) return false;
  return PERMANENT_MARKERS.some((m) => msg.includes(m));
}


// -------- Retry helper (mirrors Python's `_retry`) ---------------------------
async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelay = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Permanent failures (invalid ticker, 404, ...) surface immediately;
      // there is nothing a retry can fix and each attempt burns quota.
      if (isPermanent(err)) break;
      if (attempt === attempts) break;
      const jitter = Math.random() * 500;
      const wait = baseDelay * 2 ** (attempt - 1) + jitter;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (isRateLimit(lastErr)) {
    throw new RateLimitedError(
      lastErr instanceof Error ? lastErr.message : String(lastErr),
    );
  }
  throw lastErr;
}


// -------- Very small TTL cache -----------------------------------------------
// Deliberately in-memory only: this is a single-process Next.js app, so no
// need for Redis. TTL comes from `CACHE_TTL_SECONDS` in the env. `maxSize`
// prevents a runaway process (or a bad-actor request loop) from growing the
// map unboundedly — oldest entries are evicted first.
const cache = createTtlCache<unknown>({
  defaultTtlMs: settings.cacheTtlSeconds * 1000,
  maxSize: 500,
});

function cacheGet<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, value);
}

/**
 * Wipe every cache entry that includes `ticker` — called by the UI's
 * "Refresh data" button so the next call goes back to Yahoo.
 */
export function invalidateCache(ticker?: string): void {
  if (!ticker) {
    cache.clear();
    return;
  }
  const marker = `:${ticker.toUpperCase()}:`;
  for (const key of cache.keys()) {
    if (key.includes(marker)) cache.delete(key);
  }
}


// -------- Period → date helper --------------------------------------------
function periodToStart(period: string, now = new Date()): Date {
  const d = new Date(now);
  switch (period) {
    case "1mo": d.setMonth(d.getMonth() - 1); break;
    case "3mo": d.setMonth(d.getMonth() - 3); break;
    case "6mo": d.setMonth(d.getMonth() - 6); break;
    case "1y":  d.setFullYear(d.getFullYear() - 1); break;
    case "2y":  d.setFullYear(d.getFullYear() - 2); break;
    case "5y":  d.setFullYear(d.getFullYear() - 5); break;
    case "10y": d.setFullYear(d.getFullYear() - 10); break;
    case "ytd": d.setMonth(0); d.setDate(1); break;
    case "max": d.setFullYear(d.getFullYear() - 30); break;
    default: d.setFullYear(d.getFullYear() - 1); // fall back to 1y
  }
  return d;
}


// -------- Types --------------------------------------------------------------
export interface Quote {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string;
  marketState: string;
  fetchedAt: string; // ISO
}

export interface Info {
  [key: string]: unknown;
}

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string; // ISO
  summary: string;
}

export interface Bundle {
  ticker: string;
  quote: Quote;
  info: Info;
  bars: Bar[];
  period: string;
  interval: string;
  rateLimited: boolean;
  fetchedAt: string;
}


// -------- Ownership / holders types -----------------------------------------

/** A person listed on SEC Form 4 filings — CEOs, directors, officers, etc. */
export interface InsiderHolder {
  name: string;
  relation: string;
  transactionDescription: string;
  latestTransDate: string | null;
  positionDirect: number | null;
  positionIndirect: number | null;
  url: string;
}

/** A single insider buy/sell transaction (SEC Form 4 / 144 event). */
export interface InsiderTransaction {
  filerName: string;
  filerRelation: string;
  transactionText: string;
  moneyText: string;
  shares: number | null;
  value: number | null;
  ownership: string;
  startDate: string | null;
  filerUrl: string;
}

/** An institution or mutual fund holder — from 13F / 13G filings. */
export interface InstitutionalHolder {
  organization: string;
  reportDate: string | null;
  pctHeld: number | null;
  position: number | null;
  value: number | null;
  pctChange: number | null;
}

/** Aggregate breakdown of who owns the float. */
export interface MajorHoldersSummary {
  insidersPercentHeld: number | null;
  institutionsPercentHeld: number | null;
  institutionsFloatPercentHeld: number | null;
  institutionsCount: number | null;
}

/** Rolling 6-month net insider / net institutional flow. */
export interface NetInsiderActivity {
  period: string;
  buyInfoCount: number | null;
  buyInfoShares: number | null;
  buyPercentInsiderShares: number | null;
  sellInfoCount: number | null;
  sellInfoShares: number | null;
  sellPercentInsiderShares: number | null;
  netInfoCount: number | null;
  netInfoShares: number | null;
  netPercentInsiderShares: number | null;
  totalInsiderShares: number | null;
  netInstSharesBuying: number | null;
  netInstBuyingPercent: number | null;
}

export interface Holders {
  ticker: string;
  summary: MajorHoldersSummary;
  netActivity: NetInsiderActivity | null;
  insiders: InsiderHolder[];
  insiderTransactions: InsiderTransaction[];
  institutions: InstitutionalHolder[];
  funds: InstitutionalHolder[];
  fetchedAt: string;
}


// -------- Fetchers -----------------------------------------------------------

export async function fetchHistory(
  ticker: string,
  period: string,
  interval: string,
): Promise<Bar[]> {
  const key = `history:${ticker.toUpperCase()}:${period}:${interval}`;
  const cached = cacheGet<Bar[]>(key);
  if (cached) return cached;

  const bars = await retry(async () => {
    // yahoo-finance2's `chart` covers what yfinance's `history` does.
    // yahoo-finance2's return type is a discriminated union based on the
    // `return` option; we always ask for the array form and cast down.
    const raw = await yahooFinance.chart(ticker, {
      period1: periodToStart(period),
      period2: new Date(),
      interval: interval as "1d" | "1wk" | "1mo",
    });
    const res = raw as unknown as { quotes: Array<Record<string, unknown>> };
    const quotes = res?.quotes ?? [];
    if (quotes.length === 0) {
      throw new Error(`Empty history for ${ticker}`);
    }
    const bars: Bar[] = [];
    for (const q of quotes) {
      const close = (q.close as number | null) ?? (q.adjclose as number | null) ?? null;
      const open = (q.open as number | null) ?? null;
      const high = (q.high as number | null) ?? null;
      const low = (q.low as number | null) ?? null;
      const volume = (q.volume as number | null) ?? 0;
      const dateVal = q.date as string | number | Date | undefined;
      if (
        close === null || open === null || high === null || low === null ||
        !dateVal
      ) {
        continue;
      }
      bars.push({
        time: Math.floor(new Date(dateVal).getTime() / 1000),
        open, high, low, close, volume,
      });
    }
    return bars;
  });

  cacheSet(key, bars);
  return bars;
}


export async function fetchQuote(ticker: string): Promise<Quote> {
  const key = `quote:${ticker.toUpperCase()}`;
  const cached = cacheGet<Quote>(key);
  if (cached) return cached;

  const quote = await retry(async () => {
    const q = await yahooFinance.quote(ticker);
    // `yahoo-finance2` narrows differently across versions; be defensive.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyQ = q as any;
    const price = anyQ.regularMarketPrice ?? null;
    const previousClose = anyQ.regularMarketPreviousClose ?? null;
    const change = anyQ.regularMarketChange ?? null;
    const changePercent = anyQ.regularMarketChangePercent ?? null;
    return {
      ticker: ticker.toUpperCase(),
      price,
      previousClose,
      change,
      changePercent:
        // yahoo returns the percent as a whole number (1.35 = 1.35%); the
        // rest of the app expects a fraction (0.0135), so scale here.
        typeof changePercent === "number" ? changePercent / 100 : null,
      currency: anyQ.currency ?? "USD",
      marketState: anyQ.marketState ?? "UNKNOWN",
      fetchedAt: new Date().toISOString(),
    } satisfies Quote;
  });
  cacheSet(key, quote);
  return quote;
}


export async function fetchInfo(ticker: string): Promise<Info> {
  const key = `info:${ticker.toUpperCase()}`;
  const cached = cacheGet<Info>(key);
  if (cached) return cached;

  const info = await retry(async () => {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: [
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "assetProfile",
        "price",
      ],
    });
    // Flatten into a single dict keyed by the fields the ratios page reads,
    // aligning with the shape the Python `info` blob has.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const flat: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modules = summary as any;
    for (const [_module, obj] of Object.entries(modules)) {
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          // Some yahoo-finance2 fields are wrapped `{ raw, fmt }`; unwrap.
          if (v && typeof v === "object" && "raw" in (v as object)) {
            flat[k] = (v as { raw: unknown }).raw;
          } else {
            flat[k] = v;
          }
        }
      }
    }
    return flat as Info;
  }, { attempts: 3 });

  cacheSet(key, info);
  return info;
}


export async function fetchNews(
  ticker: string,
  limit = 25,
): Promise<NewsItem[]> {
  const key = `news:${ticker.toUpperCase()}:${limit}`;
  const cached = cacheGet<NewsItem[]>(key);
  if (cached) return cached;

  const items = await retry(async () => {
    // `yahooFinance.search` returns a wide union; we only ever use `.news`.
    const res = (await yahooFinance.search(ticker, {
      newsCount: limit,
      quotesCount: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as { news?: Array<Record<string, unknown>> };
    const raw = res?.news ?? [];
    const out: NewsItem[] = [];
    for (const n of raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyN = n as any;
      if (!anyN.title) continue;
      out.push({
        title: String(anyN.title),
        publisher: String(anyN.publisher ?? "Unknown source"),
        link: String(anyN.link ?? ""),
        publishedAt: anyN.providerPublishTime
          ? new Date(anyN.providerPublishTime).toISOString()
          : new Date().toISOString(),
        summary: String(anyN.summary ?? ""),
      });
    }
    return out;
  }, { attempts: 3 });

  cacheSet(key, items);
  return items;
}


/**
 * Aggregator — the "one-call-does-it-all" hook the Overview page uses.
 * Sets `rateLimited=true` (but doesn't throw) when Yahoo consistently
 * blocked us, so the UI can render a targeted warning.
 */
export async function fetchBundle(
  ticker: string,
  period: string,
  interval: string,
): Promise<Bundle> {
  let rateLimited = false;

  const historyP = fetchHistory(ticker, period, interval).catch((e: unknown) => {
    if (e instanceof RateLimitedError) rateLimited = true;
    return [] as Bar[];
  });
  const quoteP = fetchQuote(ticker).catch((e: unknown) => {
    if (e instanceof RateLimitedError) rateLimited = true;
    return null;
  });
  const infoP = fetchInfo(ticker).catch((e: unknown) => {
    if (e instanceof RateLimitedError) rateLimited = true;
    return {} as Info;
  });
  const [bars, quote, info] = await Promise.all([historyP, quoteP, infoP]);

  const fallbackQuote: Quote = {
    ticker: ticker.toUpperCase(),
    price: bars.length ? bars[bars.length - 1]!.close : null,
    previousClose: bars.length > 1 ? bars[bars.length - 2]!.close : null,
    change: null,
    changePercent: null,
    currency: "USD",
    marketState: "UNKNOWN",
    fetchedAt: new Date().toISOString(),
  };

  return {
    ticker: ticker.toUpperCase(),
    quote: quote ?? fallbackQuote,
    info,
    bars,
    period,
    interval,
    rateLimited,
    fetchedAt: new Date().toISOString(),
  };
}


// -------- Holders / ownership fetcher ----------------------------------------

/**
 * Normalize a Yahoo-Finance ISO Date/string into an ISO string, or null when
 * the field is missing/invalid. `quoteSummary` sometimes returns naked epoch
 * integers, `Date` objects, or ISO strings depending on the endpoint.
 */
function toIso(value: unknown): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value as string | number);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls the "who holds the stock" picture — split into internal (insiders,
 * insider transactions) and external (institutions, mutual funds), plus an
 * aggregate summary card (% insiders vs. % institutions) and a rolling
 * net-purchase-activity block.
 *
 * Yahoo returns partial data for many small caps; every list can independently
 * be missing. We return empty arrays / null fields rather than throwing so the
 * UI can still render "no data" gracefully.
 */
export async function fetchHolders(ticker: string): Promise<Holders> {
  const key = `holders:${ticker.toUpperCase()}`;
  const cached = cacheGet<Holders>(key);
  if (cached) return cached;

  const result = await retry(async () => {
    const summary = await yahooFinance.quoteSummary(ticker, {
      modules: [
        "majorHoldersBreakdown",
        "insiderHolders",
        "insiderTransactions",
        "institutionOwnership",
        "fundOwnership",
        "netSharePurchaseActivity",
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = summary as any;

    const majorHolders: MajorHoldersSummary = {
      insidersPercentHeld: toNumOrNull(s.majorHoldersBreakdown?.insidersPercentHeld),
      institutionsPercentHeld: toNumOrNull(s.majorHoldersBreakdown?.institutionsPercentHeld),
      institutionsFloatPercentHeld: toNumOrNull(
        s.majorHoldersBreakdown?.institutionsFloatPercentHeld,
      ),
      institutionsCount: toNumOrNull(s.majorHoldersBreakdown?.institutionsCount),
    };

    const netAct = s.netSharePurchaseActivity;
    const netActivity: NetInsiderActivity | null = netAct
      ? {
          period: String(netAct.period ?? ""),
          buyInfoCount: toNumOrNull(netAct.buyInfoCount),
          buyInfoShares: toNumOrNull(netAct.buyInfoShares),
          buyPercentInsiderShares: toNumOrNull(netAct.buyPercentInsiderShares),
          sellInfoCount: toNumOrNull(netAct.sellInfoCount),
          sellInfoShares: toNumOrNull(netAct.sellInfoShares),
          sellPercentInsiderShares: toNumOrNull(netAct.sellPercentInsiderShares),
          netInfoCount: toNumOrNull(netAct.netInfoCount),
          netInfoShares: toNumOrNull(netAct.netInfoShares),
          netPercentInsiderShares: toNumOrNull(netAct.netPercentInsiderShares),
          totalInsiderShares: toNumOrNull(netAct.totalInsiderShares),
          netInstSharesBuying: toNumOrNull(netAct.netInstSharesBuying),
          netInstBuyingPercent: toNumOrNull(netAct.netInstBuyingPercent),
        }
      : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insiders: InsiderHolder[] = (s.insiderHolders?.holders ?? []).map((h: any) => ({
      name: String(h.name ?? ""),
      relation: String(h.relation ?? ""),
      transactionDescription: String(h.transactionDescription ?? ""),
      latestTransDate: toIso(h.latestTransDate),
      positionDirect: toNumOrNull(h.positionDirect),
      positionIndirect: toNumOrNull(h.positionIndirect),
      url: String(h.url ?? ""),
    }));

    const insiderTransactions: InsiderTransaction[] = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.insiderTransactions?.transactions ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).map((t: any) => ({
      filerName: String(t.filerName ?? ""),
      filerRelation: String(t.filerRelation ?? ""),
      transactionText: String(t.transactionText ?? ""),
      moneyText: String(t.moneyText ?? ""),
      shares: toNumOrNull(t.shares),
      value: toNumOrNull(t.value),
      ownership: String(t.ownership ?? ""),
      startDate: toIso(t.startDate),
      filerUrl: String(t.filerUrl ?? ""),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapOwnership = (list: any[] | undefined): InstitutionalHolder[] =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (list ?? []).map((o: any) => ({
        organization: String(o.organization ?? ""),
        reportDate: toIso(o.reportDate),
        pctHeld: toNumOrNull(o.pctHeld),
        position: toNumOrNull(o.position),
        value: toNumOrNull(o.value),
        pctChange: toNumOrNull(o.pctChange),
      }));

    const institutions = mapOwnership(s.institutionOwnership?.ownershipList);
    const funds = mapOwnership(s.fundOwnership?.ownershipList);

    const holders: Holders = {
      ticker: ticker.toUpperCase(),
      summary: majorHolders,
      netActivity,
      insiders,
      insiderTransactions,
      institutions,
      funds,
      fetchedAt: new Date().toISOString(),
    };
    return holders;
  }, { attempts: 3 });

  cacheSet(key, result);
  return result;
}
