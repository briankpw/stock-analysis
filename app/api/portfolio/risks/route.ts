/**
 * On-demand delisting / bankruptcy risk analysis for a list of
 * tickers.
 *
 * The user's portfolio lives entirely client-side (see
 * `lib/holdings-state.ts`), so this endpoint takes the tickers it
 * should analyse in the request body — the server never persists the
 * full holding data, only the set of symbols under monitoring for the
 * separate notification subscription (see
 * `/api/portfolio/risks/watches`).
 *
 * POST { tickers: string[], concurrency?: number }
 *   → { assessments: RiskAssessment[], errors: {ticker,error}[] }
 *
 * Each assessment is a self-contained snapshot the client renders in
 * the "Risks" tab. Failures don't abort the batch — a Yahoo hiccup on
 * one ticker still yields a full response for the rest, with the
 * failing ticker in `errors[]`.
 *
 * Bars, news, and quote are fetched via the same helpers the worker
 * uses (`lib/data.ts`), so both the on-demand tab view and the
 * background push loop see the same numbers.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistory, fetchNews, fetchQuote } from "@/lib/data";
import { settings } from "@/lib/config";
import { analyzeRisk } from "@/lib/portfolio-risk/analyzer";
import type { RiskAssessment } from "@/lib/portfolio-risk/signals";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  // Cap at 100 tickers — well beyond any realistic portfolio and
  // small enough to keep the batch bounded even if a caller misuses
  // the endpoint. Anything larger the user should split into pages.
  //
  // Regex covers every Yahoo Finance ticker format the app can
  // realistically encounter after uppercasing:
  //   * plain letters + digits — TSLA, MSFT, 0700
  //   * dot — regional suffixes (0700.HK, 600519.SS, D05.SI)
  //   * hyphen — class shares & crypto (BRK-B, BTC-USD)
  //   * caret — indices (^GSPC, ^IXIC)
  //   * equals — futures & forex (ES=F, EURUSD=X)
  // Max length bumped to 16 so longer crypto pairs like MATIC-USD
  // don't get spuriously rejected.
  tickers: z
    .array(
      z
        .string()
        .min(1)
        .max(16)
        .regex(/^[A-Za-z0-9.\-^=]+$/),
    )
    .min(1)
    .max(100),
  /** Max in-flight Yahoo fetches. Default 4 keeps us well under
   *  Yahoo's undocumented rate limits and matches other batch APIs
   *  in the codebase. */
  concurrency: z.number().int().min(1).max(8).optional(),
});

interface BatchError {
  ticker: string;
  error: string;
}

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const tickers = [...new Set(body.tickers.map((t) => t.trim().toUpperCase()))];
    const concurrency = body.concurrency ?? 4;

    const assessments: RiskAssessment[] = [];
    const errors: BatchError[] = [];

    // Simple worker-pool pattern — better than `Promise.all` because
    // it caps parallelism. Yahoo Finance will start returning 429s
    // when we hammer it with a portfolio of 50 tickers all at once.
    let cursor = 0;
    const workers = Array.from({ length: concurrency }).map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= tickers.length) return;
        const ticker = tickers[idx]!;
        try {
          assessments.push(await analyzeOne(ticker));
        } catch (err) {
          errors.push({
            ticker,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
    await Promise.all(workers);

    // Sort by original ticker order for a stable UI — otherwise the
    // response order depends on which fetches finished first.
    assessments.sort(
      (a, b) => tickers.indexOf(a.ticker) - tickers.indexOf(b.ticker),
    );

    return NextResponse.json({ assessments, errors });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { error: r.message },
      { status: r.status },
    );
  }
}

async function analyzeOne(ticker: string): Promise<RiskAssessment> {
  // Bars are the main signal source; if the fetch throws we let the
  // analyser see an empty array (which itself fires the `data.noBars`
  // critical signal — often the correct answer for delisted names).
  const bars = await fetchHistory(
    ticker,
    settings.bot.lookbackPeriod,
    settings.bot.lookbackInterval,
  ).catch(() => []);
  const [news, quote] = await Promise.all([
    fetchNews(ticker, 30).catch(() => []),
    fetchQuote(ticker).catch(() => null),
  ]);
  return analyzeRisk({ ticker, bars, news, quote });
}
