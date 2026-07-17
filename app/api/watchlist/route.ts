import { NextResponse } from "next/server";
import { z } from "zod";
import { addWatchlist, listWatchlist, removeWatchlist } from "@/lib/watchlist";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ entries: listWatchlist() });
}

const addSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
  displayName: z.string().max(120).optional(),
});

export async function POST(req: Request) {
  try {
    const body = addSchema.parse(await req.json());
    addWatchlist(body.symbol, body.displayName);
    return NextResponse.json({ ok: true, entries: listWatchlist() });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
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
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
