/**
 * CRUD for per-market-segment Technical Signal alerts.
 *
 * Structural mirror of `/api/technical-alerts` — the two features
 * share the same "daily digest + on-change" schema but persist to
 * separate tables (see `sector_technical_alerts` in `lib/db.ts` v11).
 *
 * GET                              — list every alert row
 * POST { segmentId, dailyTime?,    — create or update a rule (idempotent
 *        timezone?, notifyOnChange?,  upsert; safe to call repeatedly)
 *        minStrength? }
 * DELETE ?segmentId=SLUG           — remove the rule
 *
 * `segmentId` is validated against `SEGMENTS[]` in `lib/segments.ts`,
 * so a request for a slug we don't ship a segment for is rejected
 * with a 400 rather than silently accumulating an orphan row.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";
import {
  deleteSectorTechnicalAlert,
  listSectorTechnicalAlerts,
  upsertSectorTechnicalAlert,
} from "@/lib/sector-technical-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Segment slugs are lowercase alphanumeric + dashes. The store
// enforces cross-referencing against `SEGMENTS[]` on top of this
// regex, so a syntactically-valid slug that doesn't exist still
// gets rejected.
const upsertSchema = z.object({
  segmentId: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      "segmentId must be lowercase alphanumeric with dashes",
    ),
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
  return NextResponse.json({ alerts: listSectorTechnicalAlerts() });
}

export async function POST(req: Request) {
  try {
    const parsed = upsertSchema.parse(await req.json());
    const alert = upsertSectorTechnicalAlert({
      segmentId: parsed.segmentId,
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
  const segmentId = url.searchParams.get("segmentId");
  try {
    if (!segmentId) throw new Error("segmentId required");
    const ok = deleteSectorTechnicalAlert(segmentId);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
