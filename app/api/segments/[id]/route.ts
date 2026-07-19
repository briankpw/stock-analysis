import { NextResponse } from "next/server";

import { fetchHistory, fetchQuote, RateLimitedError } from "@/lib/data";
import { enrich, latestSignals, type LatestSignals } from "@/lib/indicators";
import { redactError } from "@/lib/http";
import { findSegment } from "@/lib/segments";
import { computeTechnicalSignal, type TechnicalSignal } from "@/lib/technical-signal";
import { computeResonance, type ResonanceResult } from "@/lib/resonance";
import { mapConcurrent } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Segment detail endpoint — feeds /market/segments/[id].
 *
 * For a single segment we return:
 *   * a *rich* technical signal for the proxy ETF (same shape the
 *     Price & Volume page uses on individual tickers — so the segment
 *     view shares its full scorecard/heatmap) so the caller can render
 *     the existing `<TechnicalSignalCard>` component verbatim.
 *   * a compact `constituents[]` list — one `latestSignals` per member
 *     ticker so the UI can show a sortable "who's in this bucket"
 *     table. History is fetched at 6-month resolution to keep the
 *     round-trip cheap.
 *
 * Everything is best-effort: any single ticker that Yahoo throttles
 * comes back with `status: "error"` and the rest of the payload still
 * lands. `Promise.allSettled` semantics — never fails the outer request
 * because of a partial upstream outage.
 */

const HISTORY_PERIOD_PROXY = "1y"; // proxy ETF: full year for stable SMA200
const HISTORY_PERIOD_MEMBER = "6mo"; // members: 6 months is plenty for RSI + short trends
const HISTORY_INTERVAL = "1d";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface QuoteLite {
  ticker: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** Regular-session share volume — used by the constituent heatmap. */
  volume: number | null;
  /** Market cap in the security's own currency. Null for ETFs/indices. */
  marketCap: number | null;
}

export interface ConstituentRow {
  ticker: string;
  quote: QuoteLite | null;
  signals: LatestSignals | null;
  stance: "bullish" | "bearish" | "neutral";
  status: "ok" | "error";
  error?: string;
}

export interface SegmentDetailResponse {
  id: string;
  name: string;
  nameZh?: string;
  description: string;
  descriptionZh?: string;
  proxy: {
    ticker: string;
    name: string;
    quote: QuoteLite | null;
    signals: LatestSignals | null;
    signal: TechnicalSignal | null;
    /**
     * 6-Signal Resonance evaluated on the proxy ETF's daily bars. Same
     * shape as the per-stock resonance shown on `/overview` so the UI
     * can render the shared `<ResonanceCard>` verbatim. `null` when the
     * proxy fetch failed or fewer than ~40 bars are available.
     */
    resonance: ResonanceResult | null;
    stance: "bullish" | "bearish" | "neutral";
    status: "ok" | "error";
    error?: string;
  };
  constituents: ConstituentRow[];
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

async function computeConstituent(ticker: string): Promise<ConstituentRow> {
  try {
    const [bars, quote] = await Promise.all([
      fetchHistory(ticker, HISTORY_PERIOD_MEMBER, HISTORY_INTERVAL),
      fetchQuote(ticker).catch(() => null),
    ]);
    if (bars.length === 0) {
      return {
        ticker,
        quote: null,
        signals: null,
        stance: "neutral",
        status: "error",
        error: "no data",
      };
    }
    const enriched = enrich(bars);
    const signals = latestSignals(enriched);
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
    return {
      ticker,
      quote: quoteLite,
      signals,
      stance: stanceFromTrend(signals.trend),
      status: "ok",
    };
  } catch (err) {
    const msg = err instanceof RateLimitedError
      ? "rate-limited"
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      ticker,
      quote: null,
      signals: null,
      stance: "neutral",
      status: "error",
      error: msg,
    };
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const seg = findSegment(id);
  if (!seg) {
    return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  }

  try {
    // Proxy ETF: full technical signal (used by <TechnicalSignalCard>).
    const proxyP = (async () => {
      try {
        const [bars, quote] = await Promise.all([
          fetchHistory(seg.proxyEtf, HISTORY_PERIOD_PROXY, HISTORY_INTERVAL),
          fetchQuote(seg.proxyEtf).catch(() => null),
        ]);
        if (bars.length === 0) {
          return {
            ticker: seg.proxyEtf,
            name: seg.proxyEtfName,
            quote: null,
            signals: null,
            signal: null,
            resonance: null,
            stance: "neutral" as const,
            status: "error" as const,
            error: "no data",
          };
        }
        const enriched = enrich(bars);
        const signals = latestSignals(enriched);
        const signal = computeTechnicalSignal({
          bars: enriched.bars,
          sma50: enriched.sma50,
          sma200: enriched.sma200,
          rsi14: enriched.rsi14,
          macd: enriched.macd,
          bb20: enriched.bb20,
          levels: enriched.levels,
          kdj: enriched.kdj,
        });
        // Sector-level 6-Signal Resonance — same pure computation the
        // Overview page runs on individual tickers, applied here to the
        // proxy ETF's daily bars. That gives a single "is this whole
        // theme momentum-aligned right now?" verdict, complementing the
        // classic multi-indicator signal above.
        const resonance = computeResonance(enriched.bars);
        const lastBarVolume = bars[bars.length - 1]?.volume ?? null;
        const quoteLite: QuoteLite = quote
          ? {
              ticker: seg.proxyEtf,
              price: quote.price,
              change: quote.change,
              changePercent: quote.changePercent,
              volume: quote.volume ?? lastBarVolume,
              marketCap: quote.marketCap,
            }
          : {
              ticker: seg.proxyEtf,
              price: signals.lastClose,
              change: signals.lastChange,
              changePercent: signals.lastChangePercent,
              volume: lastBarVolume,
              marketCap: null,
            };
        return {
          ticker: seg.proxyEtf,
          name: seg.proxyEtfName,
          quote: quoteLite,
          signals,
          signal,
          resonance,
          stance: stanceFromTrend(signals.trend),
          status: "ok" as const,
        };
      } catch (err) {
        const msg = err instanceof RateLimitedError
          ? "rate-limited"
          : err instanceof Error
            ? err.message
            : String(err);
        return {
          ticker: seg.proxyEtf,
          name: seg.proxyEtfName,
          quote: null,
          signals: null,
          signal: null,
          resonance: null,
          stance: "neutral" as const,
          status: "error" as const,
          error: msg,
        };
      }
    })();

    // Members in **bounded** parallel — the naive `Promise.all` fires
    // one Yahoo call per member simultaneously, and the largest
    // segments hold 100+ tickers (Semiconductors, Software, etc.).
    // That reliably trips Yahoo's per-IP throttle, cascades to a page
    // of "rate-limited" rows, and (because these routes share the
    // same client) also starves any concurrent quote/detail request
    // the user might have in flight. Capping at 6 in-flight matches
    // the browser's per-origin socket limit and empirically avoids
    // the 429 storm while still finishing a 100-ticker segment in
    // <5s over a warm cache. `computeConstituent` never rejects so
    // this call can't throw.
    const MEMBER_CONCURRENCY = 6;
    const membersP = mapConcurrent(
      seg.tickers,
      computeConstituent,
      MEMBER_CONCURRENCY,
    );

    const [proxy, constituents] = await Promise.all([proxyP, membersP]);

    const body: SegmentDetailResponse = {
      id: seg.id,
      name: seg.name,
      nameZh: seg.nameZh,
      description: seg.description,
      descriptionZh: seg.descriptionZh,
      proxy,
      constituents,
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body);
  } catch (e) {
    const r = redactError(e, 500);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
