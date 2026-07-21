/**
 * `GET /api/signal/backtest/history` — list persisted backtest runs.
 * `DELETE /api/signal/backtest/history` — wipe the entire history.
 *
 * Per-run reads (with the full result blob) live at the sibling
 * `[id]/route.ts` file so the URL structure mirrors REST convention
 * (`/history` = collection, `/history/{id}` = one item).
 *
 * The list response is a light `BacktestRunSummary[]`; the heavy
 * `result_json` blob stays in the DB until an individual run is
 * opened. That keeps the history page snappy even after many runs.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { clearHistory, listRuns } from "@/lib/backtest-store";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/)
    .optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = url.searchParams.get("limit");
    const query = listQuerySchema.parse({
      ticker: url.searchParams.get("ticker") ?? undefined,
      limit: rawLimit ? Number(rawLimit) : undefined,
    });
    const runs = listRuns({
      ticker: query.ticker,
      limit: query.limit,
    });
    return NextResponse.json({ runs });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}

export async function DELETE() {
  try {
    const deleted = clearHistory();
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
