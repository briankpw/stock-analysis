/**
 * Stock notification history + poller controls.
 *
 * GET                    — list recent stock insider notifications + tick state
 * POST { action:'run' }  — kick off a stock tick right now
 * POST { action:'clear' } — delete every stored stock notification
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearStockNotifications,
  recentStockNotifications,
} from "@/lib/stock-watch/store";
import {
  getStockTickState,
  runStockTick,
} from "@/lib/stock-watch/engine";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["run", "clear"]),
});

export async function GET() {
  const state = getStockTickState();
  return NextResponse.json({
    ...state,
    notifications: recentStockNotifications(200),
  });
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    if (body.action === "run") {
      const report = await runStockTick();
      return NextResponse.json({ ok: true, report });
    }
    const removed = clearStockNotifications();
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
