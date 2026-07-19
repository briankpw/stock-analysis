import { NextResponse } from "next/server";
import {
  DataSourceUnavailableError,
  searchEntities,
} from "@/lib/portfolios";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Type-ahead search for a name → filer entity. Backs the "Add a
 * person / fund / politician" dialogs on the Portfolios page so users
 * don't have to hand-look-up CIKs or memorise the exact spelling on
 * the House Clerk feed.
 *
 *   GET /api/portfolios/search?q=<name>&kind=person|fund|politician
 *
 * Returns:
 *   { results: EntitySearchResult[] }
 *
 * `q` shorter than 2 chars returns an empty list rather than 400 so
 * the client can call this cheaply on every keystroke. `person` and
 * `fund` hit SEC EDGAR's full-text search; `politician` hits the
 * (already-cached) House Clerk XML feed, so politician searches are
 * essentially instant after the first hit warms the cache.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const kind = url.searchParams.get("kind") ?? "person";
  if (kind !== "person" && kind !== "fund" && kind !== "politician") {
    return NextResponse.json(
      { error: "kind must be one of person|fund|politician" },
      { status: 400 },
    );
  }
  try {
    const results = await searchEntities(q, kind);
    return NextResponse.json({ results });
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
    const r = redactError(e, 502, "Search source unavailable");
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
