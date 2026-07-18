import { NextResponse } from "next/server";

import { fetchQuote, RateLimitedError } from "@/lib/data";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batch-quote endpoint for the "My Portfolio" Positions view.
 *
 * The Positions table needs a live price + previous close for every
 * currently-held symbol so it can render market value, unrealized P&L
 * and today's dollar change. Doing one HTTP call per symbol from the
 * client would (a) hammer Yahoo through us and (b) look sluggish over
 * a mobile connection. This endpoint accepts up to `MAX_TICKERS`
 * symbols in a single `?tickers=` param and returns compact quote
 * lites in parallel.
 *
 * Design notes:
 *   • `Promise.allSettled` — one rate-limited or delisted ticker
 *     shouldn't sink the whole payload; failed rows report `status:
 *     "error"` and the UI degrades to a "—" cell.
 *   • Response shape mirrors `QuoteLite` in `app/api/segments/route.ts`
 *     but adds `previousClose`, which the segments endpoint doesn't
 *     need. Kept as a *separate* type here to avoid coupling the two
 *     endpoints — segments cares about volume + market cap, positions
 *     doesn't.
 *   • Bound at `MAX_TICKERS` to keep any single call cheap. Callers
 *     with more symbols can chunk client-side.
 */

const MAX_TICKERS = 50;

// ---------------------------------------------------------------------------
// Response shape (kept aligned with client)
// ---------------------------------------------------------------------------

export interface QuoteLive {
  ticker: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  marketState: string | null;
  status: "ok" | "error";
  /** Error message when `status === "error"`, in the current locale-independent form. */
  error?: string;
}

export interface QuotesResponse {
  fetchedAt: string;
  quotes: QuoteLive[];
  /** Symbols that were dropped for being invalid (e.g. empty after trim). */
  invalid: string[];
  /** True if the underlying data source flagged rate-limit exhaustion. */
  rateLimited: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/quotes?tickers=AAPL,MSFT,...
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("tickers") ?? "";

  // Normalise + validate: upper-case, trim, drop empties, dedupe,
  // cap length so a runaway client can't force us into a giant
  // upstream fan-out.
  const invalid: string[] = [];
  const seen = new Set<string>();
  const tickers: string[] = [];
  for (const t of raw.split(",")) {
    const trimmed = t.trim().toUpperCase();
    if (!trimmed) continue;
    // Yahoo tickers can contain `.` (BRK.B), `-` (BRK-B), `=` (^GSPC
    // isn't valid via this endpoint, but futures like `ES=F` are), and
    // `^` for indices. Reject anything with obvious control chars /
    // whitespace / URL-unsafe punctuation.
    if (!/^[A-Z0-9.\-=^]{1,15}$/.test(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    tickers.push(trimmed);
    if (tickers.length >= MAX_TICKERS) break;
  }

  if (tickers.length === 0) {
    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        quotes: [],
        invalid,
        rateLimited: false,
      } satisfies QuotesResponse,
      { status: 200 },
    );
  }

  try {
    let rateLimited = false;
    const results = await Promise.allSettled(tickers.map((t) => fetchQuote(t)));

    const quotes: QuoteLive[] = results.map((res, i) => {
      const ticker = tickers[i]!;
      if (res.status === "fulfilled") {
        const q = res.value;
        return {
          ticker,
          price: q.price,
          previousClose: q.previousClose,
          change: q.change,
          changePercent: q.changePercent,
          currency: q.currency ?? null,
          marketState: q.marketState ?? null,
          status: "ok",
        };
      }
      // Reason side — flag rate-limits so the client can back off.
      const err = res.reason;
      if (err instanceof RateLimitedError) rateLimited = true;
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "quote failed";
      return {
        ticker,
        price: null,
        previousClose: null,
        change: null,
        changePercent: null,
        currency: null,
        marketState: null,
        status: "error",
        error: message,
      };
    });

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        quotes,
        invalid,
        rateLimited,
      } satisfies QuotesResponse,
      {
        headers: {
          // Short cache — quotes change constantly, but a 30-second
          // window is enough to soak up a page-refresh burst without
          // hammering Yahoo, and matches the visual "auto-refresh"
          // rhythm the Positions page uses.
          "Cache-Control": "public, max-age=30, s-maxage=30",
        },
      },
    );
  } catch (err) {
    const redacted = redactError(err, 502, "Failed to fetch quotes.");
    return NextResponse.json({ error: redacted.message }, { status: redacted.status });
  }
}
