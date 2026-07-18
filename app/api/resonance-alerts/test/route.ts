/**
 * Send a one-off test digest for a subscribed ticker's current 6-Signal
 * Resonance snapshot.
 *
 * Structural mirror of `/api/technical-alerts/test`. Lets users
 * validate their Telegram + Web-Push configuration without waiting for
 * the daily-time slot to arrive. The send happens synchronously and
 * the JSON response reports the notifier's outcome so the UI can
 * surface "Sent!" vs. "Telegram not configured".
 *
 * POST { ticker } — always fires, regardless of whether the alert
 *                   config would have fired now. Does not touch the
 *                   `last_*` bookkeeping columns.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistory } from "@/lib/data";
import { computeResonance } from "@/lib/resonance";
import { notifyResonanceDigest } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { findResonanceAlert } from "@/lib/resonance-watch/store";
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
 * Format `now` into the alert's local wall clock. Mirrors the private
 * `localWallClock()` helper in the engine — kept inline so this route
 * doesn't have to import the whole engine module just for a
 * formatter.
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
    const alert = findResonanceAlert(symbol);
    if (!alert) {
      return NextResponse.json(
        { ok: false, error: `no resonance alert configured for ${symbol}` },
        { status: 404 },
      );
    }
    const bars = await fetchHistory(
      symbol,
      settings.bot.lookbackPeriod,
      settings.bot.lookbackInterval,
    );
    if (bars.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no bars from upstream" },
        { status: 502 },
      );
    }
    const result = computeResonance(bars);
    if (result.verdict === "warmup") {
      return NextResponse.json(
        {
          ok: false,
          error: "not enough bars to evaluate the 6-signal resonance yet",
        },
        { status: 400 },
      );
    }
    const wall = localWallClock(new Date(), alert.timezone);
    const res = await notifyResonanceDigest(symbol, result, {
      localDate: wall.date,
      localTime: wall.time,
      timezone: alert.timezone,
    });
    return NextResponse.json({
      ok: res.ok,
      detail: res.detail,
      verdict: result.verdict,
      alignedCount: result.alignedCount,
      bearishCount: result.bearishAlignedCount,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
