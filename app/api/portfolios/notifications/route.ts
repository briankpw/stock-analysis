/**
 * Portfolio notification history + poller controls.
 *
 * GET                 — list recent notifications + tick state
 * POST { action:'run' } — kick off a portfolio tick right now
 * POST { action:'clear' } — delete every stored notification
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearNotifications,
  recentNotifications,
} from "@/lib/portfolio-watch/store";
import {
  getPortfolioTickState,
  runPortfolioTick,
} from "@/lib/portfolio-watch/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["run", "clear"]),
});

export async function GET() {
  const state = getPortfolioTickState();
  return NextResponse.json({
    ...state,
    notifications: recentNotifications(200),
  });
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    if (body.action === "run") {
      const report = await runPortfolioTick();
      return NextResponse.json({ ok: true, report });
    }
    // clear
    const removed = clearNotifications();
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
