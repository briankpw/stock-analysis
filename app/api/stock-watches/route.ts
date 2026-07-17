/**
 * CRUD for per-ticker insider-transaction watches.
 *
 * GET                       — list every active stock watch (with resolved CIK)
 * POST { ticker, actions? } — upsert; attempts CIK resolution up front
 * DELETE ?ticker=SYMBOL     — delete by ticker
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ALL_ACTIONS,
  deleteStockWatch,
  listStockWatches,
  upsertStockWatch,
} from "@/lib/stock-watch/store";
import { resolveTickerCik } from "@/lib/stock-watch/ticker-cik";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.enum(["BUY", "SELL"]);

const upsertSchema = z.object({
  ticker: z.string().min(1).max(12),
  actions: z.array(actionSchema).min(1).optional(),
});

export async function GET() {
  return NextResponse.json({ watches: listStockWatches() });
}

export async function POST(req: Request) {
  try {
    const body = upsertSchema.parse(await req.json());
    const actions = body.actions ?? ALL_ACTIONS;
    // Try to resolve CIK up front so first-tick doesn't have to. A
    // failure here is non-fatal — we still save the watch with a null
    // CIK and the engine will keep retrying on subsequent ticks.
    let cik: string | null = null;
    try {
      const hit = await resolveTickerCik(body.ticker);
      cik = hit?.cik ?? null;
    } catch {
      cik = null;
    }
    const watch = upsertStockWatch(body.ticker, actions, cik);
    return NextResponse.json({
      ok: true,
      watch,
      cikResolved: cik !== null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  try {
    if (!ticker) throw new Error("ticker required");
    const ok = deleteStockWatch(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
