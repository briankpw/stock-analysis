/**
 * CNN Fear & Greed Index fetch + in-process cache.
 *
 * Extracted from `app/api/fear-greed/route.ts` so the master-verdict
 * watch engine (running in the worker process) can consume the same
 * data without going through the Next.js HTTP layer. The two runtimes
 * each keep their own module-scope cache; that's fine because CNN
 * only updates the index once per US-market business day, so an
 * occasional duplicate fetch is inexpensive.
 *
 * The route module continues to be the *sole* public HTTP surface —
 * it now just imports from here and adapts the response shape. Any
 * server-side caller (worker, batch job, other route) should import
 * `getFearGreedScore()` directly rather than round-tripping through
 * `fetch("/api/fear-greed")`.
 */

import { timedFetch } from "@/lib/http";

const CNN_URL =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Chrome-ish. The CNN endpoint gates on User-Agent shape more than
// the exact value, but sending a plausible browser string keeps us
// from getting the "I'm a teapot" bot response.
const HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://edition.cnn.com",
  Referer: "https://edition.cnn.com/",
};

export type FearGreedRating =
  | "extreme fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme greed";

interface CnnIndicator {
  score: number;
  rating: FearGreedRating;
  timestamp?: string;
}

/**
 * Raw CNN payload — the endpoint publishes far more data than we
 * expose. Only the fields we surface are typed here; the rest is
 * ignored.
 */
export interface CnnPayload {
  fear_and_greed: {
    score: number;
    rating: FearGreedRating;
    timestamp: string;
    previous_close: number;
    previous_1_week: number;
    previous_1_month: number;
    previous_1_year: number;
  };
  market_momentum_sp500: CnnIndicator;
  market_momentum_sp125: CnnIndicator;
  stock_price_strength: CnnIndicator;
  stock_price_breadth: CnnIndicator;
  put_call_options: CnnIndicator;
  market_volatility_vix: CnnIndicator;
  market_volatility_vix_50: CnnIndicator;
  junk_bond_demand: CnnIndicator;
  safe_haven_demand: CnnIndicator;
}

let _cache: { payload: CnnPayload; expiresAt: number } | null = null;

/**
 * Fetch the raw CNN payload with in-process caching. Returns the
 * cached copy if it's still fresh; otherwise hits CNN and updates
 * the cache. Throws on any HTTP/network error — the caller decides
 * whether to swallow (score becomes `null` for the master verdict)
 * or surface (the API route returns a 502).
 */
export async function fetchFearGreedPayload(): Promise<CnnPayload> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) return _cache.payload;
  const res = await timedFetch(CNN_URL, {
    headers: HEADERS,
    cache: "no-store",
    timeoutMs: 15_000,
  });
  if (!res.ok) {
    throw new Error(`CNN responded ${res.status}`);
  }
  const raw = (await res.json()) as CnnPayload;
  _cache = { payload: raw, expiresAt: now + CACHE_TTL_MS };
  return raw;
}

/**
 * The score is the only thing the master verdict needs, so we expose
 * a convenience wrapper that returns `null` on failure. Anything
 * that wants the full payload should call `fetchFearGreedPayload()`
 * and handle its own errors.
 */
export async function getFearGreedScore(): Promise<number | null> {
  try {
    const raw = await fetchFearGreedPayload();
    const s = raw.fear_and_greed.score;
    return Number.isFinite(s) ? s : null;
  } catch {
    return null;
  }
}
