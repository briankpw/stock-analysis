/**
 * Send a one-off test digest for a subscribed segment's current
 * Technical Signal snapshot.
 *
 * Structural mirror of `/api/technical-alerts/test` but keyed by
 * `segmentId` (the request payload) rather than `ticker`. The
 * segment's proxy ETF is resolved via `findSegment()` and used as
 * the instrument for the technical scorer, mirroring the background
 * engine's behaviour.
 *
 * POST { segmentId } — always fires, regardless of whether the
 *                      alert config would have fired now. Does not
 *                      touch the `last_*` bookkeeping columns.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistory } from "@/lib/data";
import { enrich } from "@/lib/indicators";
import { computeTechnicalSignal } from "@/lib/technical-signal";
import { notifySectorTechnicalDigest } from "@/lib/bot/notifier";
import { settings } from "@/lib/config";
import { findSectorTechnicalAlert } from "@/lib/sector-technical-watch/store";
import { findSegment } from "@/lib/segments";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  segmentId: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      "segmentId must be lowercase alphanumeric with dashes",
    ),
});

/** Format `now` into the alert's local wall clock. Inline copy of
 *  the private helper in the engine — keeps this route self-
 *  contained and free of the engine's tick-locking machinery. */
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
    const { segmentId } = schema.parse(await req.json());
    const slug = segmentId.trim().toLowerCase();
    const alert = findSectorTechnicalAlert(slug);
    if (!alert) {
      return NextResponse.json(
        {
          ok: false,
          error: `no sector-technical alert configured for ${slug}`,
        },
        { status: 404 },
      );
    }
    const segment = findSegment(slug);
    if (!segment) {
      return NextResponse.json(
        { ok: false, error: `unknown segment: ${slug}` },
        { status: 400 },
      );
    }
    const bars = await fetchHistory(
      segment.proxyEtf,
      settings.bot.lookbackPeriod,
      settings.bot.lookbackInterval,
    );
    if (bars.length === 0) {
      return NextResponse.json(
        { ok: false, error: `no bars from upstream for ${segment.proxyEtf}` },
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
    const res = await notifySectorTechnicalDigest(
      {
        segmentId: slug,
        segmentName: segment.name,
        proxyTicker: segment.proxyEtf,
      },
      signal,
      {
        localDate: wall.date,
        localTime: wall.time,
        timezone: alert.timezone,
      },
    );
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
