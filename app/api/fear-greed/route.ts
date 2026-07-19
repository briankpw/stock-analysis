import { NextResponse } from "next/server";
import { redactError } from "@/lib/http";
import {
  fetchFearGreedWithProvenance,
  type CnnPayload,
  type FearGreedRating,
} from "@/lib/fear-greed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CNN Fear & Greed Index proxy.
 *
 * The fetch + cache logic lives in `lib/fear-greed.ts` so the master-
 * verdict worker engine can share the same code path without going
 * through this HTTP hop. This route only owns the *response-shaping*
 * side — mapping the raw CNN payload into the slim client-friendly
 * shape the /market page consumes.
 */

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
  /**
   * True when the response is served from the persistent
   * last-known-good store because CNN was unreachable / returned a
   * broken payload. Clients render a "stale" badge in this case.
   */
  stale: boolean;
  /**
   * Machine-readable reason we fell back, when we did (`"network"`,
   * `"http_error"`, `"schema_drift"`), otherwise `null`. Kept
   * separately from `stale` so telemetry can group failures without
   * parsing free-form strings.
   */
  fallbackReason: "network" | "http_error" | "schema_drift" | null;
}

function toSlim(
  raw: CnnPayload,
  provenance: {
    stale: boolean;
    fallbackReason: "network" | "http_error" | "schema_drift" | null;
  },
): FearGreedResponse {
  const ind = (
    key: string,
    v: { score: number; rating: FearGreedRating },
  ) => ({
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
    // `cached` reflects whether we served from the module-scope cache
    // on this exact call. We can't tell that from the library API
    // without leaking the timestamp; the library will already have
    // decided by the time the payload lands. As a proxy, expose
    // `false` here — clients treat this field as advisory only.
    cached: false,
    stale: provenance.stale,
    fallbackReason: provenance.fallbackReason,
  };
}

export async function GET() {
  try {
    const { payload, stale, fallbackReason } =
      await fetchFearGreedWithProvenance();
    return NextResponse.json(toSlim(payload, { stale, fallbackReason }));
  } catch (e) {
    const r = redactError(e, 502, "Fear & Greed source unavailable");
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
