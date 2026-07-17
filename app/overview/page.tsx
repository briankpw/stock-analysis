"use client";

import * as React from "react";
import { HelpCircle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBundle } from "@/hooks/use-bundle";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { fmtCurrency, fmtNumber, fmtSigned, fmtSignedPercent } from "@/lib/format";
import { signalHint } from "@/lib/knowledge";
import { useIsBeginner, useLocale, type Locale } from "@/lib/state";
import { useT, translateSignalValue } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { LatestSignals } from "@/lib/indicators";
import type { Analysis, ConclusionParts, Insight, Category } from "@/lib/insights";

type TFn = (key: string, params?: Record<string, string | number>) => string;

// --------------------------------------------------------------------------

function SignalTile({ hintKey, label, value, mood }: {
  hintKey: string;
  label: string;
  value: string;
  mood: "bull" | "bear" | "neu";
}) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const hint = signalHint(hintKey, locale);
  const icon = mood === "bull" ? <TrendingUp className="h-4 w-4" />
             : mood === "bear" ? <TrendingDown className="h-4 w-4" />
             :                    <Minus className="h-4 w-4" />;
  const chipClass = mood === "bull" ? "chip-bull" : mood === "bear" ? "chip-bear" : "chip-neu";

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-1.5">
          <span className="metric-label">{label}</span>
          {beginner && hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium mb-1">{hint.what}</p>
                {hint.ruleOfThumb && (
                  <p className="text-muted-foreground text-[0.7rem]">{hint.ruleOfThumb}</p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <span className={cn("chip", chipClass)}>
          {icon}
          {mood.toUpperCase()}
        </span>
      </div>
      <p className="mt-3 text-lg font-semibold">{value}</p>
    </Card>
  );
}

// ---- Mood classifiers key off the raw English server string; we intentionally
// keep them locale-blind so the mood is stable no matter what the display value
// reads.
function moodOfTrend(v: string): "bull" | "bear" | "neu" {
  if (v.includes("Bullish")) return "bull";
  if (v.includes("Bearish")) return "bear";
  return "neu";
}
function moodOfRsi(v: string): "bull" | "bear" | "neu" {
  if (v.includes("Oversold")) return "bull";
  if (v.includes("Overbought")) return "bear";
  return "neu";
}
function moodOfMacd(v: string): "bull" | "bear" | "neu" {
  if (v === "Bullish") return "bull";
  if (v === "Bearish") return "bear";
  return "neu";
}
function moodOfBb(v: string): "bull" | "bear" | "neu" {
  if (v.includes("below")) return "bull";
  if (v.includes("above")) return "bear";
  return "neu";
}

function SignalRow({ signals, locale, t }: { signals: LatestSignals; locale: Locale; t: TFn }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SignalTile
        hintKey="Trend"
        label={t("overview.signal.trend")}
        value={translateSignalValue("trend", signals.trend, locale)}
        mood={moodOfTrend(signals.trend)}
      />
      <SignalTile
        hintKey="RSI(14)"
        label={t("overview.signal.rsi14")}
        value={translateSignalValue("rsi", signals.rsi, locale)}
        mood={moodOfRsi(signals.rsi)}
      />
      <SignalTile
        hintKey="MACD"
        label={t("overview.signal.macd")}
        value={translateSignalValue("macd", signals.macd, locale)}
        mood={moodOfMacd(signals.macd)}
      />
      <SignalTile
        hintKey="Bollinger"
        label={t("overview.signal.bollinger")}
        value={translateSignalValue("bollinger", signals.bollinger, locale)}
        mood={moodOfBb(signals.bollinger)}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Insight rendering — every insight carries labelKey + detailKey so we can
// render in the user's locale. Fall back to the English `label` / `detail`
// if the translation is missing (which itself is safe — `translate()` returns
// the English fallback when a key is absent).

function insightLabel(insight: Insight, t: TFn): string {
  return t(insight.labelKey, insight.labelParams) || insight.label;
}
function insightDetail(insight: Insight, t: TFn): string {
  return t(insight.detailKey, insight.detailParams) || insight.detail;
}

// --------------------------------------------------------------------------
// Client-side conclusion composer — mirrors `composeEnglishConclusion` in
// `lib/insights.ts` but emits the sentence in the active locale.

function composeConclusion(parts: ConclusionParts, t: TFn): string {
  const pos = parts.positivesCount;
  const neg = parts.negativesCount;
  const joiner = t("conclusion.categoryJoiner");
  const sep = t("conclusion.listSeparator");
  const stop = t("conclusion.stop");

  const catLabel = (c: Category) => t(`insight.cat.${c}`);
  const strongList = parts.strongCategories.map(catLabel).join(joiner);
  const weakList = parts.weakCategories.map(catLabel).join(joiner);

  let opener: string;
  if (pos && !neg) {
    opener = t("conclusion.allPositive", { ticker: parts.ticker });
  } else if (neg && !pos) {
    opener = t("conclusion.allNegative", { ticker: parts.ticker });
  } else if (pos > neg * 1.5) {
    opener = t("conclusion.mostlyPositive", { ticker: parts.ticker, pos, neg });
  } else if (neg > pos * 1.5) {
    opener = t("conclusion.mostlyNegative", { ticker: parts.ticker, pos, neg });
  } else {
    opener = t("conclusion.mixed", { ticker: parts.ticker, pos, neg });
  }

  const clauses: string[] = [opener];
  if (strongList && weakList) {
    clauses.push(t("conclusion.strengthsAndWeaknesses", { strong: strongList, weak: weakList }));
  } else if (strongList) {
    clauses.push(t("conclusion.strengthsOnly", { list: strongList }));
  } else if (weakList) {
    clauses.push(t("conclusion.weaknessesOnly", { list: weakList }));
  }
  clauses.push(stop);

  const stripTrailingStop = (s: string) => s.replace(/[.。]+\s*$/u, "");

  if (parts.topPositives.length) {
    const list = parts.topPositives.map((p) => stripTrailingStop(insightDetail(p, t))).join(sep);
    clauses.push(t("conclusion.notablePositives", { list }));
  }
  if (parts.topNegatives.length) {
    const list = parts.topNegatives.map((n) => stripTrailingStop(insightDetail(n, t))).join(sep);
    clauses.push(t("conclusion.keyConcerns", { list }));
  }

  return clauses.join("");
}

// --------------------------------------------------------------------------

function VerdictCard({ analysis, t }: { analysis: Analysis; t: TFn }) {
  const score = analysis.overallScore;
  const percent = Math.max(0, Math.min(100, score));
  const tint =
    score >= 65 ? "from-success/40 to-success/5" :
    score >= 45 ? "from-primary/40 to-primary/5" :
    score >= 30 ? "from-warning/40 to-warning/5" :
                  "from-danger/40 to-danger/5";
  const bar =
    score >= 65 ? "bg-success" :
    score >= 45 ? "bg-primary" :
    score >= 30 ? "bg-warning" :
                  "bg-danger";

  const verdictLabel = t(`verdict.${analysis.verdictKey}`);
  const conclusionText = composeConclusion(analysis.conclusionParts, t);
  const conclusionHtml = conclusionText.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return (
    <Card className={cn("overflow-hidden p-6 bg-gradient-to-br", tint)}>
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="text-5xl leading-none select-none">{analysis.verdictEmoji}</div>
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1">{t("overview.verdict.label")}</p>
          <h2 className="text-2xl font-bold">{verdictLabel}</h2>
          <p
            className="mt-2 text-sm text-muted-foreground leading-relaxed"
            dangerouslySetInnerHTML={{ __html: conclusionHtml }}
          />
        </div>
        <div className="md:w-64 shrink-0">
          <div className="flex items-baseline gap-2 justify-between">
            <span className="metric-label">{t("overview.score")}</span>
            <span className="text-3xl font-bold tabular-nums">{score.toFixed(1)}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full transition-all duration-500", bar)} style={{ width: `${percent}%` }} />
          </div>
          <div className="flex justify-between text-[0.65rem] uppercase tracking-wider text-muted-foreground mt-1">
            <span>0</span><span>50</span><span>100</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="kpi-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1">{value}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------

export default function OverviewPage() {
  const { data, loading, error, reload } = useBundle();
  const t = useT();
  const locale = useLocale();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.overview" />
      <PageIntro pageKey="overview" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.marketData")} />}

      {data && (
        <div className="space-y-6 animate-fade-in">
          <VerdictCard analysis={data.analysis} t={t} />

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {t("overview.latestSignals")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t("overview.asOf", { time: new Date(data.fetchedAt).toLocaleString() })}
              </span>
            </div>
            {data.signals
              ? <SignalRow signals={data.signals} locale={locale} t={t} />
              : <p className="text-sm text-muted-foreground">{t("common.noData")}</p>}
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t("overview.snapshot")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label={t("overview.kpi.lastClose")}
                value={fmtCurrency(data.quote.price)}
                sub={data.quote.change !== null && data.quote.changePercent !== null && (
                  <span className={cn(
                    "font-semibold",
                    data.quote.change > 0 ? "text-success" : data.quote.change < 0 ? "text-danger" : "text-muted-foreground",
                  )}>
                    {fmtSigned(data.quote.change)} ({fmtSignedPercent(data.quote.changePercent)})
                  </span>
                )}
              />
              <KpiTile
                label={t("overview.kpi.bars")}
                value={fmtNumber(data.bars.length, 0)}
                sub={<span className="text-muted-foreground">{data.period} · {data.interval}</span>}
              />
              <KpiTile
                label={t("overview.kpi.positive")}
                value={String(data.analysis.positives.length)}
                sub={<span className="text-success">{t("overview.kpi.positiveSub")}</span>}
              />
              <KpiTile
                label={t("overview.kpi.concerns")}
                value={String(data.analysis.negatives.length)}
                sub={<span className="text-danger">{t("overview.kpi.concernsSub")}</span>}
              />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t("overview.positivesTitle", { n: data.analysis.positives.length })}</CardTitle></CardHeader>
              <CardContent>
                {data.analysis.positives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("overview.positivesEmpty")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.analysis.positives.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-success mt-0.5">✓</span>
                        <span>
                          <strong className="mr-1">{insightLabel(p, t)}.</strong>
                          <span className="text-muted-foreground">{insightDetail(p, t)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t("overview.concernsTitle", { n: data.analysis.negatives.length })}</CardTitle></CardHeader>
              <CardContent>
                {data.analysis.negatives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("overview.concernsEmpty")}</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.analysis.negatives.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-danger mt-0.5">✗</span>
                        <span>
                          <strong className="mr-1">{insightLabel(p, t)}.</strong>
                          <span className="text-muted-foreground">{insightDetail(p, t)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          <p className="text-xs text-muted-foreground text-center pt-4">
            {t("overview.disclaimer")}
          </p>

          <KeyTerms
            terms={[
              "SMA",
              "RSI",
              "MACD",
              "Bollinger Bands",
              "Overbought",
              "Oversold",
              "Bullish",
              "Bearish",
              "Volatility",
              "Volume",
              "Market Cap",
              "P/E Ratio",
              "Dividend Yield",
            ]}
          />
        </div>
      )}
    </div>
  );
}
