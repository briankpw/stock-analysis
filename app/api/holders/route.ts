import { NextResponse } from "next/server";
import { fetchHolders, RateLimitedError } from "@/lib/data";
import { settings } from "@/lib/config";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the "who holds this stock" payload: insider roster + insider
 * transactions (internal) plus institutional and mutual-fund holders
 * (external), with the aggregate breakdown card + rolling net purchase
 * activity block on top.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? settings.ticker).toUpperCase();

  try {
    const holders = await fetchHolders(ticker);
    return NextResponse.json(holders);
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json(
        { rateLimited: true, error: "Upstream rate-limited" },
        { status: 429 },
      );
    }
    const r = redactError(e, 502, "Holders data unavailable");
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
