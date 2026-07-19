import { NextResponse } from "next/server";
import { listPresets } from "@/lib/portfolios";
import {
  DataSourceUnavailableError,
  getCachedFund,
  getCachedPerson,
  getCachedPolitician,
  type CachedPayload,
} from "@/lib/portfolios-cache/coordinator";
import { redactError } from "@/lib/http";

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
 * Detail reads (`type=…`) go through the SQLite-backed
 * stale-while-revalidate coordinator in `lib/portfolios-cache/`
 * so a cold cache is a one-time cost per (kind, id) pair — every
 * subsequent visit returns instantly and, if the freshness
 * window has expired, kicks off a fire-and-forget background
 * refresh. The background bot worker also walks visited rows and
 * refreshes them on its own cadence, so a truly idle app stays
 * warm.
 *
 * Response shape for detail reads gains a `_cache` sidecar with
 * `fetchedAt` / `stale` / `lastError` so the client can render
 * an "as of X" hint without another request. The main report
 * payload lives at the root, unchanged.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  const limitRaw = url.searchParams.get("limit");
  // `Number("junk")` is NaN; treat that as "use default" instead of letting
  // NaN propagate down to `.slice(0, NaN)` and return empty results silently.
  const parsedLimit = limitRaw !== null ? Number(limitRaw) : NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(10, Math.min(500, parsedLimit))
    : 200;

  try {
    if (!type) {
      return NextResponse.json(listPresets());
    }
    if (!id) {
      return NextResponse.json({ error: "id query param required" }, { status: 400 });
    }
    // Preset ids are `[a-z0-9_-]+` (see /presets validation) — validate here
    // too so a malformed id never becomes part of an SEC URL.
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    if (type === "politician") {
      const cached = await getCachedPolitician(id, limit);
      return NextResponse.json(withCacheEnvelope(cached));
    }
    if (type === "fund") {
      const cached = await getCachedFund(id);
      return NextResponse.json(withCacheEnvelope(cached));
    }
    if (type === "person") {
      // Person route uses a tighter default (30) — each filing is one SEC XML
      // fetch, so we cap harder than the politician case.
      const personLimit = Number.isFinite(parsedLimit)
        ? Math.max(5, Math.min(120, parsedLimit))
        : 30;
      const cached = await getCachedPerson(id, personLimit);
      return NextResponse.json(withCacheEnvelope(cached));
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
    const r = redactError(e, 502, "Portfolio data unavailable");
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}

/**
 * Flattens the cached payload back to its original shape at the
 * top level while tucking cache metadata under `_cache`. This
 * keeps the existing client code (which expects the report's
 * fields at the root — `data.filings`, `data.holdings`, etc.) as
 * a zero-cost migration; the client can start reading `_cache`
 * later when it wants to render the "cached, refreshing in
 * background" hint.
 */
function withCacheEnvelope<T extends object>(
  cached: CachedPayload<T>,
): T & { _cache: CachedPayload<T>["meta"] } {
  return { ...cached.payload, _cache: cached.meta };
}
