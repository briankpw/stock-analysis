/**
 * Send a one-off test master-verdict digest for a subscribed ticker's
 * current fused verdict.
 *
 * Lets users validate their Telegram + web-push setup without waiting
 * for the daily-time slot. Mirrors `/api/technical-alerts/test`; the
 * send happens synchronously and the JSON response reports the
 * notifier's outcome so the UI can surface "Sent!" vs
 * "Telegram not configured".
 *
 * POST { ticker } — always fires, regardless of whether the alert
 *                   config would have fired now. Does not touch the
 *                   `last_*` bookkeeping columns.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { notifyMasterDigest } from "@/lib/bot/notifier";
import { findMasterAlert } from "@/lib/master-watch/store";
import { computeMasterForTicker } from "@/lib/master-watch/engine";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "ticker must be alphanumeric with `.-`"),
});

/**
 * Format `now` into the alert's local wall clock using Intl. Duplicated
 * (rather than shared with `lib/watch/time.ts`) because that module is
 * a server-only import and the tiny format helper is easier to keep
 * inline than to route through the shared helper for a single call.
 */
function localWallClock(
  date: Date,
  timezone: string,
): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

export async function POST(req: Request) {
  try {
    const { ticker } = schema.parse(await req.json());
    const symbol = ticker.trim().toUpperCase();
    const alert = findMasterAlert(symbol);
    if (!alert) {
      return NextResponse.json(
        { ok: false, error: `no alert configured for ${symbol}` },
        { status: 404 },
      );
    }
    const computed = await computeMasterForTicker(symbol);
    if (!computed) {
      return NextResponse.json(
        { ok: false, error: "no bars from upstream" },
        { status: 502 },
      );
    }
    if (!computed.verdict.hasData) {
      // Test-send still succeeds with a "warmup" body — better than a
      // silent no-op. The digest text handles the low-coverage case
      // by showing 0% next to the score.
      return NextResponse.json(
        {
          ok: false,
          error:
            "Master verdict has no voting sources yet — try again once fundamentals/news arrive.",
        },
        { status: 409 },
      );
    }
    const wall = localWallClock(new Date(), alert.timezone);
    const res = await notifyMasterDigest(symbol, computed.verdict, {
      localDate: wall.date,
      localTime: wall.time,
      timezone: alert.timezone,
    });
    return NextResponse.json({
      ok: res.ok,
      detail: res.detail,
      verdict: computed.verdict.verdict,
      score: computed.verdict.score,
      coverage: computed.verdict.coverage,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
