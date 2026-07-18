/**
 * CRUD for per-ticker 6-Signal Resonance alerts.
 *
 * Structural mirror of `/api/technical-alerts` — the two features
 * share the same "daily digest + on-change" shape but persist to
 * separate tables (see `resonance_alerts` in `lib/db.ts`).
 *
 * GET                             — list every alert row
 * POST { ticker, dailyTime?,      — create or update a rule (idempotent
 *        timezone?, notifyOnChange?, upsert; safe to call repeatedly)
 *        minStrength? }
 * DELETE ?ticker=SYMBOL           — remove the rule
 *
 * Also exposes:
 *   POST /api/resonance-alerts/test — send a one-off test digest for
 *   the current ticker's live resonance snapshot, so users can
 *   validate their setup without waiting for the next daily-time
 *   tick.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";
import {
  deleteResonanceAlert,
  listResonanceAlerts,
  upsertResonanceAlert,
} from "@/lib/resonance-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  minStrength: z.enum(["all", "trigger_only", "strong_only"]).optional(),
});

export async function GET() {
  return NextResponse.json({ alerts: listResonanceAlerts() });
}

export async function POST(req: Request) {
  try {
    const parsed = upsertSchema.parse(await req.json());
    const alert = upsertResonanceAlert({
      ticker: parsed.ticker,
      dailyTime: parsed.dailyTime,
      timezone: parsed.timezone,
      notifyOnChange: parsed.notifyOnChange,
      minStrength: parsed.minStrength,
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
    const ok = deleteResonanceAlert(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
