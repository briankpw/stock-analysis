"use client";

import * as React from "react";
import { ExternalLink, TrendingDown, TrendingUp, Minus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useNews, type NewsItem } from "@/hooks/use-news";
import { useNewsSubscriptions } from "@/hooks/use-news-subscriptions";
import { SubscribeNewsButton } from "@/components/subscribe-news-button";
import { useT } from "@/lib/i18n";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Aggregate } from "@/lib/sentiment";

const LABEL_ICON: Record<"bullish" | "bearish" | "neutral", React.ReactNode> = {
  bullish: <TrendingUp className="h-3.5 w-3.5" />,
  bearish: <TrendingDown className="h-3.5 w-3.5" />,
  neutral: <Minus className="h-3.5 w-3.5" />,
};

const LABEL_CHIP: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "chip-bull",
  bearish: "chip-bear",
  neutral: "chip-neu",
};

/**
 * Small inline dot used as a separator between adjacent labels — replaces
 * the raw `·` (U+00B7 middle-dot) character so the divider renders
 * consistently across fonts and OSes (some system fonts drop the middle
 * dot low, others centre it).
 */
function DotSep({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-1 w-1 rounded-full bg-current align-middle opacity-40",
        className,
      )}
    />
  );
}

function VerdictBanner({ agg }: { agg: Aggregate }) {
  const t = useT();
  const overallKey = `news.overall.${agg.label}`;
  const labelKey = `news.label.${agg.label}`;
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
            <span className={cn("chip", LABEL_CHIP[agg.label])}>
              {LABEL_ICON[agg.label]} {t(labelKey)}
            </span>
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t("news.countBullish", { n: agg.counts.bullish })}</span>
              <DotSep />
              <span>{t("news.countBearish", { n: agg.counts.bearish })}</span>
              <DotSep />
              <span>{t("news.countNeutral", { n: agg.counts.neutral })}</span>
            </span>
          </div>
          <h2 className="text-xl font-semibold">{t(overallKey)}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <TermTip term="Sentiment Score">{t("news.weightedScore")}</TermTip>:{" "}
            <strong className="tabular-nums">{agg.score.toFixed(3)}</strong>
          </p>
        </div>
        <div className="md:w-64 shrink-0">
          <div className="flex justify-between text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1">
            <span>{t("news.axis.bearish")}</span>
            <span>{t("news.axis.neutral")}</span>
            <span>{t("news.axis.bullish")}</span>
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
  const t = useT();
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
        <span className={cn("chip inline-flex items-center gap-1.5", LABEL_CHIP[item.label])}>
          {LABEL_ICON[item.label]}
          <span>{t(`news.label.${item.label}`)}</span>
          <DotSep />
          <span className="tabular-nums">{item.score >= 0 ? "+" : ""}{item.score.toFixed(2)}</span>
        </span>
        <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          {t(`news.impact.${item.impact}`)}
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
  const t = useT();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{t("news.empty")}</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((it, i) => <NewsCard key={i} item={it} />)}
    </div>
  );
}

export default function NewsPage() {
  const { data, loading, error, rateLimited, reload } = useNews();
  const { findSubscription } = useNewsSubscriptions();
  const t = useT();

  const ticker = data?.ticker ?? "";
  const subscription = ticker ? findSubscription(ticker) : undefined;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.news" />
      <PageIntro pageKey="news" />

      {ticker && (
        <Card className="p-4 mb-4">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="chip chip-neu">{ticker}</span>
                {typeof data?.totalStored === "number" && (
                  <span className="text-xs text-muted-foreground">
                    {data.totalStored} accumulated headline{data.totalStored === 1 ? "" : "s"}
                  </span>
                )}
                {typeof data?.newlyInserted === "number" && data.newlyInserted > 0 && (
                  <span
                    className="chip chip-bull inline-flex items-center gap-1"
                    title="Number of new headlines added on this refresh"
                  >
                    <Sparkles className="h-3 w-3" /> +{data.newlyInserted} new
                  </span>
                )}
                {rateLimited && (
                  <span className="chip chip-neu" title="Yahoo throttled us — showing cached history">
                    Yahoo rate-limited
                  </span>
                )}
                {subscription && (
                  <span
                    className="text-[0.7rem] text-muted-foreground"
                    title={new Date(subscription.createdAt).toLocaleString()}
                  >
                    subscribed {relativeTime(subscription.createdAt)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SubscribeNewsButton ticker={ticker} />
            </div>
          </div>
        </Card>
      )}

      {rateLimited && !data && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && !rateLimited && loading && <LoadingPage label={t("loading.headlines")} />}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {t("news.emptyForTicker", { ticker: data.ticker })}
        </p>
      )}

      {data && data.items.length > 0 && (
        <div className="animate-fade-in">
          <VerdictBanner agg={data.aggregate} />

          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">{t("news.tab.all", { n: data.items.length })}</TabsTrigger>
              <TabsTrigger value="bullish">{t("news.tab.bullish", { n: data.aggregate.counts.bullish })}</TabsTrigger>
              <TabsTrigger value="bearish">{t("news.tab.bearish", { n: data.aggregate.counts.bearish })}</TabsTrigger>
              <TabsTrigger value="neutral">{t("news.tab.neutral", { n: data.aggregate.counts.neutral })}</TabsTrigger>
            </TabsList>
            <TabsContent value="all"><NewsList items={data.items} /></TabsContent>
            <TabsContent value="bullish"><NewsList items={data.items.filter((i) => i.label === "bullish")} /></TabsContent>
            <TabsContent value="bearish"><NewsList items={data.items.filter((i) => i.label === "bearish")} /></TabsContent>
            <TabsContent value="neutral"><NewsList items={data.items.filter((i) => i.label === "neutral")} /></TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground text-center mt-8">
            {t("news.disclaimer")}
          </p>

          <KeyTerms
            terms={[
              "Bullish",
              "Bearish",
              "Sentiment Score",
              "VADER",
              "Impact",
            ]}
          />
        </div>
      )}
    </div>
  );
}
