import { NextResponse } from "next/server";
import {
  DataSourceUnavailableError,
  fetchFund13F,
  fetchPersonInsiderReport,
  fetchPoliticianTrades,
  listPresets,
} from "@/lib/portfolios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unified "portfolios" endpoint — four modes:
 *
 *   GET /api/portfolios                              → preset chooser (politicians + funds + people)
 *   GET /api/portfolios?type=politician&id=pelosi    → politician trades
 *   GET /api/portfolios?type=fund&id=berkshire       → fund 13F holdings
 *   GET /api/portfolios?type=person&id=musk          → individual's Form 3/4/5 insider holdings
 *
 * Everything is cached server-side; see `lib/portfolios.ts`.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.max(10, Math.min(500, Number(limitRaw))) : 200;

  try {
    if (!type) {
      return NextResponse.json(listPresets());
    }
    if (!id) {
      return NextResponse.json({ error: "id query param required" }, { status: 400 });
    }
    if (type === "politician") {
      const report = await fetchPoliticianTrades(id, limit);
      return NextResponse.json(report);
    }
    if (type === "fund") {
      const report = await fetchFund13F(id);
      return NextResponse.json(report);
    }
    if (type === "person") {
      // Person route uses a tighter default (30) — each filing is one SEC XML
      // fetch, so we cap harder than the politician case.
      const personLimit = limitRaw ? Math.max(5, Math.min(120, Number(limitRaw))) : 30;
      const report = await fetchPersonInsiderReport(id, personLimit);
      return NextResponse.json(report);
    }
    return NextResponse.json({ error: `unknown type: ${type}` }, { status: 400 });
  } catch (e) {
    if (e instanceof DataSourceUnavailableError) {
      return NextResponse.json(
        {
          error: e.message,
          sourceUnavailable: true,
          source: e.source,
          lastStatus: e.lastStatus,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
