import { NextResponse } from "next/server";
import { z } from "zod";
import { addWatchlist, listWatchlist, removeWatchlist } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: listWatchlist() });
}

const addSchema = z.object({
  symbol: z.string().min(1).max(20),
  displayName: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const body = addSchema.parse(await req.json());
    addWatchlist(body.symbol, body.displayName);
    return NextResponse.json({ ok: true, entries: listWatchlist() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ ok: false, error: "symbol required" }, { status: 400 });
  }
  try {
    removeWatchlist(symbol);
    return NextResponse.json({ ok: true, entries: listWatchlist() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
