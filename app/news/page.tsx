"use client";

import * as React from "react";
import { ExternalLink, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useNews, type NewsItem } from "@/hooks/use-news";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Aggregate } from "@/lib/sentiment";

const LABEL_META: Record<
  "bullish" | "bearish" | "neutral",
  { chip: string; icon: React.ReactNode; text: string }
> = {
  bullish: { chip: "chip-bull", icon: <TrendingUp className="h-3.5 w-3.5" />, text: "Bullish" },
  bearish: { chip: "chip-bear", icon: <TrendingDown className="h-3.5 w-3.5" />, text: "Bearish" },
  neutral: { chip: "chip-neu",  icon: <Minus className="h-3.5 w-3.5" />, text: "Neutral" },
};

const IMPACT_META: Record<"high" | "medium" | "low", string> = {
  high: "High impact",
  medium: "Medium impact",
  low: "Low impact",
};

const OVERALL_HEADLINE: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "Overall tone is bullish",
  bearish: "Overall tone is bearish",
  neutral: "Overall tone is neutral",
};

function VerdictBanner({ agg }: { agg: Aggregate }) {
  const meta = LABEL_META[agg.label];
  const percent = Math.round(Math.abs(agg.score) * 100);
  const bar =
    agg.label === "bullish" ? "bg-success" :
    agg.label === "bearish" ? "bg-danger"  :
                                "bg-muted-foreground";
  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("chip", meta.chip)}>{meta.icon} {meta.text}</span>
            <span className="text-xs text-muted-foreground">
              {agg.counts.bullish} bullish · {agg.counts.bearish} bearish · {agg.counts.neutral} neutral
            </span>
          </div>
          <h2 className="text-xl font-semibold">{OVERALL_HEADLINE[agg.label]}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Weighted sentiment score: <strong className="tabular-nums">{agg.score.toFixed(3)}</strong>
          </p>
        </div>
        <div className="md:w-64 shrink-0">
          <div className="flex justify-between text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
            <span>Bearish</span>
            <span>Neutral</span>
            <span>Bullish</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden relative">
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div
              className={cn("absolute inset-y-0", bar)}
              style={{
                left: agg.score >= 0 ? "50%" : `${50 - percent / 2}%`,
                width: `${percent / 2}%`,
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const meta = LABEL_META[item.label];
  return (
    <article className="glass rounded-xl border-l-4 px-4 py-3 space-y-2 hover:-translate-y-0.5 transition-transform"
      style={{
        borderLeftColor:
          item.label === "bullish"
            ? "hsl(var(--success))"
            : item.label === "bearish"
              ? "hsl(var(--danger))"
              : "hsl(var(--border))",
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("chip", meta.chip)}>
          {meta.icon} {meta.text} · {item.score >= 0 ? "+" : ""}{item.score.toFixed(2)}
        </span>
        <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          {IMPACT_META[item.impact]}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {relativeTime(item.publishedAt)}
        </span>
      </div>
      <h3 className="font-semibold leading-snug">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noreferrer" className="hover:text-primary inline-flex items-start gap-1.5">
            {item.title}
            <ExternalLink className="h-3.5 w-3.5 mt-1 shrink-0 opacity-60" />
          </a>
        ) : (
          item.title
        )}
      </h3>
      {item.summary && (
        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
          {item.summary}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{item.publisher}</p>
    </article>
  );
}

function NewsList({ items }: { items: NewsItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No stories in this category.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((it, i) => <NewsCard key={i} item={it} />)}
    </div>
  );
}

export default function NewsPage() {
  const { data, loading, error, rateLimited, reload } = useNews();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="News" />
      <PageIntro pageKey="news" />

      {rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && !rateLimited && loading && <LoadingPage label="Fetching headlines…" />}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No recent news returned for <strong>{data.ticker}</strong>.
        </p>
      )}

      {data && data.items.length > 0 && (
        <div className="animate-fade-in">
          <VerdictBanner agg={data.aggregate} />

          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All ({data.items.length})</TabsTrigger>
              <TabsTrigger value="bullish">
                Bullish ({data.aggregate.counts.bullish})
              </TabsTrigger>
              <TabsTrigger value="bearish">
                Bearish ({data.aggregate.counts.bearish})
              </TabsTrigger>
              <TabsTrigger value="neutral">
                Neutral ({data.aggregate.counts.neutral})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="all"><NewsList items={data.items} /></TabsContent>
            <TabsContent value="bullish"><NewsList items={data.items.filter((i) => i.label === "bullish")} /></TabsContent>
            <TabsContent value="bearish"><NewsList items={data.items.filter((i) => i.label === "bearish")} /></TabsContent>
            <TabsContent value="neutral"><NewsList items={data.items.filter((i) => i.label === "neutral")} /></TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground text-center mt-8">
            Sentiment gauged by a finance-tuned VADER lexicon. Score ≥ +0.15 is bullish, ≤ −0.15 is bearish.
            Overall score is time-weighted (newer stories count more). This is a rough gauge of market chatter, not a trading signal.
          </p>
        </div>
      )}
    </div>
  );
}
