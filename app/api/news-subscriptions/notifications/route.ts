/**
 * News notification history + poller controls.
 *
 * GET                    — list recent news notifications + tick state
 * POST { action:'run' }  — kick off a news tick right now
 * POST { action:'clear' } — delete every stored news notification
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearNewsNotifications,
  recentNewsNotifications,
} from "@/lib/news-watch/store";
import {
  getNewsTickState,
  runNewsTick,
} from "@/lib/news-watch/engine";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["run", "clear"]),
});

export async function GET() {
  const state = getNewsTickState();
  return NextResponse.json({
    ...state,
    notifications: recentNewsNotifications(200),
  });
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    if (body.action === "run") {
      const report = await runNewsTick();
      return NextResponse.json({ ok: true, report });
    }
    const removed = clearNewsNotifications();
    return NextResponse.json({ ok: true, removed });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
