import { NextResponse } from "next/server";

import { fetchHistory, fetchQuote, RateLimitedError } from "@/lib/data";
import { enrich, latestSignals, type LatestSignals } from "@/lib/indicators";
import { redactError } from "@/lib/http";
import { SEGMENTS, INDICES } from "@/lib/segments";
import { mapConcurrent } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Segments overview endpoint — feeds the /market/segments grid.
 *
 * Each segment's health is read off its proxy ETF via the same
 * `latestSignals(enrich(bars))` pipeline the Overview page uses, so the
 * verdict lines up with the Buy/Sell chip a user would see if they
 * pinned the ETF as their ticker.
 *
 * Cost is bounded: N segments × 2 Yahoo calls (history + quote), all
 * cache-friendly (15-min TTL in `lib/data.ts`). We call them in parallel
 * with `Promise.allSettled` so one rate-limited ticker doesn't sink the
 * whole payload — failed rows come back with `status: "error"` so the
 * UI can render a "—" cell instead of a wall of red.
 */

const HISTORY_PERIOD = "1y";
const HISTORY_INTERVAL = "1d";

// ---------------------------------------------------------------------------
// Response shape (kept aligned with the client)
// ---------------------------------------------------------------------------

export interface QuoteLite {
  ticker: string;
  price: number | null;
  change: number | null;
  changePercent: number | null; // fraction, e.g. 0.0132 = +1.32%
  /** Regular-session share volume. Feeds the "size by volume" heatmap
   * option; null when Yahoo omitted it (after-hours, indices). */
  volume: number | null;
  /** Market cap in the security's own currency. Null for indices/ETFs
   * that Yahoo doesn't report a cap for. */
  marketCap: number | null;
}

export interface SegmentSummary {
  id: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  proxyEtf: string;
  proxyEtfName: string;
  tickerCount: number;
  quote: QuoteLite | null;
  signals: LatestSignals | null;
  /** "bullish" | "bearish" | "neutral" — derived from `signals.trend`. */
  stance: "bullish" | "bearish" | "neutral";
  /** Rate-limited or otherwise failed to fetch. */
  status: "ok" | "error";
  error?: string;
}

/**
 * How to translate an index's raw price trend into an equity-portfolio
 * stance:
 *   `direct`   — chip matches the raw trend. Standard for equity
 *                indices (S&P, Nasdaq, DJI, HSI, DAX, etc.).
 *   `inverted` — raw trend is flipped before display. Applies to
 *                gauges whose price direction is negatively correlated
 *                with equity performance: VIX (fear index), 10Y
 *                Treasury yield (discount rate), DXY (dollar strength
 *                is a headwind for commodities and multinationals).
 *   `mixed`    — chip shows raw trend, but the interpretation is
 *                context-dependent — good for some sectors, bad for
 *                others. Gold (fear/inflation), WTI Crude (helps
 *                energy, hurts consumer/travel), Bitcoin (risk-on
 *                barometer that trades on its own dynamics). The UI
 *                should surface a tooltip so users don't misread the
 *                chip as a universal buy/sell.
 */
export type StanceMode = "direct" | "inverted" | "mixed";

export interface IndexSummary {
  id: string;
  ticker: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  quote: QuoteLite | null;
  signals: LatestSignals | null;
  /**
   * Equity-portfolio stance — already reflects `stanceMode`. Consumers
   * can read this directly without knowing about the inversion.
   */
  stance: "bullish" | "bearish" | "neutral";
  /**
   * How the stance was derived from the raw price trend. Feeds the
   * UI's stance-chip tooltip so the user understands *why* rising
   * yields are labelled bearish and rising gold is labelled "mixed".
   */
  stanceMode: StanceMode;
  status: "ok" | "error";
  error?: string;
}

export interface SegmentsResponse {
  indices: IndexSummary[];
  segments: SegmentSummary[];
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stanceFromTrend(trend: string): "bullish" | "bearish" | "neutral" {
  if (trend === "Bullish uptrend") return "bullish";
  if (trend === "Bearish downtrend") return "bearish";
  return "neutral";
}

/**
 * Table of stance-interpretation modes per index ticker. Anything not
 * listed here (all equity indices — S&P, Nasdaq, DJI, HSI, etc.)
 * defaults to `"direct"` in `stanceModeFor`.
 *
 *   ^VIX      — inverted (rising fear = bearish for equity holders)
 *   ^TNX      — inverted (rising discount rate = valuation headwind)
 *   DX-Y.NYB  — inverted (strong dollar = EM + commodity + multinational drag)
 *   GC=F      — mixed (safe-haven bid; can rise on both fear and inflation)
 *   CL=F      — mixed (helps energy sector, hurts staples / travel /
 *              consumer discretionary via input costs)
 *   BTC-USD   — mixed (risk-on barometer but has its own liquidity /
 *              adoption cycle; not a clean equity proxy)
 */
const STANCE_MODE_OVERRIDES: Readonly<Record<string, StanceMode>> = {
  "^VIX": "inverted",
  "^TNX": "inverted",
  "DX-Y.NYB": "inverted",
  "GC=F": "mixed",
  "CL=F": "mixed",
  "BTC-USD": "mixed",
};

function stanceModeFor(ticker: string): StanceMode {
  return STANCE_MODE_OVERRIDES[ticker] ?? "direct";
}

/**
 * Apply `stanceMode` to the raw trend-derived stance. `direct` and
 * `mixed` pass through unchanged (the tooltip explains `mixed`);
 * `inverted` flips bullish/bearish. Neutral stays neutral in every
 * mode because "no clear trend" doesn't have a directional flip.
 */
function adjustStance(
  raw: "bullish" | "bearish" | "neutral",
  mode: StanceMode,
): "bullish" | "bearish" | "neutral" {
  if (mode !== "inverted" || raw === "neutral") return raw;
  return raw === "bullish" ? "bearish" : "bullish";
}

async function computeForTicker(ticker: string): Promise<{
  quote: QuoteLite | null;
  signals: LatestSignals | null;
  error?: string;
}> {
  try {
    // Yahoo is happier when history + quote are asked in parallel — both
    // round-trip through the same in-memory cache so a warm hit costs
    // roughly nothing.
    const [bars, quote] = await Promise.all([
      fetchHistory(ticker, HISTORY_PERIOD, HISTORY_INTERVAL),
      fetchQuote(ticker).catch(() => null),
    ]);
    if (bars.length === 0) {
      return { quote: null, signals: null, error: "no data" };
    }
    const enriched = enrich(bars);
    const signals = latestSignals(enriched);
    // Fallback volume when Yahoo's `quote()` omits it: use the latest
    // bar's volume (bars always carry it) so the heatmap still has a
    // sensible size to draw with after hours or on rate-limit fallback.
    const lastBarVolume = bars[bars.length - 1]?.volume ?? null;
    const quoteLite: QuoteLite = quote
      ? {
          ticker,
          price: quote.price,
          change: quote.change,
          changePercent: quote.changePercent,
          volume: quote.volume ?? lastBarVolume,
          marketCap: quote.marketCap,
        }
      : {
          ticker,
          price: signals.lastClose,
          change: signals.lastChange,
          changePercent: signals.lastChangePercent,
          volume: lastBarVolume,
          marketCap: null,
        };
    return { quote: quoteLite, signals };
  } catch (err) {
    const msg = err instanceof RateLimitedError
      ? "rate-limited"
      : err instanceof Error
        ? err.message
        : String(err);
    return { quote: null, signals: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Fan every segment + every index out with **bounded** parallelism.
    // `computeForTicker` already swallows its own errors, so the outer
    // gather can never reject — failed rows come back as
    // `{ status: "error" }` and render as a "—" cell.
    //
    // The naive `Promise.all(targets.map(computeForTicker))` would fire
    // one Yahoo Finance call per segment simultaneously (~30+ today),
    // which reliably trips Yahoo's per-IP throttle and cascades into a
    // page full of "rate-limited" tiles. Capping at 6 in-flight calls
    // matches the browser's per-origin socket limit and empirically
    // avoids the 429 storm while still finishing in <2s over a warm
    // cache.
    const segTargets = SEGMENTS.map((s) => s.proxyEtf);
    const indexTargets = INDICES.map((i) => i.ticker);
    const SEG_CONCURRENCY = 6;

    const [segResults, indexResults] = await Promise.all([
      mapConcurrent(segTargets, computeForTicker, SEG_CONCURRENCY),
      mapConcurrent(indexTargets, computeForTicker, SEG_CONCURRENCY),
    ]);

    const segments: SegmentSummary[] = SEGMENTS.map((seg, i) => {
      const r = segResults[i]!;
      const trend = r.signals?.trend ?? "Sideways";
      return {
        id: seg.id,
        name: seg.name,
        nameZh: seg.nameZh,
        description: seg.description,
        descriptionZh: seg.descriptionZh,
        proxyEtf: seg.proxyEtf,
        proxyEtfName: seg.proxyEtfName,
        tickerCount: seg.tickers.length,
        quote: r.quote,
        signals: r.signals,
        stance: stanceFromTrend(trend),
        status: r.signals ? "ok" : "error",
        error: r.error,
      };
    });

    const indices: IndexSummary[] = INDICES.map((ix, i) => {
      const r = indexResults[i]!;
      const trend = r.signals?.trend ?? "Sideways";
      // Interpret the raw price trend through the lens of an
      // equity-portfolio holder: VIX / 10Y yield / DXY are inverted
      // (rising = bad for stocks), Gold / Crude / Bitcoin are
      // labelled "mixed" so the UI can render a tooltip explaining
      // that the direction alone doesn't tell you whether it's good
      // or bad for your positions. Everything else (S&P, Nasdaq,
      // DAX, HSI, …) is a direct read.
      const mode = stanceModeFor(ix.ticker);
      const stance = adjustStance(stanceFromTrend(trend), mode);
      return {
        id: ix.id,
        ticker: ix.ticker,
        name: ix.name,
        nameZh: ix.nameZh,
        description: ix.description,
        descriptionZh: ix.descriptionZh,
        quote: r.quote,
        signals: r.signals,
        stance,
        stanceMode: mode,
        status: r.signals ? "ok" : "error",
        error: r.error,
      };
    });

    const body: SegmentsResponse = {
      indices,
      segments,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (e) {
    const r = redactError(e, 500);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
