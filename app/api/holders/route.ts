import { NextResponse } from "next/server";
import { fetchHolders, RateLimitedError } from "@/lib/data";
import { settings } from "@/lib/config";

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
      return NextResponse.json({ rateLimited: true, error: e.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
