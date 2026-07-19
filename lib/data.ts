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
import { createTtlCache, withDeadline } from "./utils";

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

/**
 * Hard deadline for every outbound Yahoo Finance call.
 *
 * yahoo-finance2 uses Node's global `fetch` under the hood and exposes no
 * per-request `AbortSignal`/timeout option we can set globally. A network
 * hang (TCP connection stalls after Yahoo accepts the connection) will
 * therefore block the awaiting caller indefinitely — and because the bot
 * worker's tick engines run *sequentially* (`lib/bot/engine.ts`
 * `runForever`), one hung ticker would wedge every other watch engine
 * from making progress for the rest of the process lifetime.
 *
 * We defend by racing each call against `withDeadline(...)`. On timeout
 * the outer `retry()` treats it as a transient failure and re-runs with
 * exponential backoff, so a real slow-but-alive Yahoo just costs an
 * extra retry rather than a wedged worker.
 *
 * 15s is chosen to be well above Yahoo's typical p99 response time (~1-3s
 * observed) while still short enough to keep the sequential tick loop
 * responsive under repeated failure.
 */
const YAHOO_TIMEOUT_MS = 15_000;

/**
 * Wrap a `yahoo-finance2` call in the module-wide deadline. `label` is
 * used purely for error messages so a timeout tells the operator which
 * endpoint hung, not just "operation timed out".
 */
function callYahoo<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return withDeadline(fn(), YAHOO_TIMEOUT_MS, `yahoo.${label}`);
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
 * In-flight request registry. Complementary to the TTL cache above:
 * once a request for a given key is *cached*, we serve from memory;
 * but during the (potentially several-second) window between "call
 * started" and "response cached" a burst of concurrent callers would
 * otherwise all fan out to Yahoo. Registering the promise here means
 * every subsequent caller in that window `.then`s onto the same
 * upstream call and Yahoo sees exactly one request.
 *
 * The promise is deleted from the registry as soon as it settles
 * (success OR failure) — a failed call must not permanently poison
 * the key, and the TTL cache above is the sole source of truth for
 * successful results. Failure suppresses caching entirely so the
 * next attempt hits Yahoo fresh.
 *
 * Keys use the same `endpoint:TICKER` shape as the TTL cache so a
 * single grep can trace the full request lifecycle.
 */
const _inflight = new Map<string, Promise<unknown>>();

/**
 * Wrap a compute function in the in-flight registry. If a call for
 * `key` is already running, return its promise; otherwise register
 * a new one and clean up when it settles.
 *
 * Kept `<T>` generic (rather than typed on the whole cache) because
 * different endpoints return different shapes and TypeScript's map
 * value covariance would force casts everywhere otherwise.
 */
function withInflight<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const existing = _inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = compute().finally(() => {
    // Only clear if we're still the recorded promise — protects
    // against a slow settle racing with a subsequent identical call
    // that already registered a fresh promise.
    if (_inflight.get(key) === p) _inflight.delete(key);
  });
  _inflight.set(key, p);
  return p;
}

/**
 * Wipe every cache entry that includes `ticker` — called by the UI's
 * "Refresh data" button so the next call goes back to Yahoo. Also
 * drops any in-flight promises for that ticker so a mid-refresh
 * request can't hand back stale data after the user clicked "clear".
 */
export function invalidateCache(ticker?: string): void {
  if (!ticker) {
    cache.clear();
    _inflight.clear();
    return;
  }
  const marker = `:${ticker.toUpperCase()}:`;
  for (const key of cache.keys()) {
    if (key.includes(marker)) cache.delete(key);
  }
  const upper = ticker.toUpperCase();
  for (const key of _inflight.keys()) {
    // Match both `endpoint:TICKER` and `endpoint:TICKER:...` variants.
    if (key.endsWith(`:${upper}`) || key.includes(`:${upper}:`)) {
      _inflight.delete(key);
    }
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
  /** Regular-session share volume (best-effort; null if Yahoo omitted it). */
  volume: number | null;
  /** 3-month average daily volume — used for "unusual volume" callouts. */
  avgVolume3M: number | null;
  /** Market cap in the security's own currency. Null for indices/ETFs
   * that Yahoo doesn't report a cap for. */
  marketCap: number | null;
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

  return withInflight(key, () => _fetchHistoryUncached(ticker, period, interval, key));
}

async function _fetchHistoryUncached(
  ticker: string,
  period: string,
  interval: string,
  key: string,
): Promise<Bar[]> {
  const bars = await retry(async () => {
    // yahoo-finance2's `chart` covers what yfinance's `history` does.
    // yahoo-finance2's return type is a discriminated union based on the
    // `return` option; we always ask for the array form and cast down.
    const raw = await callYahoo("chart", () =>
      yahooFinance.chart(ticker, {
        period1: periodToStart(period),
        period2: new Date(),
        interval: interval as "1d" | "1wk" | "1mo",
      }),
    );
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


/**
 * Turn one raw yahoo-finance2 quote row into our internal `Quote`
 * shape. Extracted so `fetchQuote` and the batched `fetchQuotes`
 * below share exactly the same field-mapping logic — a schema drift
 * (Yahoo renames a field) touches one place, not two.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeQuoteRow(anyQ: any, tickerUpper: string): Quote {
  const price = anyQ.regularMarketPrice ?? null;
  const previousClose = anyQ.regularMarketPreviousClose ?? null;
  const change = anyQ.regularMarketChange ?? null;
  const changePercent = anyQ.regularMarketChangePercent ?? null;
  // Volume + market cap: needed by the segment heatmap to size boxes
  // proportionally. Yahoo omits `marketCap` for ETFs/indices and
  // sometimes `regularMarketVolume` after hours — treat both as
  // best-effort and default to `null` on absence.
  const volume =
    typeof anyQ.regularMarketVolume === "number"
      ? anyQ.regularMarketVolume
      : null;
  const avgVolume3M =
    typeof anyQ.averageDailyVolume3Month === "number"
      ? anyQ.averageDailyVolume3Month
      : typeof anyQ.averageDailyVolume10Day === "number"
        ? anyQ.averageDailyVolume10Day
        : null;
  const marketCap =
    typeof anyQ.marketCap === "number" ? anyQ.marketCap : null;
  return {
    ticker: tickerUpper,
    price,
    previousClose,
    change,
    changePercent:
      // yahoo returns the percent as a whole number (1.35 = 1.35%); the
      // rest of the app expects a fraction (0.0135), so scale here.
      typeof changePercent === "number" ? changePercent / 100 : null,
    volume,
    avgVolume3M,
    marketCap,
    currency: anyQ.currency ?? "USD",
    marketState: anyQ.marketState ?? "UNKNOWN",
    fetchedAt: new Date().toISOString(),
  } satisfies Quote;
}

export async function fetchQuote(ticker: string): Promise<Quote> {
  const key = `quote:${ticker.toUpperCase()}`;
  const cached = cacheGet<Quote>(key);
  if (cached) return cached;

  return withInflight(key, async () => {
    const quote = await retry(async () => {
      const q = await callYahoo("quote", () => yahooFinance.quote(ticker));
      // `yahoo-finance2` narrows differently across versions; be defensive.
      return normalizeQuoteRow(q, ticker.toUpperCase());
    });
    cacheSet(key, quote);
    return quote;
  });
}

/**
 * Batch-fetch quotes for multiple tickers in a single Yahoo call.
 *
 * `yahoo-finance2` natively accepts a `string[]` for its `quote()`
 * function and Yahoo responds with a single JSON payload containing
 * every requested symbol — so this is 1 HTTP round-trip regardless of
 * how many tickers we ask for (up to Yahoo's implicit ~200-symbol
 * ceiling). Compare with mapping `fetchQuote` over the list, which
 * fires N parallel requests and reliably trips Yahoo's rate limiter
 * once N is above ~15.
 *
 * Results are returned in a `Map` keyed by upper-cased ticker.
 * Symbols Yahoo returns but that fail to normalize (missing every
 * expected field) are omitted from the map — the caller decides
 * whether to render "—" or fall back to the per-symbol
 * `fetchQuote()`.
 *
 * TTL cache is honoured: any ticker already cached is served from
 * memory and *not* included in the upstream request. This is what
 * makes the batch endpoint idempotent under a page-refresh burst
 * without re-querying Yahoo.
 *
 * If ALL requested tickers are already in-cache, no upstream call is
 * made at all.
 */
export async function fetchQuotes(
  tickers: readonly string[],
): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const uppers = tickers.map((t) => t.toUpperCase());

  // Partition: served-from-cache vs. needs-upstream-fetch. Preserves
  // insertion order so the caller's iteration order is stable.
  const toFetch: string[] = [];
  for (const upper of uppers) {
    const cached = cacheGet<Quote>(`quote:${upper}`);
    if (cached) {
      out.set(upper, cached);
    } else if (!toFetch.includes(upper)) {
      toFetch.push(upper);
    }
  }

  if (toFetch.length === 0) return out;

  // One batched call. `yahoo-finance2` accepts an array and returns
  // an array of quote rows — same normalisation path as `fetchQuote`.
  const rows = await retry(async () => {
    // Cast because the yahoo-finance2 type overloads narrow to a
    // single-symbol return when the arg looks like a string literal
    // to TS; passing `string[]` gets us the array shape at runtime.
    const q = await callYahoo("quote.batch", () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yahooFinance.quote(toFetch as any),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Array.isArray(q) ? q : q ? [q] : []) as any[];
  });

  // Map by returned symbol so we tolerate Yahoo re-ordering or
  // silently dropping symbols we don't have data for.
  for (const raw of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyQ = raw as any;
    const sym =
      typeof anyQ?.symbol === "string" ? anyQ.symbol.toUpperCase() : null;
    if (!sym) continue;
    const normalized = normalizeQuoteRow(anyQ, sym);
    // Only cache + return rows that got at least one meaningful price
    // field back — Yahoo occasionally returns a symbol row with every
    // field null when a ticker is delisted, and we'd rather serve a
    // "no data" state per-symbol than poison the 15-min TTL cache
    // with an empty quote.
    if (
      normalized.price != null ||
      normalized.previousClose != null ||
      normalized.marketCap != null
    ) {
      cacheSet(`quote:${sym}`, normalized);
      out.set(sym, normalized);
    }
  }
  return out;
}


export async function fetchInfo(ticker: string): Promise<Info> {
  const key = `info:${ticker.toUpperCase()}`;
  const cached = cacheGet<Info>(key);
  if (cached) return cached;

  return withInflight(key, async () => {
    const info = await retry(async () => {
      const summary = await callYahoo("quoteSummary.info", () =>
        yahooFinance.quoteSummary(ticker, {
          modules: [
            "summaryDetail",
            "defaultKeyStatistics",
            "financialData",
            "assetProfile",
            "price",
          ],
        }),
      );
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
  });
}


export async function fetchNews(
  ticker: string,
  limit = 25,
): Promise<NewsItem[]> {
  const key = `news:${ticker.toUpperCase()}:${limit}`;
  const cached = cacheGet<NewsItem[]>(key);
  if (cached) return cached;

  return withInflight(key, async () => {
    const items = await retry(async () => {
      // `yahooFinance.search` returns a wide union; we only ever use `.news`.
      const res = (await callYahoo("search.news", () =>
        yahooFinance.search(ticker, {
          newsCount: limit,
          quotesCount: 0,
        }),
      )) as { news?: Array<Record<string, unknown>> };
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
  });
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
    volume: bars.length ? bars[bars.length - 1]!.volume : null,
    avgVolume3M: null,
    marketCap: null,
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

  return withInflight(key, () => _fetchHoldersUncached(ticker, key));
}

async function _fetchHoldersUncached(
  ticker: string,
  key: string,
): Promise<Holders> {
  const result = await retry(async () => {
    const summary = await callYahoo("quoteSummary.holders", () =>
      yahooFinance.quoteSummary(ticker, {
        modules: [
          "majorHoldersBreakdown",
          "insiderHolders",
          "insiderTransactions",
          "institutionOwnership",
          "fundOwnership",
          "netSharePurchaseActivity",
        ],
      }),
    );

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
