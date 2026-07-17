import { NextResponse } from "next/server";
import { fetchBundle } from "@/lib/data";
import { enrich, latestSignals } from "@/lib/indicators";
import { allGroups } from "@/lib/ratios";
import { analyze } from "@/lib/insights";
import { settings } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The "everything the Overview / Ratios pages need" aggregator. One call =
 * quote + info + bars + indicator series + ratio groups + insights verdict.
 * The client caches this response and reuses it across pages within the
 * same ticker/period/interval scope.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? settings.ticker).toUpperCase();
  const period = url.searchParams.get("period") ?? settings.defaultPeriod;
  const interval = url.searchParams.get("interval") ?? settings.defaultInterval;

  try {
    const bundle = await fetchBundle(ticker, period, interval);
    const enriched = enrich(bundle.bars);
    const signals = bundle.bars.length ? latestSignals(enriched) : null;
    const groups = allGroups(bundle.info, bundle.bars);
    const analysis = analyze(ticker, bundle.info, bundle.bars, signals);

    // Trim payload: don't send the info blob as-is (it can be ~30kB); the UI
    // only reads a well-known subset via `groups`.
    return NextResponse.json({
      ticker,
      period,
      interval,
      quote: bundle.quote,
      bars: bundle.bars,
      indicators: {
        sma20: enriched.sma20,
        sma50: enriched.sma50,
        sma200: enriched.sma200,
        ema20: enriched.ema20,
        ema24: enriched.ema24,
        ema52: enriched.ema52,
        ema200: enriched.ema200,
        rsi14: enriched.rsi14,
        macd: enriched.macd,
        bb20: enriched.bb20,
        returns: enriched.returns,
        levels: enriched.levels,
        kdj: enriched.kdj,
      },
      signals,
      groups,
      analysis,
      rateLimited: bundle.rateLimited,
      fetchedAt: bundle.fetchedAt,
      companyName: bundle.info.longName ?? bundle.info.shortName ?? ticker,
      sector: bundle.info.sector ?? null,
      industry: bundle.info.industry ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
