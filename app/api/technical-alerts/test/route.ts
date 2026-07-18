/**
 * Send a one-off test digest for a subscribed ticker's current signal.
 *
 * Lets users validate their Telegram + web-push configuration without
 * waiting for the daily-time slot to arrive. Mirrors the pattern used
 * by `/api/bot/test-connection` — the send happens synchronously and
 * the JSON response reports the notifier's outcome so the UI can
 * surface "Sent!" vs "Telegram not configured".
 *
 * POST { ticker } — always fires, regardless of whether the alert
 *                   config would have fired now. Does not touch the
 *                   `last_*` bookkeeping columns.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistory } from "@/lib/data";
import { enrich } from "@/lib/indicators";
import { computeTechnicalSignal } from "@/lib/technical-signal";
import { notifyTechnicalDigest } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { findTechnicalAlert } from "@/lib/technical-watch/store";
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
 * Format `now` into the alert's local wall clock using Intl. Mirrors the
 * private `localWallClock()` helper in the engine — kept inline (rather
 * than exported from engine.ts) so this route doesn't have to import
 * the whole engine module just for one formatter.
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
    const alert = findTechnicalAlert(symbol);
    if (!alert) {
      return NextResponse.json(
        { ok: false, error: `no alert configured for ${symbol}` },
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
    const enriched = enrich(bars);
    const signal = computeTechnicalSignal({
      bars,
      sma50: enriched.sma50,
      sma200: enriched.sma200,
      rsi14: enriched.rsi14,
      macd: enriched.macd,
      bb20: enriched.bb20,
      levels: enriched.levels,
      kdj: enriched.kdj,
    });
    const wall = localWallClock(new Date(), alert.timezone);
    const res = await notifyTechnicalDigest(symbol, signal, {
      localDate: wall.date,
      localTime: wall.time,
      timezone: alert.timezone,
    });
    return NextResponse.json({
      ok: res.ok,
      detail: res.detail,
      verdict: signal.verdict,
      score: signal.score,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
