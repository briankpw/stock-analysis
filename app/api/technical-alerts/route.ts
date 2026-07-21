/**
 * CRUD for per-ticker technical-signal alerts.
 *
 * GET                             — list every alert row
 * POST { ticker, dailyTime?,      — create or update a rule (idempotent
 *        timezone?, notifyOnChange?, upsert; safe to call repeatedly)
 *        minStrength? }
 * DELETE ?ticker=SYMBOL           — remove the rule
 *
 * Also exposes:
 *   POST /api/technical-alerts/test — send a one-off test notification for
 *   the current ticker's live signal, so users can validate their setup
 *   without waiting for the next daily-time tick.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";
import {
  deleteTechnicalAlert,
  listTechnicalAlerts,
  upsertTechnicalAlert,
} from "@/lib/technical-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client sends camelCase; the store also normalises so double-safety.
const upsertSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "ticker must be alphanumeric with `.-`"),
  dailyTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "dailyTime must be HH:MM (24-hour)")
    .nullable()
    .optional(),
  timezone: z.string().min(1).max(64).optional(),
  notifyOnChange: z.boolean().optional(),
  minStrength: z.enum(["all", "buy_sell", "strong_only"]).optional(),
  frequency: z.enum(["always", "daily", "once"]).optional(),
});

export async function GET() {
  return NextResponse.json({ alerts: listTechnicalAlerts() });
}

export async function POST(req: Request) {
  try {
    const parsed = upsertSchema.parse(await req.json());
    const alert = upsertTechnicalAlert({
      ticker: parsed.ticker,
      dailyTime: parsed.dailyTime,
      timezone: parsed.timezone,
      notifyOnChange: parsed.notifyOnChange,
      minStrength: parsed.minStrength,
      frequency: parsed.frequency,
    });
    return NextResponse.json({ ok: true, alert });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  try {
    if (!ticker) throw new Error("ticker required");
    const ok = deleteTechnicalAlert(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
