/**
 * `GET /api/signal/backtest/history/[id]` — load one saved run with
 * its full result blob.
 * `DELETE /api/signal/backtest/history/[id]` — delete one saved run.
 *
 * The GET response mirrors the shape POST /api/signal/backtest
 * returns for a fresh run, so the /backtest page can render either
 * source through the same UI without branching.
 */

import { NextResponse } from "next/server";
import { deleteRun, getRun } from "@/lib/backtest-store";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error("id must be a positive integer");
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error("id must be a positive integer");
  return n;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = parseId(params.id);
    const run = getRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    // Response envelope matches what the fresh-run POST returns
    // (minus `savedId`, which is trivially `run.id` here). That way
    // the /backtest page's rendering path is one function regardless
    // of whether the run came off the wire or out of the DB.
    return NextResponse.json({
      ok: true,
      ticker: run.ticker,
      strategy: run.strategy,
      execution: run.execution,
      sizing: run.config.sizing,
      startingCash: run.startingCash,
      period: run.period,
      firstBarAt: run.firstBarAt,
      lastBarAt: run.lastBarAt,
      result: run.result,
      savedId: run.id,
      label: run.label,
      createdAt: run.createdAt,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = parseId(params.id);
    deleteRun(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
