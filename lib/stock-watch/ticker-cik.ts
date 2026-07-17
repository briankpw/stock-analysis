/**
 * Ticker → CIK resolution.
 *
 * SEC publishes a canonical map of every reporting-company ticker to its
 * CIK at https://www.sec.gov/files/company_tickers.json (updated daily).
 * We fetch it once on demand, cache the entire response in-memory for
 * `TTL_MS`, and expose a synchronous-ish lookup helper.
 *
 * Rate-limit note: this endpoint counts against SEC's 10 req/sec quota,
 * but the file is ~1.5MB and we only ever refresh once per TTL window,
 * so it's effectively free.
 */

import { secHeaders } from "@/lib/portfolios";
import { timedFetch } from "@/lib/http";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface TickersJson {
  [rowIdx: string]: {
    cik_str: number;
    ticker: string;
    title: string;
  };
}

export interface TickerLookup {
  /** 10-char zero-padded CIK, ready for SEC endpoints. */
  cik: string;
  /** Cleaned uppercase ticker as SEC lists it. */
  ticker: string;
  /** Company legal name. */
  name: string;
}

interface CacheEntry {
  fetchedAt: number;
  bySymbol: Map<string, TickerLookup>;
}

let cache: CacheEntry | null = null;
let inflight: Promise<CacheEntry> | null = null;

function padCik(n: number): string {
  return String(n).padStart(10, "0");
}

async function loadFresh(): Promise<CacheEntry> {
  const res = await timedFetch(TICKERS_URL, {
    headers: secHeaders(),
    cache: "no-store",
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    throw new Error(`SEC company_tickers.json GET → HTTP ${res.status}`);
  }
  const raw = (await res.json()) as TickersJson;
  const bySymbol = new Map<string, TickerLookup>();
  for (const key of Object.keys(raw)) {
    const row = raw[key]!;
    if (!row?.ticker || !row?.cik_str) continue;
    const symbol = row.ticker.toUpperCase();
    // First entry wins — SEC has occasional dupes where a symbol maps
    // to multiple CIKs (e.g. class-A / class-B share tickers). Order is
    // stable in the source file.
    if (bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, {
      cik: padCik(row.cik_str),
      ticker: symbol,
      name: row.title,
    });
  }
  return { fetchedAt: Date.now(), bySymbol };
}

async function getCache(): Promise<CacheEntry> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = loadFresh().then(
    (fresh) => {
      cache = fresh;
      inflight = null;
      return fresh;
    },
    (err) => {
      inflight = null;
      throw err;
    },
  );
  return inflight;
}

/**
 * Resolve a stock ticker to its SEC CIK. Returns `null` when SEC
 * doesn't know the symbol (e.g. crypto, unlisted, or typo). Callers
 * should treat that as "watch is saved but no data yet".
 */
export async function resolveTickerCik(
  ticker: string,
): Promise<TickerLookup | null> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return null;
  const c = await getCache();
  return c.bySymbol.get(symbol) ?? null;
}

/** Batch variant — dedups per unique symbol, one map lookup each. */
export async function resolveTickerCiks(
  tickers: readonly string[],
): Promise<Map<string, TickerLookup>> {
  const c = await getCache();
  const out = new Map<string, TickerLookup>();
  for (const t of tickers) {
    const symbol = t.trim().toUpperCase();
    if (!symbol) continue;
    const hit = c.bySymbol.get(symbol);
    if (hit) out.set(symbol, hit);
  }
  return out;
}
