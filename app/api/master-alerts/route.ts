/**
 * CRUD for per-ticker Master Verdict alerts.
 *
 * Structural mirror of `/api/technical-alerts` — same request/response
 * shapes, same validation rules, same idempotent upsert semantics.
 * Two separate endpoints (rather than a `source` query param on one)
 * keeps the two subsystems fully independent at the HTTP layer, so
 * the master + technical alerts can evolve their schemas without
 * bleeding into each other.
 *
 *   GET                             — list every alert row
 *   POST { ticker, dailyTime?, ... } — create or update a rule (upsert)
 *   DELETE ?ticker=SYMBOL           — remove the rule
 *
 * Companion:
 *   POST /api/master-alerts/test    — send a one-off digest for the
 *                                     current ticker's live verdict.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";
import {
  deleteMasterAlert,
  listMasterAlerts,
  upsertMasterAlert,
} from "@/lib/master-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Matches `/api/technical-alerts` schema — same client can build the
// same payload for either. Kept as its own const rather than shared
// so if the two subsystems ever diverge on validation we don't have
// to unpick a common definition.
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
  return NextResponse.json({ alerts: listMasterAlerts() });
}

export async function POST(req: Request) {
  try {
    const parsed = upsertSchema.parse(await req.json());
    const alert = upsertMasterAlert({
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
    const ok = deleteMasterAlert(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
