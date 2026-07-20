/**
 * Portfolio risk-monitor subscription list.
 *
 * The user's holdings live only in the browser; this endpoint keeps
 * the *set of symbols the client wants monitored for background
 * notifications* in sync with those holdings.
 *
 *   GET  → list every currently-monitored ticker + its snapshot
 *   POST { tickers, minSeverity? } → bulk-replace the list to match
 *                                    exactly `tickers`.
 *   DELETE ?ticker=SYMBOL          → remove a single ticker.
 *
 * The client typically drives POST from an effect that watches the
 * imported holdings' open-symbol set, so re-importing a fresher CSV
 * automatically prunes closed positions and adds new ones.
 *
 * A single POST is idempotent: sending the same list twice yields
 * the same watch set with no spurious re-fires (existing rows keep
 * their `last_*` snapshot).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteRiskWatch,
  dismissRiskWatch,
  listRiskWatches,
  syncRiskWatches,
  undismissRiskWatch,
} from "@/lib/portfolio-risk/store";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_RE = /^[A-Za-z0-9.\-^=]+$/;

const syncSchema = z.object({
  // See `/api/portfolio/risks` for the regex rationale — must accept
  // every Yahoo Finance ticker shape (letters, digits, `.`, `-`, `^`,
  // `=`) so a portfolio with HK/CN/crypto/index positions passes.
  tickers: z
    .array(
      z
        .string()
        .min(1)
        .max(16)
        .regex(TICKER_RE),
    )
    .max(100),
  minSeverity: z.enum(["critical", "high"]).optional(),
});

/**
 * PATCH body:
 *   { action: "dismiss",   ticker, fingerprint }  → pin the current
 *                                                    fingerprint as a
 *                                                    false positive.
 *   { action: "undismiss", ticker }                → clear the
 *                                                    dismissal so
 *                                                    alerts can fire
 *                                                    again for this
 *                                                    ticker.
 *
 * Fingerprint validation — an 8-char hex FNV-1a hash produced by
 * `fingerprintSignals()` in `lib/portfolio-risk/analyzer.ts`, plus
 * the sentinel `"clean"` for the empty signal set. Anything else is
 * rejected to prevent a malicious/broken client from stuffing
 * arbitrary strings into the DB.
 */
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("dismiss"),
    ticker: z.string().min(1).max(16).regex(TICKER_RE),
    fingerprint: z.string().min(1).max(64).regex(/^[a-f0-9]+$|^clean$/),
  }),
  z.object({
    action: z.literal("undismiss"),
    ticker: z.string().min(1).max(16).regex(TICKER_RE),
  }),
]);

export async function GET() {
  return NextResponse.json({ watches: listRiskWatches() });
}

export async function POST(req: Request) {
  try {
    const body = syncSchema.parse(await req.json());
    const report = syncRiskWatches(
      body.tickers,
      body.minSeverity ?? "high",
    );
    return NextResponse.json({ ok: true, report });
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
    const ok = deleteRiskWatch(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = patchSchema.parse(await req.json());
    if (body.action === "dismiss") {
      const watch = dismissRiskWatch(body.ticker, body.fingerprint);
      return NextResponse.json({ ok: true, watch });
    }
    const cleared = undismissRiskWatch(body.ticker);
    return NextResponse.json({ ok: cleared });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
