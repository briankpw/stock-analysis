import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CNN Fear & Greed Index proxy.
 *
 * CNN publishes the raw data used by
 *   https://edition.cnn.com/markets/fear-and-greed
 * via an undocumented JSON endpoint on its dataviz CDN. The endpoint
 * requires browser-style headers (Origin/Referer + realistic User-Agent),
 * otherwise it returns "I'm a teapot. You're a bot."
 *
 * The Index only updates once per US-market business day, so we cache
 * responses in-process for 30 minutes to be a good citizen and avoid
 * chatty upstream fetches on repeated page loads.
 */

const CNN_URL =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const HEADERS: HeadersInit = {
  // Chrome-ish. The endpoint gates on User-Agent shape more than exact value.
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://edition.cnn.com",
  Referer: "https://edition.cnn.com/",
};

/** Ratings emitted by CNN. */
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

interface CnnPayload {
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

/** Slim, client-friendly response shape. */
export interface FearGreedResponse {
  score: number;
  rating: FearGreedRating;
  updatedAt: string;
  previous: {
    close: number;
    week: number;
    month: number;
    year: number;
  };
  indicators: Array<{
    key: string;
    score: number;
    rating: FearGreedRating;
  }>;
  source: string;
  fetchedAt: string;
  cached: boolean;
}

let _cache: { payload: FearGreedResponse; expiresAt: number } | null = null;

function toSlim(raw: CnnPayload): FearGreedResponse {
  const ind = (key: string, v: CnnIndicator) => ({
    key,
    score: v.score,
    rating: v.rating,
  });
  return {
    score: raw.fear_and_greed.score,
    rating: raw.fear_and_greed.rating,
    updatedAt: raw.fear_and_greed.timestamp,
    previous: {
      close: raw.fear_and_greed.previous_close,
      week: raw.fear_and_greed.previous_1_week,
      month: raw.fear_and_greed.previous_1_month,
      year: raw.fear_and_greed.previous_1_year,
    },
    indicators: [
      ind("market_momentum_sp500", raw.market_momentum_sp500),
      ind("stock_price_strength", raw.stock_price_strength),
      ind("stock_price_breadth", raw.stock_price_breadth),
      ind("put_call_options", raw.put_call_options),
      ind("market_volatility_vix", raw.market_volatility_vix),
      ind("junk_bond_demand", raw.junk_bond_demand),
      ind("safe_haven_demand", raw.safe_haven_demand),
    ],
    source: "https://edition.cnn.com/markets/fear-and-greed",
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

export async function GET() {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return NextResponse.json({ ..._cache.payload, cached: true });
  }

  try {
    const res = await fetch(CNN_URL, {
      headers: HEADERS,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `CNN responded ${res.status}` },
        { status: 502 },
      );
    }
    const raw = (await res.json()) as CnnPayload;
    const slim = toSlim(raw);
    _cache = { payload: slim, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json(slim);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
