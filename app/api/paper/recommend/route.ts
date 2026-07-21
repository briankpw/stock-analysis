import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchBundle } from "@/lib/data";
import { enrich, latestSignals } from "@/lib/indicators";
import { getPortfolio, listPortfolios } from "@/lib/paper-trading";
import { recommendTargets } from "@/lib/target-recommender";
import { settings } from "@/lib/config";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/paper/recommend?symbol=XXX`
 *
 * Returns a data-driven stop-loss / take-profit suggestion for the
 * caller's existing paper position in `symbol`. Blends:
 *   - the position's avgCost (looked up server-side so it can't be forged)
 *   - the last ATR(14) reading (volatility budget for the stop)
 *   - latest trend classification (bullish / bearish / sideways)
 *   - the strongest support/resistance levels that flank avgCost
 *
 * We compute this on the server because (a) the client already fetches a
 * bundle for the *currently-selected* ticker via `useBundle`, but the
 * paper page may have positions across several symbols — one round-trip
 * per position from the client is silly when the server can do it once.
 */

const querySchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
  // Optional — omit to fall back to the first active portfolio. Same
  // resolution rule as GET /api/paper. Kept optional (rather than
  // required) so the pre-v15 client that doesn't know about
  // portfolioId still works.
  portfolioId: z.number().int().positive().optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawPortfolioId = url.searchParams.get("portfolioId");
    const { symbol, portfolioId } = querySchema.parse({
      symbol: (url.searchParams.get("symbol") ?? "").toUpperCase(),
      portfolioId:
        rawPortfolioId && /^\d+$/.test(rawPortfolioId)
          ? Number(rawPortfolioId)
          : undefined,
    });

    // Resolve the avgCost from the ledger — never trust a client-supplied
    // basis. If the caller has no position, we can still recommend
    // targets around the *current price* by treating it as a proposed
    // entry basis; this makes the endpoint useful before opening a trade
    // as well as after.
    const all = listPortfolios();
    if (all.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No portfolios exist" },
        { status: 500 },
      );
    }
    const resolvedId =
      (portfolioId !== undefined && all.some((p) => p.id === portfolioId)
        ? portfolioId
        : all[0]!.id);
    const portfolio = getPortfolio(resolvedId);
    const existing = portfolio.positions.find(
      (p) => p.symbol.toUpperCase() === symbol,
    );

    const bundle = await fetchBundle(
      symbol,
      settings.defaultPeriod,
      settings.defaultInterval,
    );

    if (bundle.bars.length < 20) {
      // Too little history for a meaningful ATR — bail early and let the
      // client fall back to the static presets. Returning 200 with
      // `basis` in a stub state would silently mislead users.
      return NextResponse.json(
        {
          ok: false,
          error: "Not enough price history to compute a recommendation.",
        },
        { status: 422 },
      );
    }

    // Enrich once — gives us ATR, support/resistance, and trend
    // classification in a single pass (matches what the /charts page
    // already does client-side).
    const enriched = enrich(bundle.bars);
    const lastClose = bundle.bars[bundle.bars.length - 1]?.close;
    const avgCost =
      existing?.avgCost ?? bundle.quote.price ?? lastClose ?? 0;

    // Pick the last non-null ATR reading. Wilder smoothing produces
    // trailing nulls only for insufficient-history windows, but be
    // defensive anyway.
    let atr14: number | null = null;
    for (let i = enriched.atr14.length - 1; i >= 0; i--) {
      const v = enriched.atr14[i];
      if (v !== null && Number.isFinite(v)) {
        atr14 = v;
        break;
      }
    }

    const signals = latestSignals(enriched);

    const rec = recommendTargets({
      avgCost,
      atr14,
      trendLabel: signals?.trend ?? null,
      supports: enriched.levels.support,
      resistances: enriched.levels.resistance,
    });

    return NextResponse.json({
      ok: true,
      symbol,
      avgCost,
      currentPrice: bundle.quote.price ?? lastClose ?? null,
      hasPosition: !!existing,
      recommendation: rec,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
