import { NextResponse } from "next/server";
import { fetchNews, RateLimitedError } from "@/lib/data";
import { redactError } from "@/lib/http";
import {
  aggregate,
  impactFromScore,
  labelFromScore,
  scoreText,
  type Scored,
} from "@/lib/sentiment";
import { settings } from "@/lib/config";
import {
  newsItemCount,
  recentNewsItems,
  upsertNewsItems,
  type NewsItemInput,
} from "@/lib/news-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * News endpoint. Fetches Yahoo headlines, scores them, upserts them
 * into the local SQLite `news_items` table (dedup by ticker+link), and
 * returns the accumulated history for the ticker so the page can show
 * more than just the last Yahoo batch.
 *
 * If Yahoo is rate-limited (or otherwise unreachable), we still serve
 * whatever we already have persisted — the page keeps working on stale
 * but real data instead of showing a hard error.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? settings.ticker).toUpperCase();
  const fetchLimit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "25")));
  const historyLimit = Math.min(500, Math.max(fetchLimit, Number(url.searchParams.get("history") ?? "200")));

  let fetchError: string | null = null;
  let rateLimited = false;
  let newlyInserted = 0;

  try {
    const raw = await fetchNews(ticker, fetchLimit);
    const scored: NewsItemInput[] = raw.map((r) => {
      const combined = `${r.title}. ${r.summary}`.trim();
      const score = scoreText(combined);
      return {
        ticker,
        link: r.link,
        title: r.title,
        publisher: r.publisher || null,
        summary: r.summary || null,
        publishedAt: r.publishedAt,
        score: Math.round(score * 1000) / 1000,
        label: labelFromScore(score),
        impact: impactFromScore(score),
      };
    });
    const { insertedItems } = upsertNewsItems(scored);
    newlyInserted = insertedItems.length;
  } catch (e) {
    if (e instanceof RateLimitedError) {
      rateLimited = true;
    } else {
      // Detail is logged server-side via redactError below; we only keep a
      // boolean-ish presence so the fallback branch can decide whether to
      // serve stored data or a 502.
      fetchError = redactError(e, 502, "News source unavailable").message;
    }
  }

  // Read back accumulated history — this includes the items we just
  // upserted plus anything older that Yahoo no longer surfaces.
  const stored = recentNewsItems(ticker, historyLimit);
  const items = stored.map((s) => ({
    title: s.title,
    publisher: s.publisher ?? "Unknown source",
    link: s.link,
    publishedAt: s.publishedAt,
    summary: s.summary ?? "",
    score: s.score ?? 0,
    label: s.label ?? "neutral",
    impact: s.impact ?? "low",
    firstSeenAt: s.firstSeenAt,
  }));

  // If we truly have nothing to show AND Yahoo failed, surface that.
  if (items.length === 0) {
    if (rateLimited) {
      return NextResponse.json(
        { rateLimited: true, error: "Yahoo rate-limited and no cached news for this ticker yet." },
        { status: 429 },
      );
    }
    if (fetchError) {
      return NextResponse.json({ error: fetchError }, { status: 502 });
    }
  }

  const scored: Scored[] = items.map((it) => ({
    score: it.score,
    publishedAt: new Date(it.publishedAt),
    label: it.label,
  }));
  const agg = aggregate(scored);
  const totalStored = newsItemCount(ticker);

  return NextResponse.json({
    ticker,
    items,
    aggregate: agg,
    fetchedAt: new Date().toISOString(),
    rateLimited,
    newlyInserted,
    totalStored,
  });
}
