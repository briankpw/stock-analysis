import { NextResponse } from "next/server";
import { fetchNews, RateLimitedError } from "@/lib/data";
import { aggregate, impactFromScore, labelFromScore, scoreText, type Scored } from "@/lib/sentiment";
import { settings } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? settings.ticker).toUpperCase();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "25")));

  try {
    const raw = await fetchNews(ticker, limit);
    const items = raw.map((r) => {
      const combined = `${r.title}. ${r.summary}`.trim();
      const score = scoreText(combined);
      const label = labelFromScore(score);
      const impact = impactFromScore(score);
      return {
        title: r.title,
        publisher: r.publisher,
        link: r.link,
        publishedAt: r.publishedAt,
        summary: r.summary,
        score: Math.round(score * 1000) / 1000,
        label,
        impact,
      };
    });

    const scored: Scored[] = items.map((it) => ({
      score: it.score,
      publishedAt: new Date(it.publishedAt),
      label: it.label,
    }));
    const agg = aggregate(scored);

    return NextResponse.json({
      ticker,
      items,
      aggregate: agg,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json({ rateLimited: true, error: e.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
